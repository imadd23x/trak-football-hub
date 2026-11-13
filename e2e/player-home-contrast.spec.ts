import { test, expect, type BrowserContext } from '@playwright/test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playerId = '97189000-0000-4000-8000-000000000002'

// Production build, synthetic backend only. The season card must be exercised
// with matches: an empty fixture missed the band and milestone contrast bug.
async function playerBackend(context: BrowserContext, hasMatches: boolean, unexpected: string[], now = Date.now()) {
  const user = { id: playerId, email: 'player@theme189.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(now / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    const rows = (all: Record<string, unknown>[]) => {
      const eqs = [...url.searchParams].filter(([, value]) => value.startsWith('eq.'))
      const found = all.filter(row => eqs.every(([key, value]) => String(row[key]) === value.slice(3)))
      return json(req.headers()['accept']?.includes('vnd.pgrst.object') ? found[0] ?? null : found)
    }
    const path = url.pathname
    if (path === '/rest/v1/telemetry_events' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') return rows([
      { id: playerId, user_id: playerId, role: 'player', full_name: 'Manos Synthetic' },
      { id: 'coach-189', user_id: 'coach-189', role: 'coach', full_name: 'Synthetic Coach' },
    ])
    if (path === '/rest/v1/player_details') return rows([{ user_id: playerId, position: 'Defender', age_group: 'U16', current_club: 'Synthetic FC' }])
    if (path === '/rest/v1/matches') return rows(hasMatches ? [6.5, 6.5, 5.5].map((rating, i) => ({
      id: `match-${i}`, user_id: playerId, opponent: 'Synthetic Rovers', competition: 'Friendly',
      match_date: `2026-10-${12 - i}`, created_at: `2026-10-${12 - i}T10:00:00Z`,
      team_score: 1, opponent_score: 0, computed_rating: rating, goals: 0, assists: 0,
      minutes_played: null, card_received: 'None', position: 'Defender', age_group: 'U16',
    })) : [])
    if (path === '/rest/v1/squad_players') return rows([{ id: 'sq-189', coach_user_id: 'coach-189', linked_player_id: playerId, status: 'active' }])
    if (path === '/rest/v1/coach_assessments') return rows([{ id: 'as-189', squad_player_id: 'sq-189', coach_user_id: 'coach-189',
      created_at: '2026-10-12T10:00:00Z', coach_rating: 6.3, work_rate: 9, tactical: 6, attitude: 8, technical: 5, physical: 7, coachability: 3 }])
    // TRAK-436: the bell reads his game plans and the coach's reviews.
    if (['coach_shared_feedback', 'player_parent_links', 'recognition_awards', 'game_for_family', 'game_for_player', 'game_review_for_family'].some(table => path === `/rest/v1/${table}`)) return rows([])
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, invited_parent: null })
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    // TRAK-441: the academy's family_look switch, off: today's Home.
    if (path === '/rest/v1/rpc/family_feature_on') return json(false)
    if (['child_events', 'get_player_invites_for_current_user', 'season_plan_for_player'].some(rpc => path === `/rest/v1/rpc/${rpc}`)) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, body: 'Unmocked request blocked' })
  })
}

for (const hasMatches of [false, true]) {
  test(`TRAK-189 player Home contrast, ${hasMatches ? 'three matches' : 'no matches'}`, async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await playerBackend(context, hasMatches, unexpected)
    await page.goto('/player/home')
    await expect(page.getByRole('button', { name: /^Alerts/ })).toBeVisible()
    // TRAK-435 (Imad, 12 Nov): no card built on match ratings, with rated matches or without.
    await expect(page.getByText('THIS SEASON')).toHaveCount(0)
    await expect(page.getByText('Season bands', { exact: true })).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: { id: string; nodes: { html: string; failureSummary?: string }[] }[] }> } }).axe
      const result = await axe.run({ runOnly: ['color-contrast'] })
      return result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ html: n.html, failure: n.failureSummary })) }))
    })
    await page.screenshot({ path: testInfo.outputPath(`player-home-${hasMatches ? 'matches' : 'empty'}.png`), fullPage: true })
    expect(violations).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('TRAK-189 player calendar contrast and cancelled ring on the selected day', async ({ page, context }, testInfo) => {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // The synthetic session must be valid at the same date as the browser clock.
  const now = new Date('2026-11-14T08:00:00Z')
  await playerBackend(context, false, unexpected, now.getTime())
  await context.route('**/rest/v1/rpc/child_events*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'event-calendar-189', coach_user_id: 'coach-189', published: true,
      event_type: 'training', title: 'Synthetic training', event_date: '2026-11-14',
      start_time: '10:00:00', starts_at: '2026-11-14T06:00:00Z', venue: 'Synthetic pitch',
      status: 'cancelled', sequence: 1, updated_at: '2026-11-13T10:00:00Z',
    }]),
  }))
  await page.clock.setFixedTime(now)
  await page.goto('/player/calendar')
  const cell = page.getByRole('gridcell', { name: /14 November 2026, 1 event/ })
  await expect(cell).toBeVisible()
  const dot = cell.locator('span[aria-hidden="true"] > span')
  await expect(dot).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(dot).toHaveCSS('border-color', 'rgb(194, 21, 23)')
  await expect(dot).toHaveCSS('border-style', 'solid')
  await expect(page.getByRole('region', { name: 'Day' }).getByRole('button', { name: /Synthetic training.*Cancelled/ })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: unknown[] }> } }).axe
    return (await axe.run({ runOnly: ['color-contrast'] })).violations
  })
  await page.screenshot({ path: testInfo.outputPath('player-calendar-cancelled.png'), fullPage: true })
  expect(violations).toEqual([])
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})
