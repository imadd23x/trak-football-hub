import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const app = 'http://127.0.0.1:4189';
const backend = 'https://xbykbqolvqyqmipikuae.supabase.co';
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token';
function session(id: string, name: string) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, email: `${name}@family.test`, email_confirmed_at: '2026-09-20T00:00:00Z', aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' };
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expires_at, role: 'authenticated', email: user.email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  return { user, access_token, refresh_token: `synthetic-refresh-${id}`, token_type: 'bearer', expires_in: 3600, expires_at };
}
const parentA = session('11111111-1111-4111-8111-111111111111', 'alex');
const parentB = session('22222222-2222-4222-8222-222222222222', 'other');
async function fixture(page: Page, context: BrowserContext, phase?: 'auth' | 'profile') {
  const errors: string[] = []; const unexpected: string[] = []; const profileReads: string[] = []; const aborted: string[] = [];
  let pause = phase; let paused = false; let release = () => {}; let profileFails = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().startsWith(backend) && request.failure()?.errorText.includes('ABORTED')) aborted.push(new URL(request.url()).pathname);
  });
  await context.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('profile-fixture-seeded')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('profile-fixture-seeded', '1'); }
  }, { key: storageKey, value: parentA });
  const hold = async () => { pause = undefined; paused = true; await new Promise<void>(resolve => { release = resolve; }); };
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== backend) { if (!url.hostname.startsWith('fonts.')) unexpected.push(url.origin); return route.abort(); }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const current = request.headers().authorization === `Bearer ${parentB.access_token}` ? parentB : parentA;
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
      if (pause === 'auth') await hold(); return json(current.user);
    }
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET') {
      expect(url.searchParams.get('user_id')).toBe(`eq.${current.user.id}`); profileReads.push(current.user.id);
      if (pause === 'profile') await hold();
      if (profileFails) { profileFails = false; return json({ message: 'Synthetic offline profile' }, 503); }
      const row = { id: current.user.id, user_id: current.user.id, role: 'parent', full_name: current === parentA ? 'Alex Parent' : 'Other Parent', nationality: null, avatar_url: null };
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? row : [row]);
    }
    if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') {
      expect(url.searchParams.get('parent_user_id')).toBe(`eq.${current.user.id}`); return json([]);
    }
    if (['/rest/v1/rpc/get_children_awaiting_consent', '/rest/v1/rpc/get_my_pending_parent_invites'].includes(url.pathname)) return json([]);
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unexpected synthetic request' }, 500);
  });
  return { errors, unexpected, profileReads, aborted, failProfile: () => { profileFails = true; }, isPaused: () => paused, release: () => release() };
}
test('a real 20-second Auth stall returns actionable account choice on a phone', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 320, height: 844 }); const state = await fixture(page, context, 'auth');
  await page.goto('/'); await expect.poll(state.isPaused).toBe(true);
  await expect(page.getByRole('status')).toHaveText('Checking your account…');
  await expect(page.getByRole('alert')).toContainText('too long', { timeout: 26_000 });
  await expect.poll(() => state.aborted.includes('/auth/v1/user')).toBe(true);
  const retry = page.getByRole('button', { name: 'Check access again' }); await expect(retry).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('profile-auth-timeout-320.png'), fullPage: true });
  state.release(); await retry.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  expect(state.profileReads).toEqual([parentA.user.id, parentA.user.id]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('a real profile stall cannot leave a protected route blank or bypass its gate', async ({ page, context }, info) => {
  const state = await fixture(page, context, 'profile'); await page.goto('/settings');
  await expect(page.getByRole('status', { name: 'Account access' })).toHaveText('Checking your account…');
  await expect(page.getByRole('alert')).toContainText('too long', { timeout: 26_000 });
  await expect.poll(() => state.aborted.includes('/rest/v1/profiles')).toBe(true);
  await expect(page.getByRole('button', { name: 'Send reset email' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('profile-route-timeout-390.png'), fullPage: true });
  state.release(); await page.getByRole('button', { name: 'Retry setup' }).click();
  await expect(page.getByRole('button', { name: 'Alex Parent', exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${app}/settings`); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('another family arriving during the initial lookup cancels the old request', async ({ page, context }) => {
  const state = await fixture(page, context, 'auth'); await page.goto('/'); await expect.poll(state.isPaused).toBe(true);
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value)); const channel = new BroadcastChannel(key);
    channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
  }, { key: storageKey, value: parentB });
  await expect(page.getByRole('button', { name: 'Continue as Other Parent' })).toBeVisible();
  await expect.poll(() => state.aborted.includes('/auth/v1/user')).toBe(true); state.release();
  expect(state.profileReads).toEqual([parentB.user.id]); await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('a rejected profile load has a same-page retry without inventing an account role', async ({ page, context }) => {
  const state = await fixture(page, context); state.failProfile(); await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load your account access');
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check access again' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  expect(state.profileReads).toEqual([parentA.user.id, parentA.user.id]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
