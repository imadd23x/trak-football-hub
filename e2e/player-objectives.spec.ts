import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-354 (Season plan 6/18): the issue's own check, in a real browser on a laptop and a phone. Step 3 gives five
// players objectives with Save · next, one of them the coach's own; a third pick is refused with the reason. After a
// reload the step counts five, and a player's page shows theirs. Production build, synthetic intercepted backend that
// remembers what's saved.
const coachId = '97354000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>

async function backend(context: BrowserContext, unexpected: string[]) {
  const players: Row[] = ['Goalkeeper', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Attacker'].map((position, i) => ({
    id: `sq-${i + 1}`, coach_user_id: coachId, player_name: `Synthetic Player ${String(i + 1).padStart(2, '0')}`, position,
    age_group: 'U16', shirt_number: i + 1, status: 'active', linked_player_id: `child-${i + 1}`, created_at: '2026-10-01T08:00:00Z',
  }))
  let held: Row[] = []
  const saves: Row[] = []
  const user = { id: coachId, email: 'coach@objectives354.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-objectives354-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
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
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-354', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/season_plans' && req.method() === 'GET')
      return json([{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes' }])
    if (path === '/rest/v1/season_objectives' && req.method() === 'GET')
      return json([{ id: 'so-press', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press the moment we lose it.' }])
    if (path === '/rest/v1/player_objectives') return json(held)
    if (path === '/rest/v1/objective_progress') return json([])
    if (path === '/rest/v1/rpc/stuck_player_objectives') return json([])
    if (path === '/rest/v1/rpc/save_player_objectives') {
      const body = req.postDataJSON(), id = body.p_squad_player_id
      saves.push(body)
      held = [...held.filter(o => o.squad_player_id !== id), ...body.p_objectives.map((o: Row, i: number) =>
        ({ ...o, id: `${id}-${saves.length}-${i}`, squad_player_id: id, created_at: '2026-11-05T10:00:00Z' }))]
      return route.fulfill({ status: 204, body: '' })
    }
    // Every other read is empty: this is about objectives, not the rest of the app.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return saves
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const pick = (page: Page, title: string) => page.getByRole('dialog').getByRole('group', { name: /^Objectives for/ }).getByRole('button', { name: new RegExp(`^${title}`) })

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`objectives at ${width} px: five players, one the coach's own, kept after a reload`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    const saves = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/season-plan/objectives')
    await expect(page.getByText('0 of 6 players have one or two')).toBeVisible()
    await page.getByRole('button', { name: /^Synthetic Player 01/ }).click()

    // 01, a goalkeeper: two, and a third refused with the reason.
    await pick(page, 'Sweeps behind a high line').click()
    await pick(page, 'Commands the box on crosses').click()
    await pick(page, 'Talks the back line through set pieces').click()
    await expect(page.getByRole('dialog').getByText('Up to two at once. Untick one first.')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    // The viewport only: a full-page capture can resize the window, and the sheet would lose its picks (4 Nov).
    await page.screenshot({ path: testInfo.outputPath(`objectives-sheet-${width}.png`) })
    await page.getByRole('button', { name: 'Save · next: Synthetic Player 02' }).click()

    // 02 to 05: one each; 03 gets the coach's own.
    for (const [next, title] of [['03', 'Holds the line together'], ['04', null], ['05', 'Scans before receiving'], ['06', 'Screens the back four']] as const) {
      const dialog = page.getByRole('dialog', { name: "Synthetic's objectives" })
      await expect(dialog.getByRole('button', { name: `Save · next: Synthetic Player ${next}` })).toBeVisible()
      if (title) await pick(page, title).click()
      else {
        await dialog.getByRole('textbox', { name: 'Create your own' }).fill('Talks to the keeper at every corner')
        await dialog.getByRole('button', { name: 'Create' }).click()
      }
      await dialog.getByRole('button', { name: `Save · next: Synthetic Player ${next}` }).click()
    }
    await expect.poll(() => saves.length).toBe(5)
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    expect(saves[2]).toEqual({ p_squad_player_id: 'sq-3', p_objectives: [{ title: 'Talks to the keeper at every corner', source: 'own', season_objective_id: null }] })

    await page.reload()
    await expect(page.getByText('5 of 6 players have one or two')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`objectives-step-${width}.png`) })

    await page.goto('/coach/squad/player/sq-1')
    const section = page.getByRole('region', { name: 'Objectives' })
    await expect(section).toContainText('Sweeps behind a high line')
    await expect(section).toContainText('Supports: Win it back within 5 seconds')
    await expect(section).toContainText('Commands the box on crosses')
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`objectives-player-page-${width}.png`) })
    expect(unexpected).toEqual([])
  })
}
