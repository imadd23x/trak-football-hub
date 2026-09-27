import { registerAuthUser } from '../msw/auth-sessions'

/**
 * supabase-js derives its storage key from the project URL's first hostname
 * label. vitest.config.ts pins VITE_SUPABASE_URL to https://test.supabase.co,
 * so the key is always sb-test-auth-token. Seeding a non-expired session here
 * means getSession() resolves from localStorage with no network call.
 */
const STORAGE_KEY = 'sb-test-auth-token'

export function signInAs(user: { id: string; email?: string }): void {
  const now = Math.floor(Date.now() / 1000)
  // A test may fake Date (vi.useFakeTimers({ toFake: ['Date'] })); performance
  // stays real. Expire an hour after the later of the two clocks, so the session
  // is never stale on either: a stale one gets refreshed, the harness refuses
  // every refresh, and the failure wipes whatever session is stored by then.
  const realNow = Math.floor((performance.timeOrigin + performance.now()) / 1000)
  const expiresAt = Math.max(now, realNow) + 3600
  const authUser = {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email ?? `${user.id}@example.test`,
    email_confirmed_at: new Date(now * 1000).toISOString(),
    app_metadata: {},
    user_metadata: {},
    created_at: new Date(now * 1000).toISOString(),
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      access_token: registerAuthUser(authUser),
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: authUser,
    }),
  )
}
