import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-355 (Season plan 7/18): watch first in a real browser, on a laptop and a phone, after the issue's own check.
// Bea is watched "after 2 trainings" and was at two registered trainings since, so Home brings her back; the card
// opens her sheet in Player objectives, and setting her up takes the card away. Dee is watched from her sheet, and
// Squad shows her as Watching. Production build, synthetic intercepted backend that remembers what's saved.
const coachId = '97355000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000)
const day = (date: Date) => date.toISOString().slice(0, 10)

async function backend(context: BrowserContext, unexpected: string[]) {
  const players: Row[] = [['Bea Synthetic', 'Defender'], ['Cal Synthetic', 'Attacker'], ['Dee Synthetic', 'Midfielder'], ['Eli Synthetic', 'Goalkeeper']].map(([name, position], i) => ({
    id: `sq-${i + 1}`, coach_user_id: coachId, player_name: name, position, age_group: 'U16', shirt_number: i + 1,
    status: 'active', linked_player_id: `child-${i + 1}`, created_at: '2026-10-01T08:00:00Z',
  }))
  const plan: Row = { id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes', watch_rule: 't2' }
  let watches: Row[] = [{ squad_player_id: 'sq-1', since: daysAgo(15).toISOString() }]
  let held: Row[] = []
  const watched: string[][] = []
  // Two trainings in the register since Bea's watch began, and she was at both.
  const sessions = [{ id: 's-1', session_date: day(daysAgo(10)), session_type: 'training', squad: 'U16' }, { id: 's-2', session_date: day(daysAgo(5)), session_type: 'training', squad: 'U16' }]
  const attendance = sessions.map(s => ({ session_id: s.id, squad_player_id: 'sq-1', status: 'present' }))
  const user = { id: coachId, email: 'coach@watch355.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-watch355-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname, get = req.method() === 'GET'
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: coachId, id: coachId, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-355', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/organizations') return json([{ id: 'org-355', name: 'Synthetic Academy', logo_url: null, time_zone: 'Asia/Dubai' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/season_plans' && get) return json([plan])
    if (path === '/rest/v1/player_watches') return json(watches)
    if (path === '/rest/v1/rpc/watch_players') {
      const ids: string[] = req.postDataJSON().p_squad_player_ids
      watched.push(ids)
      watches = [...watches.filter(w => !ids.includes(w.squad_player_id as string)), ...ids.map(id => ({ squad_player_id: id, since: new Date().toISOString() }))]
      return json(ids.length)
    }
    if (path === '/rest/v1/player_objectives') return json(held)
    if (path === '/rest/v1/objective_progress') return json([])
    if (path === '/rest/v1/rpc/stuck_player_objectives') return json([])
    if (path === '/rest/v1/rpc/save_player_objectives') {
      const body = req.postDataJSON(), id = body.p_squad_player_id
      held = [...held.filter(o => o.squad_player_id !== id), ...body.p_objectives.map((o: Row, i: number) => ({ ...o, id: `${id}-${i}`, squad_player_id: id, created_at: new Date().toISOString() }))]
      if (body.p_objectives.length) watches = watches.filter(w => w.squad_player_id !== id)
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/rest/v1/coach_calendar_events' && url.searchParams.get('event_type') === 'eq.training') return json([{ squad: 'U16', status: 'scheduled' }])
    if (path === '/rest/v1/coach_sessions' && get) return json(sessions)
    if (path === '/rest/v1/session_attendance' && get) return json(attendance)
    // Every other read is empty: this is about watching, not the rest of the app.
    if (path.startsWith('/rest/v1/') && (get || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return watched
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`watch first at ${width} px: a due player comes back to Needs you, and Squad shows who is watched`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    const watched = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/home')
    const card = page.getByText('Watched 2 trainings · Set Bea up')
    await expect(card).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`watch-home-${width}.png`) })
    await page.getByRole('button', { name: 'Set up' }).first().click()

    // Her sheet opens in Player objectives, with Keep watching beside Save.
    const bea = page.getByRole('dialog', { name: "Bea's objectives" })
    await expect(bea.getByRole('button', { name: 'Keep watching' })).toBeVisible()
    await bea.getByRole('group', { name: /^Objectives for/ }).getByRole('button', { name: /^Holds the line together/ }).click()
    await bea.getByRole('button', { name: /^Save/ }).click()

    // Dee is watched from her sheet; the sheet moves on.
    const dee = page.getByRole('dialog', { name: /objectives$/ })
    await expect(dee).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Dee Synthetic/ }).click()
    await page.getByRole('dialog', { name: "Dee's objectives" }).getByRole('button', { name: 'Watch first' }).click()
    await expect.poll(() => watched).toEqual([['sq-3']])
    // The sheet moves on once the watch is saved. Escape before then closed Dee's, and the next player's opened over
    // the page (#527's gate), so wait for the move, then close whatever is open.
    await expect(page.getByRole('dialog', { name: "Dee's objectives" })).toBeHidden()
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('region', { name: /^Watching/ }).getByRole('button', { name: /^Dee Synthetic/ })).toBeVisible()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`watch-step-${width}.png`) })

    await page.goto('/coach/squad')
    await expect(page.getByRole('button', { name: /Dee Synthetic/ })).toContainText('Watching')
    await page.goto('/coach/home')
    await expect(page.getByRole('heading', { name: /^Needs you/ })).toBeVisible()
    await expect(page.getByText(/Set Bea up$/)).toHaveCount(0)
    expect(unexpected).toEqual([])
  })
}
