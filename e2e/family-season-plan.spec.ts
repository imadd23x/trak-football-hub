import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-399 (Season plan 18/18 build 4/8): the Season plan card on the family Home, and the journey into the family's
// season page (TRAK-400), in a real browser, at 1280, 834 and 390. The family app stays one phone-width column, centred. The card
// follows the child picker, wears New with no Got it, opens the page, and opening it clears New. Production build,
// synthetic intercepted backend.
const parent = '97399000-0000-4000-8000-000000000001', alex = '97399000-0000-4000-8000-000000000002', zara = '97399000-0000-4000-8000-000000000003'

async function backend(context: BrowserContext, unexpected: string[], state: { isNew: boolean; seen: string[]; reads: string[] }) {
  const user = { id: parent, email: 'guardian@season399.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: parent, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-season399', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const one = req.headers()['accept']?.includes('vnd.pgrst.object')
    const rows = (all: Record<string, unknown>[]) => json(one ? all[0] ?? null : all)
    const path = url.pathname
    if (path === '/rest/v1/telemetry_events' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') {
      const asked = url.searchParams.get('user_id') ?? ''
      if (asked === `eq.${parent}`) return rows([{ id: parent, user_id: parent, role: 'parent', full_name: 'Synthetic Guardian', nationality: null }])
      return rows([{ user_id: alex, full_name: 'Alex Example' }, { user_id: zara, full_name: 'Zara Example' }])
    }
    if (path === '/rest/v1/player_parent_links') return json([{ player_user_id: alex }, { player_user_id: zara }])
    if (path === '/rest/v1/rpc/guardian_consent_applies') return json(true)
    if (path === '/rest/v1/rpc/season_plan_for_player') {
      const child = (req.postDataJSON() as { p_child?: string }).p_child ?? ''
      state.reads.push(child)
      if (child !== alex) return json([]) // Zara's coach has not shared
      return json([{
        squad_player_id: 'sq-399', squad: 'U15', coach_name: 'Coach Rami', time_zone: 'Asia/Dubai', starts_on: '2026-09-01', ends_on: '2027-06-30',
        eval_every: 'month', eval_day: 0, last_evaluation_on: '2026-11-01', position: 'Midfielder', also_plays: ['Attacker'], roles: ['Box-to-box'],
        season_objectives: [
          { id: 'so-1', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press.' },
          { id: 'so-2', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m.' }],
        objectives: [
          { id: 'po-1', slot: 1, title: 'Scans before receiving', status: 'open', current: 'not_yet', supports: null,
            history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'not_yet' }] },
          { id: 'po-2', slot: 2, title: 'Plays forward on the half-turn', status: 'open', current: 'some_progress', supports: null, history: [] }],
        is_new: state.isNew, shared_at: '2026-11-01T10:00:00Z' }])
    }
    if (path === '/rest/v1/rpc/mark_season_plan_seen') { state.seen.push((req.postDataJSON() as { p_child?: string }).p_child ?? ''); state.isNew = false; return json(null) }
    // Every other read is empty: this is about the card and the page, not the rest of Home.
    if (path === '/rest/v1/player_details') return rows([{ position: 'Midfielder', current_club: 'Synthetic FC', age_group: 'U15' }])
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return rows([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [834, 1112], [390, 844]] as const) {
  test(`the family Season plan card and page at ${width} px: follows the picker, New clears on opening the page, phone-width column`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], state = { isNew: true, seen: [] as string[], reads: [] as string[] }
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, state)
    await page.setViewportSize({ width, height })
    await page.goto('/parent/home')
    const card = page.getByRole('region', { name: 'Season plan' })
    await expect(card.getByText('Win it back within 5 seconds')).toBeVisible()
    await expect(card.getByRole('heading', { name: "Alex's objectives" })).toBeVisible()
    await expect(card.getByText('Not yet', { exact: true })).toBeVisible()
    await expect(card.getByText('Some progress', { exact: true })).toBeVisible()
    await expect(card.getByText('New', { exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Got it' })).toHaveCount(0)
    const box = await card.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`family-season-card-${width}.png`) })

    // The card follows the picker: Zara's coach has not shared, so there is no card for her.
    await page.getByRole('button', { name: /Alex Example/ }).click()
    await page.getByRole('menuitem', { name: 'Zara Example' }).click()
    // Wait for her read to be answered (empty) before asserting there is no card: the card also vanishes while it loads.
    await expect.poll(() => state.reads).toContain(zara)
    await page.waitForLoadState('networkidle')
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: /Zara Example/ }).click()
    await page.getByRole('menuitem', { name: 'Alex Example' }).click()

    await page.getByRole('region', { name: 'Season plan' }).getByRole('button', { name: 'See the season plan' }).click()
    await expect(page).toHaveURL(/\/parent\/season$/)
    await expect(page.getByRole('heading', { name: "Alex's season" })).toBeVisible()
    await expect(page.getByText(/^Set by Coach Rami\./)).toBeVisible()
    await expect(page.getByRole('region', { name: "Alex's position" }).getByText('Can also play Attacker')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Squad objectives' }).getByText('No more than 35 m.')).toBeVisible()
    await expect(page.getByRole('list', { name: 'History of Scans before receiving' }).getByRole('listitem')).toHaveText(['Sun 4 OctNot yet', 'Sun 1 NovNot yet'])
    await expect(page.getByText('Your coach updates this at each evaluation. You can read it here; nothing needs a reply.')).toBeVisible()
    await expect.poll(() => state.seen).toEqual([alex])
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    const objectives = await page.getByRole('region', { name: "Alex's objectives" }).boundingBox()
    expect(objectives!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: testInfo.outputPath(`family-season-page-${width}.png`), fullPage: true })

    await page.getByRole('link', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/parent\/home$/)
    // Opening the page cleared New, so the card is quiet when Home comes back.
    await expect(page.getByRole('region', { name: 'Season plan' }).getByText('New', { exact: true })).toHaveCount(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
