import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const app = 'http://127.0.0.1:4189';
const backend = 'https://xbykbqolvqyqmipikuae.supabase.co';
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token';
function session(id: string, email: string) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, email, email_confirmed_at: '2026-09-20T00:00:00Z', aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-20T00:00:00Z' };
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expires_at, role: 'authenticated', email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  return { user, access_token, refresh_token: `synthetic-refresh-${id}`, token_type: 'bearer', expires_in: 3600, expires_at };
}
const parent = session('11111111-1111-4111-8111-111111111111', 'alex@family.test');
const recipient = session('22222222-2222-4222-8222-222222222222', 'recipient@family.test');
async function fixture(page: Page, context: BrowserContext, options: { remembered?: boolean; cleanupFails?: boolean; expired?: boolean; emailChange?: boolean } = {}) {
  const errors: string[] = []; const unexpected: string[] = []; const writes: string[] = [];
  let cleanupFails = !!options.cleanupFails;
  page.on('pageerror', error => errors.push(error.message));
  if (options.remembered) await context.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('confirmation-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('confirmation-fixture-seeded', '1');
    }
  }, { key: storageKey, value: parent });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== backend) { if (!url.hostname.startsWith('fonts.')) unexpected.push(url.origin); return route.abort(); }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/auth/v1/verify') {
      writes.push('verify'); expect(request.postDataJSON()).toMatchObject({ token_hash: 'synthetic-confirmation' });
      if (options.expired) return json({ code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
      return json(options.emailChange ? { msg: 'Confirm the other email address' } : recipient);
    }
    if (url.pathname === '/auth/v1/logout') {
      writes.push('logout'); expect(url.searchParams.get('scope')).toBe('local');
      expect(request.headers().authorization).toBe(`Bearer ${recipient.access_token}`);
      if (cleanupFails) { cleanupFails = false; return json({ message: 'Temporary failure' }, 503); }
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
      expect(request.headers().authorization).toBe(`Bearer ${parent.access_token}`); return json(parent.user);
    }
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET') {
      expect(request.headers().authorization).toBe(`Bearer ${parent.access_token}`);
      expect(url.searchParams.get('user_id')).toBe(`eq.${parent.user.id}`);
      const row = { id: parent.user.id, user_id: parent.user.id, role: 'parent', full_name: 'Alex Parent', nationality: null, invite_code: null };
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? row : [row]);
    }
    if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') {
      expect(request.headers().authorization).toBe(`Bearer ${parent.access_token}`);
      expect(url.searchParams.get('parent_user_id')).toBe(`eq.${parent.user.id}`); return json([]);
    }
    if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') {
      expect(request.headers().authorization).toBe(`Bearer ${parent.access_token}`); return json([]);
    }
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unexpected synthetic request' }, 500);
  });
  return { errors, unexpected, writes };
}
for (const width of [320, 390]) test(`confirmation preserves the remembered family on a ${width}px phone`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 844 }); const state = await fixture(page, context, { remembered: true });
  await page.goto('/auth/confirm?token_hash=synthetic-confirmation&type=signup');
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, storageKey)).toBe(parent.user.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath(`confirmation-${width}.png`), fullPage: true });
  const next = page.getByRole('link', { name: 'Continue to sign in' }); await next.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  expect(state.writes).toEqual(['verify', 'logout']); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('failed cleanup stays truthful and retries only the temporary session logout', async ({ page, context }, info) => {
  const state = await fixture(page, context, { remembered: true, cleanupFails: true });
  await page.goto('/auth/confirm?token_hash=synthetic-confirmation&type=signup');
  await expect(page.getByRole('alert')).toContainText('Your email is confirmed');
  await page.screenshot({ path: info.outputPath('confirmation-cleanup-retry.png'), fullPage: true });
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, storageKey)).toBe(parent.user.id);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  expect(state.writes).toEqual(['verify', 'logout', 'logout']); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('expired confirmation cannot replace the account already on the phone', async ({ page, context }) => {
  const state = await fixture(page, context, { remembered: true, expired: true });
  await page.goto('/auth/confirm?token_hash=synthetic-confirmation&type=signup');
  await expect(page.getByRole('alert')).toContainText('expired');
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alex Parent' })).toBeVisible();
  expect(state.writes).toEqual(['verify']); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('a recovery token sent to the confirmation route is not consumed', async ({ page, context }) => {
  const state = await fixture(page, context);
  await page.goto('/auth/confirm?token_hash=synthetic-confirmation&type=recovery');
  await expect(page.getByRole('alert')).toContainText('different action');
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('the first email-change confirmation asks for the other inbox', async ({ page, context }) => {
  const state = await fixture(page, context, { emailChange: true });
  await page.goto('/auth/confirm?token_hash=synthetic-confirmation&type=email_change');
  await expect(page.getByRole('heading', { name: 'Check your other inbox' })).toBeVisible();
  expect(state.writes).toEqual(['verify']); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
