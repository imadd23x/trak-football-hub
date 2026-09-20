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
async function fixture(page: Page, context: BrowserContext, remembered = false) {
  const errors: string[] = []; const unexpected: string[] = []; const recipients: string[] = [];
  let nextStatus = 200; let pause: 'check' | 'send' | null = null; let paused = false; let release = () => {};
  page.on('pageerror', error => errors.push(error.message));
  if (remembered) await context.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('reset-email-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('reset-email-fixture-seeded', '1');
    }
  }, { key: storageKey, value: parentA });
  const hold = async () => { pause = null; paused = true; await new Promise<void>(resolve => { release = resolve; }); };
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== backend) { if (!url.hostname.startsWith('fonts.')) unexpected.push(url.origin); return route.abort(); }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const current = request.headers().authorization === `Bearer ${parentB.access_token}` ? parentB : parentA;
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
      if (pause === 'check') await hold(); return json(current.user);
    }
    if (url.pathname === '/auth/v1/recover' && request.method() === 'POST') {
      expect(url.searchParams.get('redirect_to')).toBe(`${app}/reset-password`);
      expect([`Bearer ${parentA.access_token}`, `Bearer ${parentB.access_token}`]).not.toContain(request.headers().authorization);
      recipients.push(request.postDataJSON().email);
      const status = nextStatus; nextStatus = 200;
      if (pause === 'send') await hold();
      return json(status === 200 ? {} : { code: 'synthetic_error', msg: 'Private provider detail' }, status);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      expect(request.postDataJSON()).toMatchObject({ email: parentB.user.email, password: 'SyntheticPass1!' }); return json(parentB);
    }
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET') {
      expect(url.searchParams.get('user_id')).toBe(`eq.${current.user.id}`);
      const row = { id: current.user.id, user_id: current.user.id, role: 'parent', full_name: current === parentA ? 'Alex Parent' : 'Other Parent', nationality: null, invite_code: null, avatar_url: null };
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? row : [row]);
    }
    if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') {
      expect(url.searchParams.get('parent_user_id')).toBe(`eq.${current.user.id}`); return json([]);
    }
    if (['/rest/v1/rpc/get_children_awaiting_consent', '/rest/v1/rpc/get_my_pending_parent_invites'].includes(url.pathname)) return json([]);
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unexpected synthetic request' }, 500);
  });
  return { errors, unexpected, recipients, failNext: (status: number) => { nextStatus = status; },
    pauseNext: (phase: 'check' | 'send') => { pause = phase; }, isPaused: () => paused, release: () => release() };
}
for (const width of [320, 390]) test(`forgotten password has keyboard feedback and does not promise delivery (${width}px)`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 844 }); const state = await fixture(page, context); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('alex@family.test');
  const button = page.getByRole('button', { name: 'Forgot password?' }); await button.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Password reset request' })).toContainText('If this email is registered');
  await expect(page.getByLabel('Password', { exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath(`reset-email-${width}.png`), fullPage: true });
  expect(state.recipients).toEqual(['alex@family.test']); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('rate rejection recovers and normal sign-in still works', async ({ page, context }) => {
  const state = await fixture(page, context); state.failNext(429); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(parentB.user.email); await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('alert', { name: 'Password reset request' })).toContainText('Too many requests');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('status', { name: 'Password reset request' })).toContainText('If this email is registered');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPass1!'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${app}/parent/home`);
  expect(state.recipients).toEqual([parentB.user.email, parentB.user.email]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('editing email cancels waiting feedback and lets the new recipient request', async ({ page, context }) => {
  const state = await fixture(page, context); state.pauseNext('send'); await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(parentA.user.email); await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect.poll(state.isPaused).toBe(true); await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeDisabled();
  await page.getByLabel('Email', { exact: true }).fill(parentB.user.email); state.release();
  await expect(page.getByRole('status', { name: 'Password reset request' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('status', { name: 'Password reset request' })).toContainText('If this email is registered');
  expect(state.recipients).toEqual([parentA.user.email, parentB.user.email]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
for (const phase of ['check', 'send'] as const) test(`Settings switches family during ${phase} without reusing A's reset request`, async ({ page, context }, info) => {
  await page.setViewportSize({ width: phase === 'check' ? 320 : 390, height: 844 });
  const state = await fixture(page, context, true); await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Alex Parent', exact: true })).toBeVisible();
  state.pauseNext(phase); await page.getByRole('button', { name: 'Send reset email' }).click(); await expect.poll(state.isPaused).toBe(true);
  await expect(page.getByRole('button', { name: 'Send reset email' })).toBeDisabled();
  // The notification is synthetic; the SDK's listener, provider and keyed
  // Settings form are the production code in the built app.
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    const channel = new BroadcastChannel(key); channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
  }, { key: storageKey, value: parentB });
  await expect(page.getByRole('button', { name: 'Other Parent', exact: true })).toBeVisible(); state.release();
  await expect(page.getByRole('status', { name: 'Password reset request' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send reset email' }).click();
  await expect(page.getByRole('status', { name: 'Password reset request' })).toContainText('If this email is registered');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath(`settings-reset-email-${phase}.png`), fullPage: true });
  expect(state.recipients).toEqual(phase === 'check' ? [parentB.user.email] : [parentA.user.email, parentB.user.email]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, storageKey)).toBe(parentB.user.id);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
