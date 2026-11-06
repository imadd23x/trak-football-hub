import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-361 (Season plan 13/18): Home's Season plan card in a real browser, on a laptop, a tablet and a phone. Folded it
// is one line; open it shows the season objectives, the player objectives row and View plan; a reload keeps it open.
// Under All, one folded card per squad. Production build, synthetic intercepted backend.
const coachId = '97361000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>

async function backend(context: BrowserContext, unexpected: string[], squads: string[]) {
  const players: Row[] = squads.flatMap((squad, s) => ['Goalkeeper', 'Defender', 'Midfielder'].map((position, i) => ({
    id: `sq-${s}-${i}`, coach_user_id: coachId, player_name: `Synthetic Player ${squad} ${i + 1}`, position, age_group: squad,
    shirt_number: i + 1, status: 'active', linked_player_id: `child-${s}-${i}`, created_at: '2026-10-01T08:00:00Z',
  })))
  const plan = (squad: string): Row => ({ id: `plan-${squad}`, squad, starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-11-01T10:00:00Z',
    positions_known: 'yes', watch_rule: 't2', last_shared_at: '2026-11-01T10:00:00Z', unshared_parts: [], unshared_players: [] })
  const user = { id: coachId, email: 'coach@card361.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-card361-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname, method = req.method()
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: coachId, id: coachId, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-361', coach_role: 'Head Coach', team: squads[0] }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/season_plans' && method === 'GET') {
      const squad = url.searchParams.get('squad')?.replace(/^eq\./, '')
      return json(squads.filter(s => !squad || s === squad).map(plan))
    }
    if (path === '/rest/v1/season_objectives' && method === 'GET')
      return json([{ id: `so-${url.searchParams.get('plan_id')}`, place: 1, title: 'Stay compact', looks_like: '', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null }])
    if (path === '/rest/v1/player_objectives') return json([{ id: 'po-1', squad_player_id: 'sq-0-1', title: 'Holds the line together', source: 'library', season_objective_id: null, created_at: '2026-11-01T08:00:00Z', status: 'open', retired_at: null }])
    // Every other read is empty: this is about the card, not the rest of Home.
    if (path.startsWith('/rest/v1/') && (method === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${method} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const foldOf = (page: Page, squad: string) => page.getByRole('region', { name: `${squad} season plan` }).locator('button[aria-expanded]').first()

for (const [width, height] of [[1280, 800], [834, 1112], [390, 844]] as const) {
  test(`the Season plan card at ${width} px: folds, opens, and stays open after a reload`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    await backend(context, unexpected, ['U16'])
    await page.setViewportSize({ width, height })
    await page.goto('/coach/home')
    const card = page.getByRole('region', { name: 'U16 season plan' })
    await expect(card.getByText(/^Shared 1 Nov · \d+ weeks? left$/)).toBeVisible()
    await expect(foldOf(page, 'U16')).toHaveAttribute('aria-expanded', 'false')
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`card-folded-${width}.png`) })

    await foldOf(page, 'U16').click()
    await expect(card.getByText('No match yet')).toBeVisible()
    await card.getByRole('button', { name: /^Player objectives/ }).click()
    await expect(card.getByText('Holds the line together')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`card-open-${width}.png`) })

    await page.reload()
    await expect(foldOf(page, 'U16')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('region', { name: 'U16 season plan' }).getByRole('button', { name: 'View plan' })).toBeVisible()
    expect(unexpected).toEqual([])
  })
}

test('under All, one folded card per squad, each opening on its own', async ({ context, page }, testInfo) => {
  const unexpected: string[] = []
  await backend(context, unexpected, ['U14', 'U16'])
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/coach/home')
  await expect(foldOf(page, 'U14')).toHaveAttribute('aria-expanded', 'false')
  await expect(foldOf(page, 'U16')).toHaveAttribute('aria-expanded', 'false')
  await foldOf(page, 'U16').click()
  await expect(foldOf(page, 'U16')).toHaveAttribute('aria-expanded', 'true')
  await expect(foldOf(page, 'U14')).toHaveAttribute('aria-expanded', 'false')
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  await page.getByRole('region', { name: 'Season plans' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('cards-all-1280.png') })
  expect(unexpected).toEqual([])
})
