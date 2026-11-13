import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { CONSENT_NOTICE_VERSION, consentStatement } from '../src/lib/consent'

// Production bundle, real router/AuthProvider/Supabase SDK, mobile viewport.
// Only local assets may reach the network. Every backend request is synthetic;
// this proves UI recovery, not the deferred backend consent-policy contract.
const appOrigin = 'http://127.0.0.1:4189'
const backendOrigin = 'https://xbykbqolvqyqmipikuae.supabase.co'
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token'
const parentId = '99000000-0000-4000-8000-000000000101'
const childA = { player_user_id: '99000000-0000-4000-8000-000000000001', full_name: 'Alex Synthetic', age_years: 12 }
const childB = { player_user_id: '99000000-0000-4000-8000-000000000002', full_name: 'Blair Synthetic', age_years: 13 }
const consentId = '99000000-0000-4000-8000-000000000003'
interface Reply { data: unknown; status?: number }
interface ObservedRequest { method: string; path: string; authorization: string | undefined; body: unknown }

function expectedGrant(childId: string, first = childId === childB.player_user_id ? 'Blair' : 'Alex') {
  return {
    p_player_user_id: childId,
    p_relationship: 'parent',
    p_purposes: { coaching_records: true, recognition: false },
    p_notice_version: CONSENT_NOTICE_VERSION,
    p_consent_text: consentStatement(first),
  }
}

async function consentFixture(page: Page, context: BrowserContext, replies: Reply[], holdFirstGrant = false, clearAfterGrant = false) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const user = {
    id: parentId, email: 'parent@consent.test.invalid', email_confirmed_at: '2026-09-18T08:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-09-18T08:00:00Z',
  }
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: parentId, exp: expiresAt, role: 'authenticated', email: user.email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  const session = { access_token: token, refresh_token: 'synthetic-consent-refresh', expires_in: 3600,
    expires_at: expiresAt, token_type: 'bearer', user }
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: session })

  const unexpected: string[] = [], errors: string[] = []
  const requests: ObservedRequest[] = [], pending: ObservedRequest[] = [], grants: ObservedRequest[] = []
  let releaseGrant!: () => void
  const heldGrant = new Promise<void>(resolve => { releaseGrant = resolve })
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === appOrigin) return route.continue()
    if (url.origin !== backendOrigin) {
      unexpected.push(`${request.method()} ${request.url()}`)
      return route.abort()
    }
    const observed: ObservedRequest = {
      method: request.method(), path: url.pathname, authorization: request.headers().authorization,
      body: request.postData() ? request.postDataJSON() as unknown : null,
    }
    requests.push(observed)
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (observed.authorization !== `Bearer ${token}`) {
      unexpected.push(`Unexpected account: ${observed.method} ${url.pathname}`)
      return json({ message: 'Unknown synthetic account' }, 401)
    }
    if (url.pathname === '/auth/v1/user' && observed.method === 'GET') return json(user)
    if (url.pathname === '/rest/v1/telemetry_events' && observed.method === 'POST') return json(null, 201)
    if (url.pathname === '/rest/v1/profiles' && observed.method === 'GET'
      && url.searchParams.get('user_id') === `eq.${parentId}` && ['*', 'role'].includes(url.searchParams.get('select') ?? '')) {
      const profile = url.searchParams.get('select') === 'role' ? { role: 'parent' }
        : { id: parentId, user_id: parentId, full_name: 'Synthetic Parent', role: 'parent', nationality: null }
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile])
    }
    // Independent family navigation is deliberately empty; no development
    // data requests are needed to establish consent-route recovery.
    if (url.pathname === '/rest/v1/player_parent_links' && observed.method === 'GET'
      && url.searchParams.get('parent_user_id') === `eq.${parentId}` && url.searchParams.get('select') === 'player_user_id') return json([])
    // TRAK-11 phase 4: the consent screen also lists account-less roster children; none here.
    if (url.pathname === '/rest/v1/rpc/get_roster_children_awaiting_consent' && observed.method === 'POST') return json([])
    if (url.pathname === '/rest/v1/rpc/get_my_child_logins' && observed.method === 'POST') return json([])
    if (url.pathname === '/rest/v1/rpc/get_my_approved_children_awaiting_signup' && observed.method === 'POST') return json([])
    if (url.pathname === '/rest/v1/rpc/family_feature_on' && observed.method === 'POST') return json(false) // TRAK-441: family_look off
    if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent' && observed.method === 'POST') {
      pending.push(observed)
      expect(observed.body).toEqual({})
      // clearAfterGrant: once approved, nobody is waiting (the Home bar's journey).
      const reply = clearAfterGrant && grants.length ? { data: [] } : replies[Math.min(pending.length - 1, replies.length - 1)]
      return json(reply.data, reply.status ?? 200)
    }
    if (url.pathname === '/rest/v1/rpc/record_parental_consent' && observed.method === 'POST') {
      grants.push(observed)
      if (holdFirstGrant && grants.length === 1) await heldGrant
      return json(consentId)
    }
    unexpected.push(`${observed.method} ${url.pathname}${url.search}`)
    return json({ message: 'Unmodelled request blocked' }, 500)
  })
  return { unexpected, errors, requests, pending, grants, releaseGrant }
}

test('malformed consent responses show a recoverable error rather than empty approval state', async ({ page, context }, testInfo) => {
  const fixture = await consentFixture(page, context, [{ data: null }, { data: [null] }, { data: [] }])
  try {
    await page.goto('/parent/consent')
    await expect(page.getByRole('alert')).toContainText("Couldn't load pending approvals")
    await expect(page.getByText('Nothing to approve', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0)
    expect(fixture.pending).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('consent-malformed-mobile.png'), fullPage: true })

    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => fixture.pending.length).toBe(2)
    await expect(page.getByRole('alert')).toContainText("Couldn't load pending approvals")
    await expect(page.getByText('Nothing to approve', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('Nothing to approve', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(`${appOrigin}/parent/consent`)
    expect(fixture.pending).toHaveLength(3)
    expect(fixture.grants).toHaveLength(0)
    expect(fixture.errors).toEqual([])
    expect(fixture.unexpected).toEqual([])
  } finally {
    fixture.releaseGrant()
  }
})

test('saved approval survives a failed refresh, then retries to a fresh child before finishing Home', async ({ page, context }, testInfo) => {
  const fixture = await consentFixture(page, context, [
    { data: [childA] },
    { data: { code: 'PGRST000', message: 'Synthetic pending-approval read unavailable' }, status: 503 },
    { data: [childB] },
    { data: [] },
  ], true)
  try {
    await page.goto('/parent/consent')
    // TRAK-182: the consent bar. Its Approve opens the panel, where the choices and the statement are.
    await expect(page.getByRole('heading', { name: 'Alex Synthetic is waiting for your approval' })).toBeVisible()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByText(consentStatement('Alex'))).toBeVisible()
    // The surface springs into the panel; screenshot it at rest.
    const surface = page.getByRole('region', { name: "Approve Alex's Trak account" })
    await expect.poll(async () => {
      const before = (await surface.boundingBox())?.height
      await page.waitForTimeout(150)
      return before !== undefined && before === (await surface.boundingBox())?.height
    }).toBe(true)
    await page.waitForTimeout(250)
    await page.screenshot({ path: testInfo.outputPath('consent-panel-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Legal guardian', exact: true }).click()
    await page.getByRole('switch', { name: /Recognition awards/ }).click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(() => fixture.grants.length).toBe(1)
    const saving = page.getByRole('button', { name: 'Approve', exact: true })
    await expect(saving).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('switch', { name: /Recognition awards/ })).toBeDisabled()
    const bounds = await saving.boundingBox()
    expect(bounds).not.toBeNull()
    if (!bounds) throw new Error('Saving button must be visible for duplicate-click control')
    await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    expect(fixture.grants).toHaveLength(1)
    expect(fixture.pending).toHaveLength(1)
    fixture.releaseGrant()

    await expect(page.getByRole('alert')).toContainText("Couldn't load pending approvals")
    await expect(page.getByRole('status')).toHaveText('Approval saved for Alex Synthetic.')
    await expect(page).toHaveURL(`${appOrigin}/parent/consent`)
    await expect(page.getByText('Nothing to approve', { exact: true })).toHaveCount(0)
    expect(fixture.pending).toHaveLength(2)
    expect(fixture.grants).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('consent-saved-refresh-error-mobile.png'), fullPage: true })

    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Blair Synthetic is waiting for your approval' })).toBeVisible()
    // Blair starts at the bar, with nothing carried over from Alex.
    await expect(page.getByText("Approve Blair's Trak account?")).toBeVisible()
    await page.getByRole('button', { name: 'Details', exact: true }).click()
    await expect(page.getByRole('switch', { name: /Recognition awards/ })).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Parent', exact: true })).toHaveAttribute('aria-pressed', 'true')
    // TRAK-145: the progress choice is gone; parent viewing is part of the required consent.
    await expect(page.getByText(/I can see their progress/i)).toHaveCount(0)
    expect(fixture.pending).toHaveLength(3)
    expect(fixture.grants).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('consent-next-child-mobile.png'), fullPage: true })

    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page).toHaveURL(`${appOrigin}/parent/home`)
    // Home's read is the fifth list request. ParentConsentWatcher shares it only
    // when the two overlap; otherwise its first check is a sixth (seen twice in CI).
    await expect.poll(() => fixture.pending.length).toBeGreaterThanOrEqual(5)
    expect(fixture.grants.map(request => request.body)).toEqual([
      { ...expectedGrant(childA.player_user_id), p_relationship: 'legal_guardian',
        p_purposes: { coaching_records: true, recognition: true } },
      expectedGrant(childB.player_user_id),
    ])
    expect(fixture.pending.map(request => request.body)).toEqual(fixture.pending.map(() => ({})))
    expect(fixture.errors).toEqual([])
    expect(fixture.unexpected).toEqual([])
  } finally {
    fixture.releaseGrant()
  }
})

// TRAK-182 (Imad, 16 Oct): on Home, Arc's consent bar instead of a lime banner and a page of its own.
test('Home asks with a bar: details close with X, Reject folds it, approval removes it', async ({ page, context }, testInfo) => {
  const fixture = await consentFixture(page, context, [{ data: [childA] }], false, true)
  const settle = () => page.waitForTimeout(500) // the surface springs between faces
  await page.goto('/parent/home')
  await expect(page.getByText("Approve Alex's Trak account?")).toBeVisible()
  await expect(page.getByText(/waiting on your approval/)).toHaveCount(0)
  await settle(); await page.screenshot({ path: testInfo.outputPath('home-consent-1-bar.png') })

  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await expect(page.getByText(consentStatement('Alex'))).toBeVisible()
  await settle(); await page.screenshot({ path: testInfo.outputPath('home-consent-2-details.png') })
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(page.getByText("Approve Alex's Trak account?")).toBeVisible()

  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  const reopen = page.getByRole('button', { name: "Review Alex's approval" })
  await expect(reopen).toBeVisible()
  await settle(); await page.screenshot({ path: testInfo.outputPath('home-consent-3-folded.png') })
  expect(fixture.grants).toHaveLength(0)

  await reopen.click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText(consentStatement('Alex'))).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect.poll(() => fixture.grants.length).toBe(1)
  expect(fixture.grants[0].body).toEqual(expectedGrant(childA.player_user_id))
  // Approved: gone, with no reopen button, and still on Home.
  await expect(page.getByText("Approve Alex's Trak account?")).toHaveCount(0)
  await expect(reopen).toHaveCount(0)
  await expect(page).toHaveURL(`${appOrigin}/parent/home`)
  await settle(); await page.screenshot({ path: testInfo.outputPath('home-consent-4-approved.png') })
  expect(fixture.errors).toEqual([])
  expect(fixture.unexpected).toEqual([])
})
