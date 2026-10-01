import { describe, expect, it, vi } from 'vitest';
import {
  handleRosterInviteRequest,
  keyValues,
  sameSecret,
  type RosterInviteDependencies,
  type RosterInviteTarget,
} from '../../supabase/functions/send-roster-invites/handler';

// TRAK-11 phase 3: the operator (service key) invites a roster child's
// guardians; a guardian (their JWT) has the child invited after consenting.
// Who may be emailed is decided by roster_invite_targets() in SQL; these tests
// pin how the handler authenticates, delivers, records and reports.

const rosterChildId = '98a00000-0000-0000-0000-000000000070';
const guardianId = '98a00000-0000-0000-0000-000000000020';
// TRAK-9 (30 Sep TRAK-24 run): the operator authenticates with a new-style
// secret key on the apikey header, never a legacy JWT (Supabase's migration
// guide; the legacy keys stop working at the end of 2026).
const SECRET_KEY = 'sb_secret_operator-test-key';
const OTHER_SECRET_KEY = 'sb_secret_second-named-key';
const PUBLISHABLE_KEY = 'sb_publishable_browser-test-key';

const guardianTarget: RosterInviteTarget = { kind: 'guardian', email: 'g@example.test', first_name: 'Ana', academy: 'Invite FC' };
const childTarget: RosterInviteTarget = { kind: 'child', email: 'ana@example.test', first_name: 'Ana', academy: 'Invite FC' };

function dependencies(targets: RosterInviteTarget[] = [guardianTarget]) {
  return {
    siteUrl: 'https://trakfootball.test/',
    secretKeys: [SECRET_KEY, OTHER_SECRET_KEY],
    getCaller: vi.fn<RosterInviteDependencies['getCaller']>().mockResolvedValue({
      data: { id: guardianId, email: 'g@example.test', email_confirmed_at: '2026-09-26T00:00:00Z' }, error: null,
    }),
    getTargets: vi.fn<RosterInviteDependencies['getTargets']>().mockResolvedValue({ data: targets, error: null }),
    markSent: vi.fn<RosterInviteDependencies['markSent']>().mockResolvedValue({ error: null }),
    sendInvite: vi.fn<RosterInviteDependencies['sendInvite']>().mockResolvedValue({ error: null }),
    sendMagicLink: vi.fn<RosterInviteDependencies['sendMagicLink']>().mockResolvedValue({ error: null }),
  };
}

// A browser call (supabase.functions.invoke): the session on Authorization,
// the publishable key on apikey.
function request(body: unknown = { roster_child_id: rosterChildId }, token: string | null = 'guardian-session',
  apikey: string | null = PUBLISHABLE_KEY) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apikey) headers.apikey = apikey;
  return new Request('https://edge.example.test/send-roster-invites', { method: 'POST', headers, body: JSON.stringify(body) });
}
// The operator's loader call: the secret key on apikey only.
const operator = (body?: unknown) => request(body, null, SECRET_KEY);

describe('send-roster-invites', () => {
  it('lets the operator invite the guardians, to parent onboarding, and records each delivery', async () => {
    const deps = dependencies();
    const res = await handleRosterInviteRequest(operator(), deps);
    expect(res.status).toBe(200);
    expect(deps.getCaller).not.toHaveBeenCalled();
    expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null, false);
    expect(deps.sendInvite).toHaveBeenCalledWith('g@example.test', 'https://trakfootball.test/onboarding/parent',
      { invited_as: 'parent', child_first_name: 'Ana', academy_name: 'Invite FC' });
    expect(deps.markSent).toHaveBeenCalledWith(rosterChildId, guardianTarget);
    expect(await res.json()).toEqual({ sent: 1, failed: 0, results: [{ kind: 'guardian', sent: true, via: 'invite' }] });
  });

  it('asks SQL for the child as this guardian, and sends the child to player onboarding', async () => {
    const deps = dependencies([childTarget]);
    const res = await handleRosterInviteRequest(request(), deps);
    expect(res.status).toBe(200);
    expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, guardianId, false);
    expect(deps.sendInvite).toHaveBeenCalledWith('ana@example.test', 'https://trakfootball.test/onboarding/player',
      { invited_as: 'player', child_first_name: 'Ana', academy_name: 'Invite FC' });
  });

  it.each(['not_guardian', 'consent_required'])('refuses a guardian SQL refuses (%s) and sends nothing', async (reason) => {
    const deps = dependencies();
    deps.getTargets.mockResolvedValue({ data: null, error: { code: '42501', message: reason } });
    const res = await handleRosterInviteRequest(request(), deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ sent: 0, reason });
    expect(deps.sendInvite).not.toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
  });

  it('refuses a missing session, an unverified email and a bad body before asking SQL', async () => {
    const deps = dependencies();
    expect((await handleRosterInviteRequest(request(undefined, null), deps)).status).toBe(401);
    deps.getCaller.mockResolvedValueOnce({ data: null, error: { message: 'bad jwt' } });
    expect((await handleRosterInviteRequest(request(), deps)).status).toBe(401);
    deps.getCaller.mockResolvedValueOnce({ data: { id: guardianId, email: 'g@example.test' }, error: null });
    expect((await handleRosterInviteRequest(request(), deps)).status).toBe(403);
    expect((await handleRosterInviteRequest(request({ roster_child_id: 'not-a-uuid' }), deps)).status).toBe(400);
    expect((await handleRosterInviteRequest(request({ roster_child_id: rosterChildId, email: 'x@y.z' }), deps)).status).toBe(400);
    expect(deps.getTargets).not.toHaveBeenCalled();
  });

  it('sends an existing account a magic link instead', async () => {
    const deps = dependencies();
    deps.sendInvite.mockResolvedValue({ error: { message: 'A user with this email address has already been registered', code: 'email_exists' } });
    const res = await handleRosterInviteRequest(operator(), deps);
    expect(deps.sendMagicLink).toHaveBeenCalledWith('g@example.test', 'https://trakfootball.test/onboarding/parent');
    expect(await res.json()).toMatchObject({ sent: 1, results: [{ kind: 'guardian', sent: true, via: 'magic_link' }] });
  });

  it('reports a failed delivery without the address, records nothing for it, and keeps going', async () => {
    const second: RosterInviteTarget = { ...guardianTarget, email: 'g2@example.test' };
    const deps = dependencies([guardianTarget, second]);
    deps.sendInvite.mockResolvedValueOnce({ error: { message: 'SMTP refused g@example.test', status: 500 } });
    const res = await handleRosterInviteRequest(operator(), deps);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ sent: 1, failed: 1, results: [
      { kind: 'guardian', sent: false, reason: 'delivery_failed' },
      { kind: 'guardian', sent: true, via: 'invite' },
    ] });
    expect(JSON.stringify(body)).not.toMatch(/@/);
    expect(deps.markSent).toHaveBeenCalledTimes(1);
    expect(deps.markSent).toHaveBeenCalledWith(rosterChildId, second);
  });

  it('says so when there is nobody left to invite', async () => {
    const res = await handleRosterInviteRequest(request(), dependencies([]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, failed: 0, results: [], reason: 'nothing_to_send' });
  });

  describe('the operator is a secret key on apikey; anyone else is a verified user session (TRAK-9)', () => {
    // What Auth answers when asked for the user behind something that isn't a
    // session: on 30 Sep, a legacy service_role key got exactly this.
    const NOT_A_USER = { data: null, error: { message: 'invalid claim: missing sub claim', status: 403 } };

    it('treats a secret key on apikey, with no Authorization, as the operator', async () => {
      const deps = dependencies();
      const res = await handleRosterInviteRequest(operator(), deps);
      expect(res.status).toBe(200);
      expect(deps.getCaller).not.toHaveBeenCalled();
      expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null, false);
    });

    it('accepts any of the named secret keys', async () => {
      const deps = dependencies();
      const res = await handleRosterInviteRequest(request(undefined, null, OTHER_SECRET_KEY), deps);
      expect(res.status).toBe(200);
      expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null, false);
    });

    it.each([
      ['a wrong secret key on apikey', request(undefined, null, 'sb_secret_not-this-project')],
      ["the legacy service_role key on Authorization (30 Sep's call)", request(undefined, 'eyJ.legacy-service-role.jwt', null)],
      ['the secret key on Authorization instead of apikey', request(undefined, SECRET_KEY, PUBLISHABLE_KEY)],
      ['no headers at all', request(undefined, null, null)],
    ])('refuses %s with 401 and sends nothing', async (_what, req) => {
      const deps = dependencies();
      deps.getCaller.mockResolvedValue(NOT_A_USER);
      const res = await handleRosterInviteRequest(req, deps);
      expect(res.status).toBe(401);
      expect(deps.getTargets).not.toHaveBeenCalled();
      expect(deps.sendInvite).not.toHaveBeenCalled();
      expect(deps.markSent).not.toHaveBeenCalled();
    });

    it('keeps a guardian session with the publishable key on the guardian path', async () => {
      const deps = dependencies();
      const res = await handleRosterInviteRequest(request(), deps);
      expect(res.status).toBe(200);
      expect(deps.getCaller).toHaveBeenCalledWith('guardian-session');
      expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, guardianId, false);
    });

    it('reads the secret keys out of the JSON the runtime provides, and nothing else', () => {
      expect(keyValues('{"default":"sb_secret_a","loader":"sb_secret_b"}')).toEqual(['sb_secret_a', 'sb_secret_b']);
      expect(keyValues('{"default":"sb_secret_a","bad":7,"empty":""}')).toEqual(['sb_secret_a']);
      expect(keyValues('not json')).toEqual([]);
      expect(keyValues(undefined)).toEqual([]);
      expect(keyValues('["sb_secret_a"]')).toEqual([]);
    });
  });

  it('compares the service key in full', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
  });
});

// TRAK-91 (Imad, 1 Oct): "never re-send" is opt-in on the server. The loader's
// --reinvite sends only_uninvited: true so a guardian who already has an
// invitation isn't emailed again; only the operator may ask for it.
describe('only_uninvited (TRAK-91)', () => {
  it('passes the operator\'s only_uninvited to SQL', async () => {
    const deps = dependencies();
    const res = await handleRosterInviteRequest(operator({ roster_child_id: rosterChildId, only_uninvited: true }), deps);
    expect(res.status).toBe(200);
    expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null, true);
  });

  it('CONTROL without it the operator call is unchanged: every unsigned guardian', async () => {
    const deps = dependencies();
    await handleRosterInviteRequest(operator({ roster_child_id: rosterChildId }), deps);
    await handleRosterInviteRequest(operator({ roster_child_id: rosterChildId, only_uninvited: false }), deps);
    expect(deps.getTargets.mock.calls).toEqual([[rosterChildId, null, false], [rosterChildId, null, false]]);
  });

  it('refuses it from a guardian session, before asking SQL', async () => {
    const deps = dependencies();
    const res = await handleRosterInviteRequest(request({ roster_child_id: rosterChildId, only_uninvited: true }), deps);
    expect(res.status).toBe(400);
    expect(deps.getTargets).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-boolean value', { roster_child_id: rosterChildId, only_uninvited: 'yes' }],
    ['an unknown key', { roster_child_id: rosterChildId, only_uninvited: true, resend: true }],
    ['no roster child', { only_uninvited: true }],
  ])('refuses %s from the operator', async (_what, body) => {
    const deps = dependencies();
    expect((await handleRosterInviteRequest(operator(body), deps)).status).toBe(400);
    expect(deps.getTargets).not.toHaveBeenCalled();
  });
});
