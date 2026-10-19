import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const app = 'http://127.0.0.1:4189';
const backend = 'https://xbykbqolvqyqmipikuae.supabase.co';
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token';
function session(id: string, name: string) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, email: `${name}@account.test`, email_confirmed_at: '2026-09-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' };
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expires_at, role: 'authenticated', email: user.email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  return { user, access_token, refresh_token: `synthetic-refresh-${name}`, token_type: 'bearer', expires_in: 3600, expires_at };
}
const parentA = session('11111111-1111-4111-8111-111111111111', 'alex');
const parentB = session('22222222-2222-4222-8222-222222222222', 'other');
async function fixture(page: Page, context: BrowserContext, options: { remembered?: boolean; failLogout?: boolean; missingProfile?: boolean } = {}) {
  const errors: string[] = []; const unexpected: string[] = []; const writes: string[] = [];
  let logoutFails = !!options.failLogout; let passwordFails = false; let profileReady = !options.missingProfile;
  page.on('pageerror', error => errors.push(error.message));
  if (options.remembered) await context.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('account-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('account-fixture-seeded', '1');
    }
  }, { key: storageKey, value: parentA });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== backend) { if (!url.hostname.startsWith('fonts.')) unexpected.push(url.origin); return route.abort(); }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const current = request.headers().authorization === `Bearer ${parentB.access_token}` ? parentB : parentA;
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') return json(current.user);
    if (url.pathname === '/auth/v1/user' && request.method() === 'PUT') {
      expect(request.postDataJSON()).toEqual({ password: 'SyntheticPass1!', code_challenge: null, code_challenge_method: null }); writes.push('password-update'); return json(current.user);
    }
    if (url.pathname === '/auth/v1/logout') {
      writes.push('logout'); if (logoutFails) { logoutFails = false; return json({ message: 'Temporarily unavailable' }, 503); }
      return json({});
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      writes.push('password-sign-in');
      expect(request.postDataJSON()).toMatchObject({ email: parentB.user.email, password: 'synthetic-password' });
      if (passwordFails) { passwordFails = false; return json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400); }
      return json(parentB);
    }
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET') {
      expect(url.searchParams.get('user_id')).toBe(`eq.${current.user.id}`);
      const row = profileReady ? { id: current.user.id, user_id: current.user.id, role: 'parent',
        full_name: current === parentA ? 'Alex Parent' : 'Other Parent', nationality: null, invite_code: null } : null;
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? row : row ? [row] : []);
    }
    if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') {
      expect(url.searchParams.get('parent_user_id')).toBe(`eq.${current.user.id}`); return json([]);
    }
    if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') return json([]);
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unexpected synthetic request' }, 500);
  });
  return { errors, unexpected, writes, failPassword: () => { passwordFails = true; }, restoreProfile: () => { profileReady = true; } };
}
for (const width of [320, 390]) test(`remembered parent chooses explicitly, including after reload (${width}px)`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 844 }); const state = await fixture(page, context, { remembered: true });
  await page.goto('/'); const next = page.getByRole('button', { name: 'Continue as Alex Parent' });
  await expect(next).toBeVisible(); await expect(page).toHaveURL(`${app}/`);
  await page.reload(); await expect(next).toBeVisible(); await expect(page).toHaveURL(`${app}/`);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath(`account-choice-${width}.png`), fullPage: true });
  await next.focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(`${app}/parent/home`);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('failed logout and password sign-in both recover before switching families', async ({ page, context }) => {
  const state = await fixture(page, context, { remembered: true, failLogout: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with another account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeEnabled();
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in with another account' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  state.failPassword(); await page.getByLabel('Email', { exact: true }).fill(parentB.user.email);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(parentB.user.email);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page).toHaveURL(`${app}/parent/home`);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, storageKey)).toBe(parentB.user.id);
  expect(state.writes).toEqual(['logout', 'logout', 'password-sign-in', 'password-sign-in']);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('an Auth email fragment does not skip the account-choice screen', async ({ page, context }) => {
  const state = await fixture(page, context);
  const hash = new URLSearchParams({ access_token: parentA.access_token, refresh_token: parentA.refresh_token,
    token_type: 'bearer', expires_in: '3600', type: 'signup' });
  await page.goto(`/#${hash}`); await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  await expect(page).toHaveURL(url => url.origin === app && url.pathname === '/' && url.hash === '');
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('an unavailable profile can recover without being sent to a parent invitation', async ({ page, context }) => {
  const state = await fixture(page, context, { remembered: true, missingProfile: true }); await page.goto('/');
  await expect(page.getByText(/Your account access is not available yet/)).toBeVisible(); await expect(page).toHaveURL(`${app}/`);
  state.restoreProfile(); await page.getByRole('button', { name: 'Check access again' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible(); await expect(page).toHaveURL(`${app}/`);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('password reset returns to a deliberate account choice', async ({ page, context }) => {
  const state = await fixture(page, context, { remembered: true }); await page.goto('/reset-password');
  await page.getByLabel('New password', { exact: true }).fill('SyntheticPass1!');
  await page.getByLabel('Confirm password', { exact: true }).fill('SyntheticPass1!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  await expect(page).toHaveURL(`${app}/`); expect(state.writes).toEqual(['password-update']);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
