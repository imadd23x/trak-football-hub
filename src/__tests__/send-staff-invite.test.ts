import { describe, expect, it, vi } from 'vitest';
import { handleStaffInviteRequest, type StaffDeliveryDependencies } from '../../supabase/functions/send-staff-invite/handler';

const id = '97000000-0000-0000-0000-000000000501';
const attempt = '97000000-0000-0000-0000-000000000502';
const org = '97000000-0000-0000-0000-000000000101';
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaabbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const expiry = '2027-01-01T00:00:00Z';
const input = { request_id: id, role: 'coach', email: 'coach@test.invalid', organization_id: org };
const ok = (data: unknown) => ({ data, error: null });
const make = () => ({
  siteUrl: 'https://trakfootball.com',
  now: () => Date.parse('2026-09-20T00:00:00Z'),
  getCaller: vi.fn().mockResolvedValue(ok({ id: 'issuer', email: 'admin@test.invalid', email_confirmed_at: '2026-01-01' })),
  issue: vi.fn().mockResolvedValue(ok({ invitation_id: id, token, state: 'pending', expires_at: expiry, replayed: false, dispatch: true, attempt_id: attempt, email: input.email, role: 'coach' })),
  status: vi.fn().mockResolvedValue(ok({ invitation_id: id, state: 'pending', delivery_state: 'sending', attempt_id: attempt, expires_at: expiry })),
  finish: vi.fn().mockResolvedValue({ error: null }),
  sendInvite: vi.fn().mockResolvedValue({ error: null }),
  sendMagicLink: vi.fn().mockResolvedValue({ error: null }),
});
const request = (body: unknown = input, auth = true) => new Request('https://edge.test/send-staff-invite', {
  method: 'POST', headers: { ...(auth ? { Authorization: 'Bearer caller-jwt' } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
async function run(deps: StaffDeliveryDependencies, body: unknown = input) {
  const response = await handleStaffInviteRequest(request(body), deps);
  return { status: response.status, body: await response.json() };
}

describe('staff email orchestration', () => {
  it('requires real verified Auth identity before touching issuance', async () => {
    const deps = make();
    expect((await handleStaffInviteRequest(request(input, false), deps)).status).toBe(401);
    deps.getCaller.mockResolvedValue(ok({ id: 'issuer', email: 'admin@test.invalid' }));
    expect((await run(deps)).status).toBe(403);
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it('rejects caller-selected redirect or contradictory scopes', async () => {
    const deps = make();
    expect((await run(deps, { ...input, redirectTo: 'https://other.test' })).status).toBe(400);
    expect((await run(deps, { ...input, academy_name: 'Unexpected' })).status).toBe(400);
    expect(deps.issue).not.toHaveBeenCalled();
  });
  it('uses caller JWT and canonical receipt, exposing no token in its response', async () => {
    const deps = make(); const result = await run(deps);
    expect(result.status).toBe(200); expect(result.body.sent).toBe(true);
    expect(deps.issue).toHaveBeenCalledWith('caller-jwt', input);
    const redirect = new URL(deps.sendInvite.mock.calls[0][1]);
    expect(redirect.origin + redirect.pathname).toBe('https://trakfootball.com/staff-invite');
    expect(redirect.searchParams.get('token')).toBe(token); expect(redirect.searchParams.get('flow')).toBe('new');
    expect(deps.finish).toHaveBeenCalledWith(id, attempt, 'sent');
    expect(JSON.stringify(result.body)).not.toContain(token);
    expect(deps.sendMagicLink).not.toHaveBeenCalled();
  });
  it('uses a fresh status check and a sign-in link for existing accounts', async () => {
    const deps = make(); deps.sendInvite.mockResolvedValue({ error: { code: 'email_exists', message: 'Already registered' } });
    expect((await run(deps)).body.sent).toBe(true);
    expect(deps.status).toHaveBeenCalledWith('caller-jwt', id);
    expect(deps.sendMagicLink).toHaveBeenCalledWith(input.email, expect.stringContaining('flow=existing'));
  });
  it.each(['revoked', 'accepted'])('does not fall back after invitation becomes %s', async state => {
    const deps = make(); deps.sendInvite.mockResolvedValue({ error: { code: 'email_exists', message: 'Already registered' } });
    deps.status.mockResolvedValue(ok({ state, delivery_state: 'sending', attempt_id: attempt, expires_at: expiry }));
    expect((await run(deps)).status).toBe(409); expect(deps.sendMagicLink).not.toHaveBeenCalled();
  });
  it('does not dispatch on a concurrent duplicate claim', async () => {
    const deps = make(); deps.issue.mockResolvedValue(ok({ invitation_id: id, token, replayed: false, dispatch: false, delivery_state: 'sending' }));
    expect((await run(deps)).status).toBe(202); expect(deps.sendInvite).not.toHaveBeenCalled();
  });
  it.each(['sending', 'sent', 'failed', 'not_sent'])('request retry reads %s without contacting mail', async state => {
    const deps = make(); deps.issue.mockResolvedValue(ok({ invitation_id: id, replayed: true }));
    deps.status.mockResolvedValue(ok({ state: 'pending', delivery_state: state, expires_at: expiry }));
    const result = await run(deps); expect(result.body.sent).toBe(state === 'sent');
    expect(deps.sendInvite).not.toHaveBeenCalled();
  });
  it('refuses malformed expiry on replay rather than claiming the email is current', async () => {
    const deps = make(); deps.issue.mockResolvedValue(ok({ invitation_id: id, replayed: true }));
    deps.status.mockResolvedValue(ok({ state: 'pending', delivery_state: 'sent', expires_at: 'bad-date' }));
    expect((await run(deps)).body.sent).toBe(false);
  });
  it('reports known provider rejection without fallback or raw provider data', async () => {
    const deps = make(); deps.sendInvite.mockResolvedValue({ error: { message: 'Private provider details and coach@test.invalid' } });
    const result = await run(deps); expect(result.status).toBe(502); expect(result.body.sent).toBe(false);
    expect(deps.finish).toHaveBeenCalledWith(id, attempt, 'failed'); expect(deps.sendMagicLink).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain('Private provider');
  });
  it('leaves a network timeout uncertain and never starts a second email', async () => {
    const deps = make(); deps.sendInvite.mockRejectedValue(new Error('Connection lost after dispatch'));
    const result = await run(deps); expect(result.status).toBe(202); expect(result.body.reason).toBe('delivery_unconfirmed');
    expect(deps.finish).not.toHaveBeenCalled(); expect(deps.sendMagicLink).not.toHaveBeenCalled();
  });
  it('does not claim confirmed success when recording the outcome failed', async () => {
    const deps = make(); deps.finish.mockResolvedValue({ error: { message: 'Network error' } });
    expect((await run(deps)).body.sent).toBe(false);
  });
  it('honors database denial and rate limits before provider calls', async () => {
    const deps = make(); deps.issue.mockResolvedValue({ data: null, error: { code: '42501', message: 'Forbidden' } });
    expect((await run(deps)).status).toBe(403);
    deps.issue.mockResolvedValue(ok({ invitation_id: id, token, replayed: false }));
    deps.issue.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Staff email limit reached' } });
    expect((await run(deps)).status).toBe(429); expect(deps.sendInvite).not.toHaveBeenCalled();
  });
});
