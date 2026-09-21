import { describe, expect, it, vi } from 'vitest';
import {
  handleInviteRequest,
  type DeliveryInvite,
  type InviteDeliveryDependencies,
} from '../../supabase/functions/send-parent-invite/handler';

const playerId = '10000000-0000-0000-0000-000000000001';
const inviteId = '40000000-0000-0000-0000-000000000001';
const otherId = '40000000-0000-0000-0000-000000000002';
const now = Date.parse('2026-09-18T00:00:00Z');
const pending: DeliveryInvite = {
  id: inviteId,
  invite_token: '50000000-0000-4000-8000-000000000001',
  player_user_id: playerId,
  parent_email: 'guardian@example.test',
  status: 'pending',
  expires_at: '2026-09-25T00:00:00Z',
};

function dependencies() {
  return {
    siteUrl: 'https://trakfootball.test/',
    now: vi.fn(() => now),
    getCaller: vi.fn<InviteDeliveryDependencies['getCaller']>().mockResolvedValue({
      data: { id: playerId, email: 'player@example.test', email_confirmed_at: '2026-09-17T00:00:00Z' }, error: null,
    }),
    getRole: vi.fn<InviteDeliveryDependencies['getRole']>().mockResolvedValue({ data: 'player', error: null }),
    listInvites: vi.fn<InviteDeliveryDependencies['listInvites']>().mockResolvedValue({ data: [pending], error: null }),
    resendInvite: vi.fn<InviteDeliveryDependencies['resendInvite']>().mockResolvedValue({ data: [pending], error: null }),
    sendInvite: vi.fn<InviteDeliveryDependencies['sendInvite']>().mockResolvedValue({ error: null }),
    sendMagicLink: vi.fn<InviteDeliveryDependencies['sendMagicLink']>().mockResolvedValue({ error: null }),
  };
}

function request(body?: unknown, auth = 'Bearer player-session') {
  return new Request('https://edge.example.test/send-parent-invite', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('parent invite email request boundary', () => {
  it('keeps no-body provisioning calls working and mails only the stored recipient', async () => {
    const deps = dependencies();
    const response = await handleInviteRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true, via: 'invite', redirectTo: 'https://trakfootball.test/parent-invite' });
    expect(deps.getCaller).toHaveBeenCalledWith('player-session');
    expect(deps.getRole).toHaveBeenCalledWith('player-session', playerId);
    expect(deps.listInvites).toHaveBeenCalledWith('player-session');
    expect(deps.sendInvite).toHaveBeenCalledWith(pending.parent_email, 'https://trakfootball.test/parent-invite');
    expect(deps.resendInvite).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid authentication before reading invitations', async () => {
    const deps = dependencies();
    expect((await handleInviteRequest(request(undefined, ''), deps)).status).toBe(401);
    expect(deps.getCaller).not.toHaveBeenCalled();
    deps.getCaller.mockResolvedValue({ data: null, error: { message: 'Invalid JWT' } });
    expect((await handleInviteRequest(request(), deps)).status).toBe(401);
    expect(deps.listInvites).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('requires a confirmed email', async () => {
    const deps = dependencies();
    deps.getCaller.mockResolvedValue({ data: { id: playerId, email: 'player@example.test' }, error: null });
    expect((await handleInviteRequest(request(), deps)).status).toBe(403);
    expect(deps.getRole).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it.each(['parent', 'coach', 'club', null])('rejects the %s role', async role => {
    const deps = dependencies();
    deps.getRole.mockResolvedValue({ data: role, error: null });
    expect((await handleInviteRequest(request(), deps)).status).toBe(403);
    expect(deps.listInvites).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it.each([
    { player_user_id: 'someone-else' },
    { resend: true },
    { invite_id: 'invalid' },
    { invite_id: inviteId, resend: 'yes' },
    { parent_email: '' },
    { parent_email: '   ' },
    { parent_email: 123 },
    { parent_email: 'x@example.test'.padEnd(321, 'a') },
    { parent_email: pending.parent_email, invite_id: inviteId },
    { parent_email: pending.parent_email, resend: true },
  ])('rejects untrusted or malformed request fields: %j', async body => {
    const deps = dependencies();
    expect((await handleInviteRequest(request(body), deps)).status).toBe(400);
    expect(deps.listInvites).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  describe('F-5: binding the send to the address this call supplied', () => {
    const otherChildInvite: DeliveryInvite = {
      ...pending,
      id: otherId,
      invite_token: '50000000-0000-4000-8000-000000000003',
      parent_email: 'other-guardian@example.test',
    };

    it('POSITIVE: mails the invite whose stored address matches the supplied parent_email', async () => {
      const deps = dependencies();
      deps.listInvites.mockResolvedValue({ data: [otherChildInvite, pending], error: null });
      const response = await handleInviteRequest(request({ parent_email: pending.parent_email }), deps);
      expect(response.status).toBe(200);
      expect(deps.sendInvite).toHaveBeenCalledWith(pending.parent_email, 'https://trakfootball.test/parent-invite');
    });

    it('CONTROL: the positive case really does send (a handler that never sends cannot pass the negative for the right reason)', async () => {
      const deps = dependencies();
      const response = await handleInviteRequest(request({ parent_email: pending.parent_email }), deps);
      expect(response.status).toBe(200);
      expect(deps.sendInvite).toHaveBeenCalledOnce();
    });

    it('NEGATIVE: never mails a different child\'s guardian when the supplied address does not match', async () => {
      // The exact F-5 shape: the caller's only pending invite belongs to a
      // different child (say, the account's earlier onboarding). A duplicate
      // signup for a second child supplies its own parent_email, which does
      // not exist among this caller's invites yet.
      const deps = dependencies();
      deps.listInvites.mockResolvedValue({ data: [otherChildInvite], error: null });
      const response = await handleInviteRequest(request({ parent_email: 'new-guardian@example.test' }), deps);
      expect(await response.json()).toMatchObject({ sent: false, reason: 'no_invite' });
      expect(deps.sendInvite).not.toHaveBeenCalled();
      expect(deps.sendInvite).not.toHaveBeenCalledWith(otherChildInvite.parent_email, expect.anything());
    });

    it('does not fall back to another active invite when the supplied address matches none', async () => {
      const deps = dependencies();
      deps.listInvites.mockResolvedValue({ data: [pending], error: null });
      const response = await handleInviteRequest(request({ parent_email: 'nobody@example.test' }), deps);
      expect(response.status).toBe(404);
      expect(deps.sendInvite).not.toHaveBeenCalled();
    });

    it('matches the supplied address case-insensitively and trims it', async () => {
      const deps = dependencies();
      const response = await handleInviteRequest(
        request({ parent_email: `  ${pending.parent_email.toUpperCase()}  ` }), deps,
      );
      expect(response.status).toBe(200);
      expect(deps.sendInvite).toHaveBeenCalledWith(pending.parent_email, 'https://trakfootball.test/parent-invite');
    });

    it('reports the matching invite as expired rather than falling through to no_invite', async () => {
      const deps = dependencies();
      deps.listInvites.mockResolvedValue({ data: [{ ...pending, expires_at: '2026-09-17T00:00:00Z' }], error: null });
      const response = await handleInviteRequest(request({ parent_email: pending.parent_email }), deps);
      expect(await response.json()).toMatchObject({ sent: false, reason: 'invite_expired' });
      expect(deps.sendInvite).not.toHaveBeenCalled();
    });

    it('reports already_accepted only when the matching invite is the one accepted', async () => {
      const deps = dependencies();
      deps.listInvites.mockResolvedValue({
        data: [{ ...pending, status: 'accepted' }, otherChildInvite], error: null,
      });
      const response = await handleInviteRequest(request({ parent_email: pending.parent_email }), deps);
      expect(await response.json()).toMatchObject({ sent: false, reason: 'already_accepted' });
      expect(deps.sendInvite).not.toHaveBeenCalled();
    });
  });

  it('does not mail or renew an invitation belonging to another player', async () => {
    const deps = dependencies();
    deps.listInvites.mockResolvedValue({ data: [{ ...pending, player_user_id: 'someone-else' }], error: null });
    expect((await handleInviteRequest(request({ invite_id: inviteId, resend: true }), deps)).status).toBe(404);
    expect(deps.resendInvite).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('selects an older active invite when the newest one is already accepted', async () => {
    const deps = dependencies();
    deps.listInvites.mockResolvedValue({ data: [
      { ...pending, id: otherId, status: 'accepted', parent_email: 'already-joined@example.test' }, pending,
    ], error: null });
    expect((await handleInviteRequest(request(), deps)).status).toBe(200);
    expect(deps.sendInvite).toHaveBeenCalledWith(pending.parent_email, 'https://trakfootball.test/parent-invite');
  });

  it.each([undefined, { invite_id: inviteId }])('does not implicitly renew expired invitations', async body => {
    const deps = dependencies();
    deps.listInvites.mockResolvedValue({ data: [{ ...pending, expires_at: '2026-09-17T00:00:00Z' }], error: null });
    const response = await handleInviteRequest(request(body), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ sent: false, reason: 'invite_expired' });
    expect(deps.resendInvite).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('explicitly renews an expired invitation with the caller JWT before mailing', async () => {
    const deps = dependencies();
    deps.listInvites.mockResolvedValue({ data: [{ ...pending, expires_at: '2026-09-17T00:00:00Z' }], error: null });
    const response = await handleInviteRequest(request({ invite_id: inviteId, resend: true }), deps);
    expect(response.status).toBe(200);
    expect(deps.resendInvite).toHaveBeenCalledWith('player-session', inviteId);
    expect(deps.sendInvite).toHaveBeenCalledOnce();
  });

  it('stops if a concurrent parent acceptance wins the locked resend', async () => {
    const deps = dependencies();
    deps.resendInvite.mockResolvedValue({ data: [{ ...pending, status: 'accepted' }], error: null });
    const response = await handleInviteRequest(request({ invite_id: inviteId, resend: true }), deps);
    expect(await response.json()).toMatchObject({ sent: false, reason: 'already_accepted' });
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('never reopens or mails an accepted invitation', async () => {
    const deps = dependencies();
    deps.listInvites.mockResolvedValue({ data: [{ ...pending, status: 'accepted' }], error: null });
    const response = await handleInviteRequest(request({ invite_id: inviteId, resend: true }), deps);
    expect(await response.json()).toMatchObject({ sent: false, reason: 'already_accepted' });
    expect(deps.resendInvite).not.toHaveBeenCalled();
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('returns database failures without mailing', async () => {
    const deps = dependencies();
    deps.listInvites.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } });
    const response = await handleInviteRequest(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ sent: false, detail: 'Database unavailable' });
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('stops when the database rejects a resend', async () => {
    const deps = dependencies();
    deps.resendInvite.mockResolvedValue({ data: null, error: { message: 'Invitation unavailable', code: '42501' } });
    expect((await handleInviteRequest(request({ invite_id: inviteId, resend: true }), deps)).status).toBe(403);
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });

  it('uses the existing-account magic-link fallback', async () => {
    const deps = dependencies();
    deps.sendInvite.mockResolvedValue({ error: { message: 'User already registered', code: 'email_exists' } });
    const response = await handleInviteRequest(request(), deps);
    expect(await response.json()).toMatchObject({ sent: true, via: 'magic_link' });
    expect(deps.sendMagicLink).toHaveBeenCalledWith(pending.parent_email, 'https://trakfootball.test/parent-invite');
  });

  it('revalidates the renewed snapshot when explicit resend needs an existing-account fallback', async () => {
    const deps = dependencies();
    const renewed = { ...pending, invite_token: '50000000-0000-4000-8000-000000000002' };
    deps.listInvites.mockResolvedValueOnce({ data: [{ ...pending, expires_at: '2026-09-17T00:00:00Z' }], error: null })
      .mockResolvedValueOnce({ data: [renewed], error: null });
    // The SQL resend RPC intentionally omits player_user_id; the second list
    // lookup must establish ownership while comparing the newly rotated token.
    deps.resendInvite.mockResolvedValue({ data: [{ ...renewed, player_user_id: undefined }], error: null });
    deps.sendInvite.mockResolvedValue({ error: { message: 'Already registered', code: 'email_exists' } });
    const response = await handleInviteRequest(request({ invite_id: inviteId, resend: true }), deps);
    expect(await response.json()).toMatchObject({ sent: true, via: 'magic_link' });
    expect(deps.listInvites).toHaveBeenCalledTimes(2);
    expect(deps.sendMagicLink).toHaveBeenCalledWith(renewed.parent_email, 'https://trakfootball.test/parent-invite');
  });

  it.each([
    { change: 'accepted', row: { ...pending, status: 'accepted' }, reason: 'already_accepted', status: 200 },
    { change: 'rotated', row: { ...pending, invite_token: '50000000-0000-4000-8000-000000000002' }, reason: 'invite_changed', status: 409 },
    { change: 'expired', row: pending, reason: 'invite_expired', status: 409 },
    { change: 'foreign owner', row: { ...pending, player_user_id: 'someone-else' }, reason: 'no_invite', status: 404 },
    { change: 'recipient changed', row: { ...pending, parent_email: 'changed@example.test' }, reason: 'invite_changed', status: 409 },
  ])('does not send a fallback when the invitation is $change during the first provider request', async ({ change, row, reason, status }) => {
    const deps = dependencies();
    let finishProvider!: (result: { error: { message: string; code: string } }) => void;
    deps.sendInvite.mockReturnValue(new Promise(resolve => { finishProvider = resolve; }));
    const responsePromise = handleInviteRequest(request(), deps);
    await vi.waitFor(() => expect(deps.sendInvite).toHaveBeenCalledOnce());
    deps.listInvites.mockResolvedValue({ data: [row], error: null });
    if (change === 'expired') deps.now.mockReturnValue(Date.parse(pending.expires_at));
    finishProvider({ error: { message: 'Already registered', code: 'email_exists' } });
    const response = await responsePromise;
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ sent: false, reason });
    expect(deps.listInvites).toHaveBeenNthCalledWith(2, 'player-session');
    expect(deps.sendMagicLink).not.toHaveBeenCalled();
  });

  it('fails closed when invitation revalidation before fallback is unavailable', async () => {
    const deps = dependencies();
    deps.sendInvite.mockResolvedValue({ error: { message: 'Already registered', code: 'email_exists' } });
    deps.listInvites.mockResolvedValueOnce({ data: [pending], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Database unavailable' } });
    const response = await handleInviteRequest(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ sent: false, reason: 'invite_lookup_failed' });
    expect(deps.sendMagicLink).not.toHaveBeenCalled();
  });

  it('reports provider rejection and does not try a fallback for unrelated errors', async () => {
    const deps = dependencies();
    deps.sendInvite.mockResolvedValue({ error: { message: 'Email rate limit exceeded', status: 429 } });
    const response = await handleInviteRequest(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ sent: false, reason: 'invite_rejected', detail: 'Email rate limit exceeded' });
    expect(deps.sendMagicLink).not.toHaveBeenCalled();
  });

  it('reports failure of the existing-parent email rather than claiming success', async () => {
    const deps = dependencies();
    deps.sendInvite.mockResolvedValue({ error: { message: 'Already registered' } });
    deps.sendMagicLink.mockResolvedValue({ error: { message: 'SMTP unavailable' } });
    const response = await handleInviteRequest(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ sent: false, reason: 'magic_link_rejected', detail: 'SMTP unavailable' });
  });
});
