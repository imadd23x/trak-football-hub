import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { CONSENT_STATEMENT } from '../src/lib/consent'

// Real Chromium, production bundle and SDK. All backend replies are synthetic
// and intercepted; this is local UI proof, never deployed-family acceptance.
const appOrigin = 'http://127.0.0.1:4189'
const backendOrigin = 'https://xbykbqolvqyqmipikuae.supabase.co'
const parentId = '98c00000-0000-4000-8000-000000000003'
const childId = '98c00000-0000-4000-8000-000000000040'
const rosterId = '98c00000-0000-4000-8000-000000000030'

async function loginFixture(page: Page, context: BrowserContext, role: 'parent' | 'player' | 'public') {
  const id = role === 'parent' ? parentId : childId
  const user = {
    id, email: role === 'parent' ? 'parent@child-login.test' : 'striker7@child.trakfootball.com',
    email_confirmed_at: '2026-09-30T08:00:00Z', created_at: '2026-09-30T08:00:00Z',
    aud: 'authenticated', role: 'authenticated',
    app_metadata: role === 'parent' ? { provider: 'email' } : { trak_child_login: true },
    user_metadata: {},
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  if (role !== 'public') await context.addInitScript(session => {
    localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session))
  }, { access_token: token, refresh_token: 'synthetic-child-login-refresh', expires_in: 3600,
    expires_at: expiresAt, token_type: 'bearer', user })

  const unexpected: string[] = [], errors: string[] = []
  const writes: { path: string; body: unknown }[] = []
  let approved = false, created = false, provisioned = false
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === appOrigin) return route.continue()
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.origin !== backendOrigin) { unexpected.push(request.url()); return route.abort() }
    if (request.method() !== 'GET') writes.push({ path: url.pathname, body: request.postData() ? request.postDataJSON() : null })
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') return json(user)
    if (url.pathname === '/rest/v1/profiles') {
      const profile = { id, user_id: id, full_name: role === 'parent' ? 'Synthetic Parent' : 'Ana Synthetic', role, nationality: null }
      return json(role === 'player' && !provisioned ? []
        : request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile])
    }
    if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') return json([])
    if (url.pathname === '/rest/v1/rpc/get_roster_children_awaiting_consent') return json(approved ? [] : [{ roster_child_id: rosterId, first_name: 'Ana', age_years: 13 }])
    if (url.pathname === '/rest/v1/rpc/get_my_child_logins') return json(approved
      ? [{ roster_child_id: rosterId, first_name: 'Ana', username: created ? 'striker7' : null, ready: created }] : [])
    if (url.pathname === '/rest/v1/rpc/record_roster_consent') { approved = true; return json('98c00000-0000-4000-8000-000000000050') }
    if (url.pathname === '/functions/v1/create-child-login') { created = true; return json({ username: 'striker7', state: 'created' }) }
    if (url.pathname === '/rest/v1/rpc/provision_my_profile') { provisioned = true; return json({ warnings: [] }) }
    if (url.pathname === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (url.pathname === '/rest/v1/rpc/get_player_invites_for_current_user') return json([])
    if (url.pathname === '/rest/v1/telemetry_events') return json(null, 201)
    if (request.method() === 'GET' && url.pathname.startsWith('/rest/v1/')) return json([])
    unexpected.push(`${request.method()} ${url.pathname}`)
    return json({ message: 'Unmodelled synthetic request blocked' }, 500)
  })
  return { unexpected, errors, writes }
}

test('parent approves and creates child credentials without an email request', async ({ page, context }, testInfo) => {
  const fixture = await loginFixture(page, context, 'parent')
  await page.goto('/parent/consent')
  await page.getByRole('checkbox', { name: CONSENT_STATEMENT }).check()
  await page.getByRole('button', { name: "Approve Ana's account" }).click()
  await expect(page.getByRole('heading', { name: "Create Ana's login" })).toBeVisible()
  await page.getByLabel("Child's username").fill('striker7')
  await page.getByLabel("Child's password", { exact: true }).fill('Synthetic-Pass7!')
  await page.getByLabel("Confirm child's password", { exact: true }).fill('Synthetic-Pass7!')
  await page.screenshot({ path: testInfo.outputPath('parent-create-login-local.png'), fullPage: true })
  await page.getByRole('button', { name: 'Create login', exact: true }).click()
  await expect(page.getByRole('heading', { name: "Ana's login is ready" })).toBeVisible()
  await expect(page.getByText('striker7', { exact: true })).toBeVisible()
  await expect(page.getByLabel("Child's password", { exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('child.trakfootball.com')
  expect(fixture.writes.filter(r => r.path === '/functions/v1/create-child-login').map(r => r.body))
    .toEqual([{ roster_child_id: rosterId, username: 'striker7', password: 'Synthetic-Pass7!' }])
  expect(fixture.writes.some(r => /invite|recover/.test(r.path))).toBe(false)
  expect(fixture.errors).toEqual([])
  expect(fixture.unexpected).toEqual([])
})

test('a guardian-created child finishes first run without setting the password again', async ({ page, context }, testInfo) => {
  const fixture = await loginFixture(page, context, 'player')
  await page.goto('/')
  await expect(page).toHaveURL(`${appOrigin}/onboarding/player`)
  await expect(page.getByLabel('New password')).toHaveCount(0)
  await page.getByLabel('Your name').fill('Ana Synthetic')
  await page.screenshot({ path: testInfo.outputPath('child-first-run-local.png'), fullPage: true })
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await expect(page).toHaveURL(`${appOrigin}/player/home`)
  await expect(page.locator('body')).not.toContainText('child.trakfootball.com')
  expect(fixture.writes.some(r => ['/auth/v1/user', '/auth/v1/recover', '/auth/v1/invite', '/auth/v1/otp', '/functions/v1/send-roster-invites'].includes(r.path))).toBe(false)
  expect(fixture.errors).toEqual([])
  expect(fixture.unexpected).toEqual([])
})

test('Forgot with no username or a pasted technical address directs recovery to the guardian', async ({ page, context }) => {
  const fixture = await loginFixture(page, context, 'public')
  await page.goto('/')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByText(/Forgot a child username\? Ask your parent or guardian/)).toBeVisible()
  await page.getByLabel('Email or username').fill('striker7@child.trakfootball.com ')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByText(/Ask your parent or guardian to set a new password/)).toBeVisible()
  expect(fixture.writes.some(r => /recover/.test(r.path))).toBe(false)
  expect(fixture.errors).toEqual([])
  expect(fixture.unexpected).toEqual([])
})
