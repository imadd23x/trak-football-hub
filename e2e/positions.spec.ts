import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-352 (Season plan 4/18): Positions in a real browser, on a laptop and a phone. Home's Needs you asks for the
// players with no position; the coach answers the first question and places all 22 with taps only; two children
// waiting for consent are counted, never listed; then Home's card has gone. Production build, synthetic
// intercepted backend.
const coachId = '97352000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>

async function backend(context: BrowserContext, unexpected: string[]) {
  const players: Row[] = Array.from({ length: 24 }, (_, i) => ({
    id: `sq-${i + 1}`, coach_user_id: coachId, player_name: `Synthetic Player ${String(i + 1).padStart(2, '0')}`, position: null,
    age_group: 'U16', shirt_number: i + 1, status: 'active', linked_player_id: `child-${i + 1}`, created_at: '2026-10-01T08:00:00Z',
  }))
  const waiting = new Set(['sq-23', 'sq-24'])
  const plans: Row[] = []
  const user = { id: coachId, email: 'coach@positions352.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-positions352-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname, eq = (key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: coachId, id: coachId, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-352', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(waiting.has(req.postDataJSON()?.p_squad_player_id))
    if (path === '/rest/v1/rpc/set_player_position') {
      const { p_squad_player_id: id, p_position: position } = req.postDataJSON()
      Object.assign(players.find(p => p.id === id) ?? {}, { position })
      return json(position)
    }
    if (path === '/rest/v1/season_plans') {
      if (req.method() === 'GET') return json(plans.filter(p => p.squad === eq('squad')))
      if (req.method() === 'POST') { plans.push({ id: `plan-${plans.length + 1}`, starts_on: null, ends_on: null, shared_at: null, ...req.postDataJSON() }); return json({}, 201) }
      if (req.method() === 'PATCH') { Object.assign(plans.find(p => p.id === eq('id')) ?? {}, req.postDataJSON()); return route.fulfill({ status: 204, body: '' }) }
    }
    // Every other read is empty: this is about positions, not the rest of Home.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const PICKS = ['Goalkeeper', 'Goalkeeper', ...Array(7).fill('Defender'), ...Array(7).fill('Midfielder'), ...Array(6).fill('Attacker')]

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`positions at ${width} px: Needs you asks, all 22 placed with taps, the card goes`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/home')
    await expect(page.getByText('22 players need a position')).toBeVisible()
    await page.getByRole('button', { name: 'Place them' }).click()

    await expect(page.getByRole('heading', { name: 'Do you know where they play yet?' })).toBeVisible()
    await page.getByRole('radio', { name: /^Yes/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: '0 of 22 placed' })).toBeVisible()
    await expect(page.getByText(/^2 players are waiting for consent/)).toBeVisible()
    await expect(page.getByText('Synthetic Player 23')).toHaveCount(0)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)

    for (const [i, position] of PICKS.entries()) {
      const name = `Synthetic Player ${String(i + 1).padStart(2, '0')}`
      await page.getByRole('group', { name: `${name}'s position` }).getByRole('button', { name: position, exact: true }).click()
      await expect(page.getByRole('heading', { name: `${i + 1} of 22 placed` })).toBeVisible()
    }
    await expect(page.getByText('Everyone is placed.')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: '22 of 22 placed' })).toHaveAttribute('aria-valuenow', '22')
    // Every name stays readable beside its buttons, on a phone too.
    for (const name of ['Synthetic Player 01', 'Synthetic Player 22']) {
      const label = page.getByText(name, { exact: true })
      expect(await label.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    for (const [line, count] of [['Goalkeepers', 2], ['Defenders', 7], ['Midfielders', 7], ['Attackers', 6]] as const) {
      await expect(page.getByRole('heading', { name: `${line} · ${count}` })).toBeVisible()
    }
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    // Every tap has saved by now, so the screenshot can't lose anything (see e2e/season-plan.spec.ts, 4 Nov).
    await page.screenshot({ path: testInfo.outputPath(`positions-${width}.png`), fullPage: true })

    // TRAK-354: Positions goes on to Player objectives; TRAK-356: then on to Share. Home no longer asks.
    await page.getByRole('button', { name: 'Next: Player objectives' }).click()
    await page.getByRole('button', { name: 'Next: Share' }).click()
    await expect(page.getByRole('heading', { name: 'What goes out' })).toBeVisible()
    await page.goto('/coach/home')
    await expect(page.getByRole('heading', { name: /^Needs you/ })).toBeVisible()
    await expect(page.getByText(/players? needs? a position$/)).toHaveCount(0)
    expect(unexpected).toEqual([])
  })
}
