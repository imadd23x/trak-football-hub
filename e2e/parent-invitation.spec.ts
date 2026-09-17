import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const appOrigin = 'http://127.0.0.1:4189';
const backendOrigin = 'https://xbykbqolvqyqmipikuae.supabase.co';
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token';
const playerId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';
const alexId = '33333333-3333-4333-8333-333333333333';
const zaraId = '44444444-4444-4444-8444-444444444444';
const alexInvite = '55555555-5555-4555-8555-555555555555';
const zaraInvite = '66666666-6666-4666-8666-666666666666';
const inviteToken = '77777777-7777-4777-8777-777777777777';
const unavailableToken = '88888888-8888-4888-8888-888888888888';
const parentEmail = 'parent@example.test';

function session(id: string, email: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id, email, email_confirmed_at: '2026-09-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-09-01T00:00:00Z',
  };
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated', email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  return { access_token: token, refresh_token: `synthetic-refresh-${id}`, expires_in: 3600, expires_at: expiresAt, token_type: 'bearer', user };
}

interface ObservedRequest {
  path: string;
  method: string;
  authorization: string | undefined;
  body: unknown;
}

async function invitationsFixture(page: Page, context: BrowserContext, initialAccount: 'player' | 'parent' | null = null, available = true) {
  const player = session(playerId, 'player@example.test');
  const parent = session(parentId, parentEmail);
  if (initialAccount) {
    await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: storageKey, value: initialAccount === 'player' ? player : parent,
    });
  }
  const invites = [
    { invite_id: alexInvite, player_user_id: alexId, player_name: 'Alex Example', parent_email: parentEmail },
    { invite_id: zaraInvite, player_user_id: zaraId, player_name: 'Zara Example', parent_email: parentEmail },
  ].map(invite => ({ ...invite, expires_at: new Date(Date.now() + 86_400_000).toISOString() }));
  const requests: ObservedRequest[] = [];
  const claims: ObservedRequest[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin) return route.continue();
    if (url.origin !== backendOrigin) {
      // Fonts are optional assets; every other unexpected external call fails.
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) unexpected.push(request.url());
      return route.abort();
    }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const observed = {
      path: url.pathname, method: request.method(), authorization: request.headers().authorization,
      body: request.postData() ? request.postDataJSON() as unknown : null,
    };
    requests.push(observed);
    const account = observed.authorization === `Bearer ${parent.access_token}` ? parent
      : observed.authorization === `Bearer ${player.access_token}` ? player : null;

    if (url.pathname === '/auth/v1/user' && request.method() === 'GET' && account) return json(account.user);
    if (url.pathname === '/auth/v1/logout' && request.method() === 'POST' && account) return route.fulfill({ status: 204 });
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST'
      && url.searchParams.get('grant_type') === 'password') {
      const credentials = observed.body as { email?: string; password?: string };
      if (credentials.email === parentEmail && credentials.password === 'ExistingParent1!') return json(parent);
      return json({ message: 'Invalid synthetic credentials' }, 400);
    }
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET' && account
      && url.searchParams.get('user_id') === `eq.${account.user.id}`) {
      const profile = {
        id: account.user.id, user_id: account.user.id, role: account === parent ? 'parent' : 'player',
        full_name: account === parent ? 'Existing Parent' : 'Existing Player', nationality: null,
      };
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile]);
    }
    if (account === parent) {
      if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') return json([]);
      if (request.method() === 'POST') {
        if (url.pathname === '/rest/v1/rpc/get_my_pending_parent_invites') return json(available ? invites : []);
        if (url.pathname === '/rest/v1/rpc/get_parent_invite_by_token') {
          return json(available && (observed.body as { p_token?: string }).p_token === inviteToken ? [{ id: alexInvite }] : []);
        }
        if (url.pathname === '/rest/v1/rpc/accept_parent_invite') {
          claims.push(observed);
          const id = (observed.body as { p_invite_id?: string }).p_invite_id;
          return json(id === zaraInvite ? zaraId : alexId);
        }
        if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') {
          return json(claims.length ? [{ player_user_id: zaraId, full_name: 'Zara Example', age_years: 14 }] : []);
        }
      }
    }
    // Includes all credential/profile changes, provisioning, emails and consent writes.
    unexpected.push(`${request.method()} ${url.pathname}`);
    return json({ message: 'Unmocked request blocked' }, 500);
  });
  return { requests, claims, unexpected, errors, parent, player };
}

test('public invitation reveals no child or recipient details before authentication', async ({ page, context }) => {
  const observed = await invitationsFixture(page, context);
  await page.goto(`/parent-invite?token=${inviteToken}`);
  await expect(page.getByRole('heading', { name: 'Parent invitation', exact: true })).toBeVisible();
  await expect(page.getByLabel('Your email address')).toBeVisible();
  await expect(page.getByText('Alex Example', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Zara Example', { exact: true })).toHaveCount(0);
  await expect(page.getByText(parentEmail, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Your email address')).toHaveValue('');
  expect(observed.requests.filter(request => request.path.includes('/rpc/'))).toEqual([]);
  expect(observed.claims).toEqual([]);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('shared phone switches from player to existing parent on the invitation and claims only the chosen child', async ({ page, context }, testInfo) => {
  const observed = await invitationsFixture(page, context, 'player');
  const invitationPath = `/parent-invite?token=${inviteToken}`;
  await page.goto(invitationPath);
  await expect(page.getByRole('alert')).toContainText('This account is not a parent account');
  await expect(page.getByText('Alex Example', { exact: true })).toHaveCount(0);
  expect(observed.requests.filter(request => request.path.includes('parent_invite'))).toEqual([]);

  await page.getByRole('button', { name: 'Sign out to use another account', exact: true }).click();
  await expect(page.getByLabel('Your email address')).toBeVisible();
  await expect(page).toHaveURL(appOrigin + invitationPath);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  expect(observed.requests.find(request => request.path === '/auth/v1/logout')?.authorization)
    .toBe(`Bearer ${observed.player.access_token}`);

  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await page.getByLabel('Your email address').fill(parentEmail);
  await page.getByLabel('Password', { exact: true }).fill('ExistingParent1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Link Alex Example', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link Zara Example', exact: true })).toBeVisible();
  await expect(page).toHaveURL(appOrigin + invitationPath);
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('existing-parent-invitations.png'), fullPage: true });

  await page.getByRole('button', { name: 'Link Zara Example', exact: true }).click();
  await expect(page).toHaveURL(appOrigin + '/parent/consent');
  await expect(page.getByRole('heading', { name: "Approve Zara's account", exact: true })).toBeVisible();
  expect(observed.claims).toEqual([{
    path: '/rest/v1/rpc/accept_parent_invite', method: 'POST',
    authorization: `Bearer ${observed.parent.access_token}`, body: { p_invite_id: zaraInvite },
  }]);
  expect(observed.requests.some(request => request.method === 'PUT' || request.method === 'PATCH'
    || request.path.includes('provision_my_profile') || request.path.includes('/functions/'))).toBe(false);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('expired or foreign invitation links produce a safe empty state for the verified parent', async ({ page, context }) => {
  const observed = await invitationsFixture(page, context, 'parent', false);
  for (const token of [inviteToken, unavailableToken]) {
    await page.goto(`/parent-invite?token=${token}`);
    await expect(page.getByRole('heading', { name: 'No active invitations', exact: true })).toBeVisible();
    await expect(page.getByText('This link is no longer active or is not available for this account.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Link / })).toHaveCount(0);
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Alex Example', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Zara Example', { exact: true })).toHaveCount(0);
  }
  expect(observed.claims).toEqual([]);
  expect(observed.requests.filter(request => request.path.startsWith('/auth/') && request.method !== 'GET')).toEqual([]);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});
