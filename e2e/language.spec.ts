import { test, expect, type BrowserContext } from '@playwright/test'

// TRAK-406 (Languages 1/8): a coach picks Ελληνικά in Settings. Trak turns Greek at once (the side menu, the tab bar,
// Settings), the choice is saved on the account, and a fresh device that signs in to that account opens in Greek.
// Production build, synthetic intercepted backend.
const id = '97406000-0000-4000-8000-000000000001'

async function backend(context: BrowserContext, account: { language: string | null }, unexpected: string[]) {
  const user = { id, email: 'coach@language406.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-language406-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles' && req.method() === 'PATCH') {
      account.language = req.postDataJSON().language
      return json({ language: account.language })
    }
    if (path === '/rest/v1/profiles') return json([{ user_id: id, id, role: 'coach', full_name: 'Synthetic Coach', language: account.language }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: id, organization_id: 'org-406', coach_role: 'Head Coach', team: 'U14' }])
    if (path === '/rest/v1/organizations') return json([{ name: 'Synthetic Academy', logo_url: null }])
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'games', 'training'].includes(req.postDataJSON()?.p_feature))
    // Layout only: every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

test('a coach picks Ελληνικά on a laptop: the menu and Settings turn Greek, and the account keeps it', async ({ page, context, browser }, testInfo) => {
  const account = { language: null as string | null }
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await backend(context, account, unexpected)
  await page.goto('/settings')

  const menu = page.getByRole('navigation', { name: 'Synthetic Academy' })
  await expect(menu.getByRole('button', { name: 'Squad' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'Ελληνικά' }).click()

  await expect(menu.getByRole('button', { name: 'Ομάδα' })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Ρυθμίσεις' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Γλώσσα', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Ενότητες ρυθμίσεων' }).getByRole('button'))
    .toHaveText(['Προφίλ', 'Σύλλογος', 'Γλώσσα', 'Ειδοποιήσεις', 'Πώς λειτουργεί το Trak', 'Λογαριασμός'])
  // Kostas's words (10 Nov review): "+ Δημιουργία", wider than "+ Create", shows whole.
  const create = page.getByRole('button', { name: 'Δημιουργία' })
  await expect(create).toBeVisible()
  expect(await create.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  // A long section name wraps rather than running out of the list.
  const how = page.getByRole('navigation', { name: 'Ενότητες ρυθμίσεων' }).getByRole('button', { name: 'Πώς λειτουργεί το Trak' })
  expect(await how.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('lang', 'el')
  await expect.poll(() => account.language).toBe('el')
  await expect(page.getByRole('button', { name: 'Ελληνικά' })).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(600) // the switch's slide and the toast settle, for the picture
  await page.screenshot({ path: testInfo.outputPath('settings-greek-1440.png') })

  // Another device, nothing picked on it: signing in to the same account opens Trak in Greek.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: testInfo.project.use.baseURL })
  await backend(phone, account, unexpected)
  const other = await phone.newPage()
  await other.goto('/coach/home')
  await expect(other.getByRole('tablist', { name: 'Προπονητής' }).getByRole('tab', { name: 'Αρχική' })).toBeVisible()
  await expect(other.getByRole('tablist', { name: 'Προπονητής' }).getByRole('tab', { name: 'Προπόνηση' })).toBeVisible()
  // TRAK-406: a long word gets a smaller font in its tab instead of being cut ("Προπόνη…").
  const label = other.getByRole('tab', { name: 'Προπόνηση' }).locator('span').last()
  expect(await label.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await other.screenshot({ path: testInfo.outputPath('home-greek-390.png') })
  await phone.close()

  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})
