import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { Session, User } from '@supabase/supabase-js';
import { server } from '../../../tests/msw/server';
import { createOnboardingSession } from '../onboarding-session';

const url = 'https://test.supabase.co';
const user = (id: string): User => ({
  id, aud: 'authenticated', app_metadata: {}, created_at: '2026-09-18T00:00:00Z',
  user_metadata: { trak_onboarding: { full_name: `Verified ${id}` } },
});
const session = (id: string) => ({
  access_token: `captured-token-${id}`, refresh_token: `refresh-${id}`, user: user(id),
}) as Session;

describe('onboarding uses a captured token with the real Supabase SDK', () => {
  it.each([false, true])('binds verification, provisioning, email and metadata cleanup to A after the browser holds B (cancellable=%s)', async cancellable => {
    const requests: { path: string; authorization: string | null; body?: unknown }[] = [];
    server.use(
      http.get(`${url}/auth/v1/user`, ({ request }) => {
        requests.push({ path: 'verify', authorization: request.headers.get('Authorization') });
        return HttpResponse.json(user('a'));
      }),
      http.post(`${url}/rest/v1/rpc/provision_my_profile`, async ({ request }) => {
        requests.push({ path: 'provision', authorization: request.headers.get('Authorization'), body: await request.json() });
        return HttpResponse.json({ warnings: [] });
      }),
      http.post(`${url}/functions/v1/send-parent-invite`, ({ request }) => {
        requests.push({ path: 'email', authorization: request.headers.get('Authorization') });
        return HttpResponse.json({ sent: true });
      }),
      http.put(`${url}/auth/v1/user`, async ({ request }) => {
        requests.push({ path: 'cleanup', authorization: request.headers.get('Authorization'), body: await request.json() });
        return HttpResponse.json(user('a'));
      }),
    );
    const account = await createOnboardingSession(session('a'), cancellable ? new AbortController().signal : undefined);
    const browserSession = JSON.stringify(session('b'));
    localStorage.setItem('sb-test-auth-token', browserSession);

    expect(account.user.user_metadata.trak_onboarding.full_name).toBe('Verified a');
    await account.client.rpc('provision_my_profile' as never, { p: { full_name: 'A' } } as never);
    await account.client.functions.invoke('send-parent-invite');
    await account.clearPendingProfile();

    expect(requests.map(request => request.path)).toEqual(['verify', 'provision', 'email', 'cleanup']);
    expect(requests.every(request => request.authorization === 'Bearer captured-token-a')).toBe(true);
    expect(requests[3].body).toEqual({ data: { trak_onboarding: null } });
    expect(localStorage.getItem('sb-test-auth-token')).toBe(browserSession);
  });

  it('rejects a token whose verified account differs from the cached account', async () => {
    server.use(http.get(`${url}/auth/v1/user`, () => HttpResponse.json(user('b'))));
    await expect(createOnboardingSession(session('a'))).rejects.toThrow('Your account changed');
  });

  it('rejects expired authentication without rotating a refresh token or replacing browser storage', async () => {
    const refresh = vi.fn();
    server.use(
      http.get(`${url}/auth/v1/user`, () => HttpResponse.json({ message: 'JWT expired' }, { status: 401 })),
      http.post(`${url}/auth/v1/token`, () => { refresh(); return HttpResponse.json({}); }),
    );
    const browserSession = JSON.stringify(session('b'));
    localStorage.setItem('sb-test-auth-token', browserSession);
    await expect(createOnboardingSession(session('a'))).rejects.toThrow('JWT expired');
    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem('sb-test-auth-token')).toBe(browserSession);
  });
});
