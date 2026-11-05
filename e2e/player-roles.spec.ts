import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-353 (Season plan 5/18): the issue's own check, in a real browser on a laptop and a phone. From Positions, a
// defender's name opens the panel; the coach gives them Can also play MID and two roles, one of them their own, and
// saves. After a reload the Positions row and the player's page both still say so. Production build, synthetic
// intercepted backend that remembers what's saved.
const coachId = '97353000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>

async function backend(context: BrowserContext, unexpected: string[]) {
  const players: Row[] = ['Defender', 'Midfielder', 'Attacker', 'Goalkeeper'].map((position, i) => ({
    id: `sq-${i + 1}`, coach_user_id: coachId, player_name: `Synthetic Player ${String(i + 1).padStart(2, '0')}`, position,
    age_group: 'U16', shirt_number: i + 1, status: 'active', linked_player_id: `child-${i + 1}`, created_at: '2026-10-01T08:00:00Z',
  }))
  let also: Row[] = [], roles: Row[] = []
  const saves: Row[] = []
  const user = { id: coachId, email: 'coach@roles353.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-roles353-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: coachId, id: coachId, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-353', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/season_plans' && req.method() === 'GET')
      return json([{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes' }])
    if (path === '/rest/v1/squad_player_also_plays') return json(also)
    if (path === '/rest/v1/squad_player_roles') return json(roles)
    if (path === '/rest/v1/rpc/save_player_position_and_roles') {
      const body = req.postDataJSON(), id = body.p_squad_player_id
      saves.push(body)
      also = [...also.filter(a => a.squad_player_id !== id), ...body.p_also_plays.map((position: string) => ({ squad_player_id: id, position }))]
      roles = [...roles.filter(r => r.squad_player_id !== id), ...body.p_roles.map((role: string) => ({ squad_player_id: id, role }))]
      Object.assign(players.find(p => p.id === id) ?? {}, { position: body.p_position })
      return route.fulfill({ status: 204, body: '' })
    }
    // Every other read is empty: this is about the panel, not the rest of the app.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return saves
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`roles at ${width} px: a defender can also play MID, with two roles, one the coach's own, after a reload`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    const saves = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/season-plan/positions')
    await page.getByRole('button', { name: /^Synthetic Player 01/ }).click()

    const panel = page.getByRole('dialog', { name: "Synthetic's position and roles" })
    await expect(panel.getByRole('group', { name: 'As a defender' })).toBeVisible()
    const cover = panel.getByRole('group', { name: /Can also play/ })
    await cover.getByRole('button', { name: 'Midfielder', exact: true }).click()
    await panel.getByRole('group', { name: 'As a defender' }).getByRole('button', { name: 'Stopper', exact: true }).click()
    await panel.getByRole('button', { name: '+ Create your own' }).click()
    await panel.getByRole('textbox', { name: 'Your own role' }).fill('Win the second ball')
    await panel.getByRole('textbox', { name: 'Your own role' }).press('Enter')
    await expect(panel.getByRole('group', { name: 'Yours' }).getByRole('button', { name: 'Win the second ball' })).toHaveAttribute('aria-pressed', 'true')
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    // The viewport only: a full-page capture can resize the window, and the sheet would lose its choices (4 Nov).
    await page.screenshot({ path: testInfo.outputPath(`roles-panel-${width}.png`) })

    await panel.getByRole('button', { name: 'Save · next: Synthetic Player 02' }).click()
    await expect.poll(() => saves).toEqual([{ p_squad_player_id: 'sq-1', p_position: 'Defender', p_also_plays: ['Midfielder'], p_roles: ['Stopper', 'Win the second ball'] }])
    // The next player's own panel: Pat's had "As a midfielder" too, once Midfielder was ticked.
    await expect(page.getByRole('button', { name: 'Save · next: Synthetic Player 03' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    const row = page.getByRole('button', { name: /^Synthetic Player 01/ })
    await expect(row).toContainText('Stopper, Win the second ball · also MID')
    await page.reload()
    await expect(page.getByRole('button', { name: /^Synthetic Player 01/ })).toContainText('Stopper, Win the second ball · also MID')

    await page.goto('/coach/squad/player/sq-1')
    const section = page.getByRole('region', { name: 'Position and roles' })
    await expect(section).toContainText('Stopper, Win the second ball')
    await expect(section).toContainText('Midfielder')
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`roles-player-page-${width}.png`) })
    expect(unexpected).toEqual([])
  })
}
