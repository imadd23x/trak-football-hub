import { test, expect } from '@playwright/test';

test('acknowledged deletion survives reload and retries only logout', async ({ page, context }, testInfo) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const user = { id, email: 'deleted@example.test', email_confirmed_at: '2026-09-01T00:00:00Z',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  await context.addInitScript(session => {
    if (!sessionStorage.getItem('deletion-fixture-initialized')) {
      localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session));
      sessionStorage.setItem('deletion-fixture-initialized', '1');
    }
  }, { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user });
  let deletions = 0, profileReads = 0, logoutFails = true;
  const unexpected: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4189') return route.continue();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.origin !== 'https://xbykbqolvqyqmipikuae.supabase.co') {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) unexpected.push(request.url());
      return route.abort();
    }
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/profiles') {
      profileReads++;
      return json({ id, user_id: id, role: 'parent', full_name: 'Synthetic Parent', nationality: null, avatar_url: null });
    }
    if (['/rest/v1/player_parent_links', '/rest/v1/rpc/get_children_awaiting_consent'].includes(url.pathname)) return json([]);
    if (url.pathname === '/rest/v1/telemetry_events') return json(null, 201);
    if (url.pathname === '/rest/v1/rpc/delete_my_account' && request.method() === 'POST') {
      expect(request.headers().authorization).toBe(`Bearer ${token}`);
      deletions++;
      return json(null);
    }
    if (url.pathname === '/auth/v1/logout' && request.method() === 'POST') {
      return logoutFails ? json({ message: 'Synthetic outage' }, 500) : route.fulfill({ status: 204 });
    }
    unexpected.push(request.method() + ' ' + url.pathname);
    return route.abort();
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('heading', { name: 'Account deleted' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish signing out' })).toBeEnabled();
  const beforeReload = profileReads;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account deleted' })).toBeVisible();
  expect(profileReads).toBe(beforeReload);
  await expect(page.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('deleted-account-retry.png'), fullPage: true });
  logoutFails = false;
  await page.getByRole('button', { name: 'Finish signing out' }).click();
  await expect(page.getByRole('heading', { name: 'Account deleted' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sb-xbykbqolvqyqmipikuae-auth-token'))).toBeNull();
  expect(deletions).toBe(1);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
