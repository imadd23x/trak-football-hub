import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-397 and TRAK-398 (Season plan 18/18 builds 2 and 3): the My season card and page on the player's Home in a real browser, at 1280, 834 and
// 390. The player app stays one phone-width column, centred. New and Got it clear after a tap; a failed read shows no
// card and nothing else on Home changes. Production build, synthetic intercepted backend.
const playerId = '97397000-0000-4000-8000-000000000002'

async function backend(context: BrowserContext, unexpected: string[], state: { isNew: boolean; fail: boolean; seen: number }) {
  const user = { id: playerId, email: 'player@season397.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-season397', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const rows = (all: Record<string, unknown>[]) => json(req.headers()['accept']?.includes('vnd.pgrst.object') ? all[0] ?? null : all)
    const path = url.pathname
    if (path === '/rest/v1/telemetry_events' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') return rows([{ id: playerId, user_id: playerId, role: 'player', full_name: 'Manos Synthetic' }])
    if (path === '/rest/v1/player_details') return rows([{ user_id: playerId, position: 'Defender', age_group: 'U16', current_club: 'Synthetic FC' }])
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, invited_parent: null })
    if (path === '/rest/v1/rpc/season_plan_for_player') {
      if (state.fail) return json({ message: 'boom' }, 500)
      return json([{
        squad_player_id: 'sq-397', squad: 'U16', coach_name: 'Coach Rami', time_zone: 'Asia/Dubai', starts_on: '2026-09-01', ends_on: '2027-06-30',
        eval_every: 'month', eval_day: 0, last_evaluation_on: '2026-11-01', position: 'Defender', also_plays: ['Midfielder'], roles: [],
        season_objectives: [
          { id: 'so-1', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press.' },
          { id: 'so-2', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m.' }],
        objectives: [
          { id: 'po-1', slot: 1, title: 'Holds the line together', status: 'open', current: 'on_track', supports: null,
            history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'on_track' }] },
          { id: 'po-2', slot: 2, title: 'Talks to the keeper at every corner', status: 'open', current: 'some_progress', supports: null, history: [] }],
        is_new: state.isNew, shared_at: '2026-11-01T10:00:00Z' }])
    }
    if (path === '/rest/v1/rpc/mark_season_plan_seen') { state.seen += 1; state.isNew = false; return json(null) }
    // Every other read is empty: this is about the card, not the rest of Home.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return rows([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [834, 1112], [390, 844]] as const) {
  test(`the My season card at ${width} px: New and Got it clear after a tap, in a phone-width column`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], state = { isNew: true, fail: false, seen: 0 }
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, state)
    await page.setViewportSize({ width, height })
    await page.goto('/player/home')
    const card = page.getByRole('region', { name: 'My season' })
    await expect(card.getByText('Win it back within 5 seconds')).toBeVisible()
    await expect(card.getByText('Holds the line together')).toBeVisible()
    await expect(card.getByText('On track', { exact: true })).toBeVisible()
    await expect(card.getByText('Some progress', { exact: true })).toBeVisible()
    await expect(card.getByText('New', { exact: true })).toBeVisible()
    // The player app is one phone-width column at every width, and nothing scrolls sideways.
    const box = await card.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`my-season-card-new-${width}.png`) })

    await card.getByRole('button', { name: 'Got it' }).click()
    await expect(card.getByText('New', { exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Got it' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Open my season' })).toBeVisible()
    expect(state.seen).toBe(1)
    await page.screenshot({ path: testInfo.outputPath(`my-season-card-seen-${width}.png`) })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

for (const [width, height] of [[1280, 800], [834, 1112], [390, 844]] as const) {
  test(`the My season page at ${width} px: opens from the card, clears New, nothing scrolls sideways, Back returns to Home`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], state = { isNew: true, fail: false, seen: 0 }
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, state)
    await page.setViewportSize({ width, height })
    await page.goto('/player/home')
    await page.getByRole('region', { name: 'My season' }).getByRole('button', { name: 'Open my season' }).click()
    await expect(page).toHaveURL(/\/player\/season$/)
    await expect(page.getByRole('heading', { name: 'My season' })).toBeVisible()
    await expect(page.getByText(/^Set by Coach Rami\./)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your position' }).getByText('Can also play Midfielder')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Squad objectives' }).getByText('No more than 35 m.')).toBeVisible()
    const history = page.getByRole('list', { name: 'History of Holds the line together' })
    await expect(history.getByRole('listitem')).toHaveText(['Sun 4 OctNot yet', 'Sun 1 NovOn track'])
    await expect.poll(() => state.seen).toBe(1)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    const box = await page.getByRole('region', { name: 'Your objectives' }).boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: testInfo.outputPath(`my-season-page-${width}.png`), fullPage: true })

    await page.getByRole('link', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/player\/home$/)
    // Opening the page cleared New, so the card is quiet when Home comes back.
    await expect(page.getByRole('region', { name: 'My season' }).getByText('New', { exact: true })).toHaveCount(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('a failed read shows no card, and Home carries on', async ({ context, page }) => {
  const unexpected: string[] = [], errors: string[] = [], state = { isNew: true, fail: true, seen: 0 }
  page.on('pageerror', error => errors.push(error.message))
  await backend(context, unexpected, state)
  await page.goto('/player/home')
  await expect(page.getByText('Synthetic FC · U16')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('region', { name: 'My season' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})
