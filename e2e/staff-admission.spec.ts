import { test, expect, type BrowserContext, type Page } from '@playwright/test';
const app = 'http://127.0.0.1:4189';
const backend = 'https://xbykbqolvqyqmipikuae.supabase.co';
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token';
const uid = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const invite = '33333333-3333-4333-8333-333333333333';
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaabbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function account() {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: uid, email: 'staff@example.test', email_confirmed_at: '2026-09-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' };
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: uid, exp: expires_at, role: 'authenticated', email: user.email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  return { user, access_token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at };
}
async function fixture(page: Page, context: BrowserContext, admin = false, emailRejection = false) {
  const session = account(); let active = admin; let legacyCode: string | null = null;
  const observed: { method: string; path: string; body: Record<string, unknown> | null; authorization?: string }[] = [];
  const unexpected: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  if (admin) await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: session });
  let sendCount = 0;
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== backend) { if (!url.hostname.startsWith('fonts.')) unexpected.push(request.url()); return route.abort(); }
    const body = request.postData() ? request.postDataJSON() : null;
    observed.push({ method: request.method(), path: url.pathname, body, authorization: request.headers().authorization });
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/auth/v1/user') return json(session.user);
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET') {
      const row = active ? { id: uid, user_id: uid, role: admin ? 'club' : 'coach', full_name: 'Synthetic Staff', nationality: null, invite_code: legacyCode } : null;
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? row : row ? [row] : []);
    }
    // Current coach home still creates a legacy display code. Assert this narrow
    // write explicitly; removing shared-code admission belongs to the roster cutover.
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'PATCH') {
      expect(active).toBe(true); expect(admin).toBe(false);
      expect(url.searchParams.get('user_id')).toBe(`eq.${uid}`);
      expect(request.headers().authorization).toBe(`Bearer ${session.access_token}`);
      expect(Object.keys(body)).toEqual(['invite_code']);
      expect(body.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      legacyCode = body.invite_code;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/rest/v1/telemetry_events') return json(null, 201);
    if (url.pathname === '/rest/v1/rpc/inspect_staff_invite') return json({ role: 'coach', academy_name: 'Synthetic Academy', state: active ? 'accepted' : 'pending', expires_at: '2027-01-01T00:00:00Z' });
    if (url.pathname === '/rest/v1/rpc/accept_staff_invite') {
      expect(body.p_token).toBe(token); expect(request.headers().authorization).toBe(`Bearer ${session.access_token}`); active = true;
      return json({ role: 'coach', organization_id: org, replayed: false });
    }
    if (url.pathname === '/rest/v1/rpc/staff_invitation_context') return json({ can_invite_academies: false,
      academies: [{ id: org, name: 'Synthetic Academy' }], invitations: [] });
    if (url.pathname === '/functions/v1/send-staff-invite') {
      sendCount++;
      if (emailRejection) return json({ sent: false, invitation_id: invite, reason: 'email_rejected',
        message: 'The email provider rejected this send. Check the address before sending a replacement invitation.' }, 502);
      return sendCount === 1 ? json({ sent: false, invitation_id: invite, reason: 'delivery_unconfirmed', message: 'Sending could not be confirmed. Check the invitation status before choosing to send a replacement.' }, 202)
        : json({ sent: true, invitation_id: invite, replayed: true, message: 'The email provider accepted this invitation for sending.' });
    }
    if (request.method() === 'GET' && ['/rest/v1/coach_details', '/rest/v1/squad_players', '/rest/v1/coach_assessments', '/rest/v1/coach_sessions', '/rest/v1/recognition_awards', '/rest/v1/matches', '/rest/v1/coach_calendar_events'].includes(url.pathname)) return json([]);
    unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unimplemented synthetic endpoint' }, 500);
  });
  return { session, observed, unexpected, errors };
}
const overflow = async (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test('new staff activation through the actual Auth email fragment chooses a password and reaches coach home', async ({ page, context }, info) => {
  const state = await fixture(page, context);
  const hash = new URLSearchParams({ access_token: state.session.access_token, refresh_token: state.session.refresh_token, expires_in: '3600', token_type: 'bearer', type: 'invite' });
  await page.goto(`${app}/staff-invite?token=${token}&flow=new#${hash}`);
  await expect(page.getByLabel('Full name', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('staff-activation.png'), fullPage: true });
  expect(await overflow(page)).toBe(false);
  await page.getByLabel('Full name', { exact: true }).fill('Synthetic Staff');
  await page.getByLabel('New password', { exact: true }).fill('StrongStaff1!');
  await page.getByRole('button', { name: 'Show new password' }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByLabel('Confirm password', { exact: true }).fill('StrongStaff1!');
  await page.getByRole('button', { name: 'Activate access', exact: true }).click();
  await expect(page).toHaveURL(/\/coach\/home$/);
  await expect.poll(() => state.observed.filter(row => row.path === '/rest/v1/profiles' && row.method === 'PATCH').length).toBe(1);
  expect(state.observed.filter(row => row.path === '/auth/v1/user' && row.body?.password)).toHaveLength(1);
  expect(state.observed.filter(row => row.path.endsWith('/accept_staff_invite'))).toHaveLength(1);
  expect(state.observed.some(row => row.path.endsWith('/provision_my_profile'))).toBe(false);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('academy email retry keeps the same request and reports uncertain delivery honestly', async ({ page, context }, info) => {
  const state = await fixture(page, context, true);
  await page.goto(`${app}/staff/invitations`);
  await page.getByLabel('Recipient email').fill('coach@example.test');
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByText(/Sending could not be confirmed/)).toBeVisible();
  await expect(page.getByLabel('Recipient email')).toBeDisabled();
  await page.getByRole('button', { name: 'Check or retry this request' }).click();
  await expect(page.getByText('The email provider accepted this invitation for sending.')).toBeVisible();
  const sends = state.observed.filter(row => row.path.endsWith('/send-staff-invite'));
  expect(sends).toHaveLength(2); expect(sends[0].body).toEqual(sends[1].body);
  await page.screenshot({ path: info.outputPath('staff-invitations.png'), fullPage: true });
  expect(await overflow(page)).toBe(false); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('public staff signup is replaced by invitation guidance on small and landscape screens', async ({ page, context }) => {
  const state = await fixture(page, context);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const role of ['coach', 'club']) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${app}/onboarding/${role}`);
    await expect(page.getByRole('heading', { name: 'Join through your academy' })).toBeVisible();
    await expect(page.getByRole('button', { name: /create|sign up/i })).toHaveCount(0);
    expect(await overflow(page)).toBe(false);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    expect(await overflow(page)).toBe(false);
  }
  expect(state.observed.some(row => row.path.includes('/signup') || row.path.endsWith('/provision_my_profile'))).toBe(false);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});


test('an actual non-2xx function response preserves the provider rejection message', async ({ page, context }) => {
  const state = await fixture(page, context, true, true);
  await page.goto(`${app}/staff/invitations`);
  await page.getByLabel('Recipient email').fill('coach@example.test');
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(/email provider rejected this send/);
  await expect(page.getByText(/accepted this invitation for sending/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Check or retry this request' }).click();
  await expect(page.getByRole('button', { name: 'Check or retry this request' })).toBeEnabled();
  const sends = state.observed.filter(row => row.path.endsWith('/send-staff-invite'));
  expect(sends).toHaveLength(2); expect(sends[1].body).toEqual(sends[0].body);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
