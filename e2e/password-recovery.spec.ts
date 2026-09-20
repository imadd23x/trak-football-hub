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
const recoveryHash = new URLSearchParams({ access_token: parentB.access_token, refresh_token: parentB.refresh_token,
  token_type: 'bearer', expires_in: '3600', type: 'recovery' });
async function fixture(page: Page, context: BrowserContext, remembered = true) {
  const errors: string[] = []; const unexpected: string[] = []; const writes: string[] = [];
  let saveFails = false; let pause: 'GET' | 'PUT' | null = null; let release = () => {};
  let paused = false;
  page.on('pageerror', error => errors.push(error.message));
  if (remembered) await context.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('recovery-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('recovery-fixture-seeded', '1');
    }
  }, { key: storageKey, value: parentA });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== backend) { if (!url.hostname.startsWith('fonts.')) unexpected.push(url.origin); return route.abort(); }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const current = request.headers().authorization === `Bearer ${parentB.access_token}` ? parentB : parentA;
    if (url.pathname === '/auth/v1/user' && ['GET', 'PUT'].includes(request.method())) {
      expect(request.headers().authorization).toBe(`Bearer ${current.access_token}`);
      if (request.method() === 'PUT') { expect(request.postDataJSON()).toEqual({ password: 'SyntheticPass1!' }); writes.push(current.user.id); }
      if (request.method() === pause) {
        pause = null; paused = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
      if (request.method() === 'PUT' && saveFails) { saveFails = false; return json({ message: 'Temporary failure' }, 503); }
      return json(current.user);
    }
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET') {
      expect(url.searchParams.get('user_id')).toBe(`eq.${current.user.id}`);
      const row = { id: current.user.id, user_id: current.user.id, role: 'parent', full_name: current === parentA ? 'Alex Parent' : 'Other Parent', nationality: null, invite_code: null };
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? row : [row]);
    }
    if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') {
      expect(url.searchParams.get('parent_user_id')).toBe(`eq.${current.user.id}`); return json([]);
    }
    if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') return json([]);
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unexpected synthetic request' }, 500);
  });
  return { errors, unexpected, writes, failSave: () => { saveFails = true; }, pauseNext: (method: 'GET' | 'PUT') => { pause = method; },
    isPaused: () => paused, release: () => release() };
}
async function fill(page: Page) {
  await page.getByLabel('New password', { exact: true }).fill('SyntheticPass1!');
  await page.getByLabel('Confirm password', { exact: true }).fill('SyntheticPass1!');
}
for (const width of [320, 390]) test(`recovery link targets its recipient and returns to account choice (${width}px)`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 844 }); const state = await fixture(page, context);
  await page.goto(`/reset-password#${recoveryHash}`);
  await expect(page.getByText(parentB.user.email, { exact: true })).toBeVisible();
  await expect(page.getByText(parentA.user.email, { exact: true })).toHaveCount(0);
  await fill(page); const reveal = page.getByRole('button', { name: 'Show new password', exact: true });
  await reveal.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath(`recovery-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Other Parent' })).toBeVisible();
  await expect(page).toHaveURL(`${app}/`); await page.reload();
  await expect(page.getByRole('button', { name: 'Continue as Other Parent' })).toBeVisible();
  expect(state.writes).toEqual([parentB.user.id]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('expired recovery does not offer to change the remembered account', async ({ page, context }) => {
  const state = await fixture(page, context); await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=Expired');
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('missing session reaches a usable sign-in route', async ({ page, context }) => {
  const state = await fixture(page, context, false); await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toContainText('missing or no longer available');
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('an unknown save outcome stays recoverable without a false success', async ({ page, context }, info) => {
  const state = await fixture(page, context); state.failSave(); await page.goto('/reset-password'); await fill(page);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toContainText('could not confirm whether');
  await expect(page.getByRole('button', { name: 'Update password' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('recovery-save-retry.png'), fullPage: true });
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  expect(state.writes).toEqual([parentA.user.id, parentA.user.id]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
for (const method of ['GET', 'PUT'] as const) test(`another tab's account switch invalidates a pending ${method}`, async ({ page, context }) => {
  const state = await fixture(page, context); await page.goto('/reset-password'); await fill(page);
  state.pauseNext(method); await page.getByRole('button', { name: 'Update password' }).click();
  await expect.poll(state.isPaused).toBe(true);
  // Simulate the other tab's storage write and broadcast; the real SDK's
  // BroadcastChannel listener and the rendered provider/page handle the event.
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    const channel = new BroadcastChannel(key); channel.postMessage({ event: 'SIGNED_IN', session: value }); channel.close();
  }, { key: storageKey, value: parentB });
  await expect(page.getByRole('alert')).toContainText('Your account changed');
  state.release();
  await page.getByRole('button', { name: 'Check account again' }).click();
  await expect(page.getByText(parentB.user.email, { exact: true })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await expect(page).toHaveURL(`${app}/reset-password`);
  expect(state.writes).toEqual(method === 'PUT' ? [parentA.user.id] : []);
  await fill(page); await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Other Parent' })).toBeVisible();
  expect(state.writes).toEqual(method === 'PUT' ? [parentA.user.id, parentB.user.id] : [parentB.user.id]);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
