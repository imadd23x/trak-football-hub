import { describe, expect, it, vi } from 'vitest';
import {
  handleRosterInviteRequest,
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
const SERVICE_KEY = 'service-role-key';

const guardianTarget: RosterInviteTarget = { kind: 'guardian', email: 'g@example.test', first_name: 'Ana', academy: 'Invite FC' };
const childTarget: RosterInviteTarget = { kind: 'child', email: 'ana@example.test', first_name: 'Ana', academy: 'Invite FC' };

function dependencies(targets: RosterInviteTarget[] = [guardianTarget]) {
  return {
    siteUrl: 'https://trakfootball.test/',
    serviceRoleKey: SERVICE_KEY,
    getCaller: vi.fn<RosterInviteDependencies['getCaller']>().mockResolvedValue({
      data: { id: guardianId, email: 'g@example.test', email_confirmed_at: '2026-09-26T00:00:00Z' }, error: null,
    }),
    getTargets: vi.fn<RosterInviteDependencies['getTargets']>().mockResolvedValue({ data: targets, error: null }),
    markSent: vi.fn<RosterInviteDependencies['markSent']>().mockResolvedValue({ error: null }),
    sendInvite: vi.fn<RosterInviteDependencies['sendInvite']>().mockResolvedValue({ error: null }),
    sendMagicLink: vi.fn<RosterInviteDependencies['sendMagicLink']>().mockResolvedValue({ error: null }),
    confirmServiceKey: vi.fn<RosterInviteDependencies['confirmServiceKey']>().mockResolvedValue(false),
  };
}

// A JWT-shaped token with the given claims (unsigned: the gateway verifies
// signatures; the handler only reads the role before asking Auth to confirm).
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.signature`;
const LEGACY_SERVICE_JWT = jwt({ iss: 'supabase', ref: 'xbykbqolvqyqmipikuae', role: 'service_role', iat: 1774368273, exp: 2089944273 });
// What Auth answered on 30 Sep when the handler asked it for the "guardian"
// behind a service key: 403, since the key has no user.
const NO_USER = { data: null, error: { message: 'invalid claim: missing sub claim', status: 403 } };

function request(body: unknown = { roster_child_id: rosterChildId }, token: string | null = 'guardian-session') {
  return new Request('https://edge.example.test/send-roster-invites', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

describe('send-roster-invites', () => {
  it('lets the operator invite the guardians, to parent onboarding, and records each delivery', async () => {
    const deps = dependencies();
    const res = await handleRosterInviteRequest(request(undefined, SERVICE_KEY), deps);
    expect(res.status).toBe(200);
    expect(deps.getCaller).not.toHaveBeenCalled();
    expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null);
    expect(deps.sendInvite).toHaveBeenCalledWith('g@example.test', 'https://trakfootball.test/onboarding/parent',
      { invited_as: 'parent', child_first_name: 'Ana', academy_name: 'Invite FC' });
    expect(deps.markSent).toHaveBeenCalledWith(rosterChildId, guardianTarget);
    expect(await res.json()).toEqual({ sent: 1, failed: 0, results: [{ kind: 'guardian', sent: true, via: 'invite' }] });
  });

  it('asks SQL for the child as this guardian, and sends the child to player onboarding', async () => {
    const deps = dependencies([childTarget]);
    const res = await handleRosterInviteRequest(request(), deps);
    expect(res.status).toBe(200);
    expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, guardianId);
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
    const res = await handleRosterInviteRequest(request(undefined, SERVICE_KEY), deps);
    expect(deps.sendMagicLink).toHaveBeenCalledWith('g@example.test', 'https://trakfootball.test/onboarding/parent');
    expect(await res.json()).toMatchObject({ sent: 1, results: [{ kind: 'guardian', sent: true, via: 'magic_link' }] });
  });

  it('reports a failed delivery without the address, records nothing for it, and keeps going', async () => {
    const second: RosterInviteTarget = { ...guardianTarget, email: 'g2@example.test' };
    const deps = dependencies([guardianTarget, second]);
    deps.sendInvite.mockResolvedValueOnce({ error: { message: 'SMTP refused g@example.test', status: 500 } });
    const res = await handleRosterInviteRequest(request(undefined, SERVICE_KEY), deps);
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

  // TRAK-24 (30 Sep phone run): prod refused the operator's genuine legacy service key
  // (401 x3, nothing sent) because the key the runtime injects is a different
  // string. The operator must not depend on which form of the key is injected.
  describe('recognises the operator whichever form of the service key the runtime holds (TRAK-24, 30 Sep run)', () => {
    it('invites for a genuine service_role key that is not the injected string', async () => {
      const deps = { ...dependencies(), serviceRoleKey: 'sb_secret_a-different-form-of-the-key' };
      deps.getCaller.mockResolvedValue(NO_USER);
      deps.confirmServiceKey.mockResolvedValue(true);
      const res = await handleRosterInviteRequest(request(undefined, LEGACY_SERVICE_JWT), deps);
      expect(res.status).toBe(200);
      expect(deps.confirmServiceKey).toHaveBeenCalledWith(LEGACY_SERVICE_JWT);
      expect(deps.getCaller).not.toHaveBeenCalled();
      expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null);
      expect(await res.json()).toMatchObject({ sent: 1, failed: 0 });
    });

    it('refuses a token that only claims service_role, and sends nothing', async () => {
      const deps = dependencies();
      deps.getCaller.mockResolvedValue(NO_USER);
      const res = await handleRosterInviteRequest(request(undefined, jwt({ role: 'service_role' })), deps);
      expect(res.status).toBe(401);
      expect(deps.getTargets).not.toHaveBeenCalled();
      expect(deps.sendInvite).not.toHaveBeenCalled();
      expect(deps.markSent).not.toHaveBeenCalled();
    });

    it("never treats a confirmed check as the operator's unless the token claims service_role", async () => {
      const deps = dependencies();
      deps.confirmServiceKey.mockResolvedValue(true);
      const res = await handleRosterInviteRequest(request(undefined, jwt({ role: 'authenticated', sub: guardianId })), deps);
      expect(res.status).toBe(200);
      expect(deps.confirmServiceKey).not.toHaveBeenCalled();
      expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, guardianId);
    });

    it('CONTROL the exact injected key still needs no extra check', async () => {
      const deps = dependencies();
      await handleRosterInviteRequest(request(undefined, SERVICE_KEY), deps);
      expect(deps.confirmServiceKey).not.toHaveBeenCalled();
      expect(deps.getTargets).toHaveBeenCalledWith(rosterChildId, null);
    });
  });

  it('compares the service key in full', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
  });
});
