import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-364 (Season plan 16/18): the issue's own check, in a real browser on a laptop and a phone. With the season plan
// on and the squad's plan shared, Home shows one Evaluation due card (a missed date stays due) and no per-player Assess
// card; Evaluate opens the squad's evaluation. Pat starts from last time; Quinn has no ratings and holds Publish back
// until rated; a note goes to Quinn alone. A failed publish keeps everything; the retry sends the same. Production
// build, synthetic intercepted backend. Dates are worked out from today: shared 90 days ago, every 2 weeks.
const coachId = '97364000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>
const DAY = 86_400_000
const dayFromNow = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + n * DAY))

async function backend(context: BrowserContext, unexpected: string[]) {
  const players: Row[] = [['pat', 'Pat Synthetic', 'Defender'], ['quinn', 'Quinn Synthetic', 'Midfielder'], ['rae', 'Rae Synthetic', 'Attacker']]
    .map(([id, name, position], i) => ({ id, coach_user_id: coachId, player_name: name, position, age_group: 'U16', shirt_number: i + 2,
      status: 'active', linked_player_id: `child-${id}`, created_at: '2026-08-01T08:00:00Z' }))
  const shared = new Date(Date.now() - 90 * DAY).toISOString()
  const plan: Row = { id: 'plan-1', squad: 'U16', starts_on: dayFromNow(-120), ends_on: dayFromNow(200), shared_at: shared, last_shared_at: shared,
    positions_known: 'yes', watch_rule: 't2', unshared_parts: [], unshared_players: [], eval_every: '2w', eval_day: 0 }
  const lastTime = { id: 'as-old', squad_player_id: 'pat', coach_user_id: coachId, created_at: '2026-08-20T10:00:00Z', published_at: '2026-08-20T10:00:00Z',
    coach_rating: 6.2, work_rate: 7, tactical: 6, attitude: 6, technical: 6, physical: 6, coachability: 6 }
  const evaluations: Row[] = []
  const published: Row[] = []
  let fail = 1
  const user = { id: coachId, email: 'coach@evaluation364.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-evaluation364-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
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
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-364', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/organizations') return json([{ id: 'org-364', name: 'Synthetic Academy', time_zone: 'Asia/Dubai' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(req.postDataJSON()?.p_feature === 'season_plan')
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(req.postDataJSON()?.p_squad_player_id === 'rae')
    if (path === '/rest/v1/season_plans' && method === 'GET') return json([plan])
    if (path === '/rest/v1/season_evaluations') return json(evaluations)
    if (path === '/rest/v1/coach_assessments' && method === 'GET') return json([lastTime])
    if (path === '/rest/v1/rpc/publish_evaluation_with_objectives') {
      const args = req.postDataJSON()
      published.push(args)
      if (fail > 0) { fail -= 1; return json({ message: 'Service unavailable' }, 503) }
      evaluations.push({ plan_id: 'plan-1', due_on: args.p_due_on })
      return json({ evaluation_id: 'ev-1', due_on: args.p_due_on,
        assessments: (args.p_players as Row[]).map((p, i) => ({ squad_player_id: p.squad_player_id, assessment_id: `as-${i}` })) })
    }
    // Every other read is empty: this is about the evaluation, not the rest of the app.
    if (path.startsWith('/rest/v1/') && (method === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${method} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return { published }
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`evaluation at ${width} px: Home's card, last time's ratings, a player to rate, a note, and a retried publish`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    const { published } = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/home')

    // Home: one Evaluation due card, missed a while ago, and no Assess card for Quinn, who was never assessed.
    const card = page.getByRole('listitem').filter({ hasText: 'Evaluation due' })
    await expect(card).toBeVisible()
    await expect(card.getByText(/Due since \w{3} \d+ \w{3}\. Everyone starts where they were last time\.$/)).toBeVisible()
    await expect(page.getByText(/Never assessed/)).toHaveCount(0)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) })
    await card.getByRole('button', { name: 'Evaluate' }).click()

    // Players: Pat from last time, Quinn not rated yet, Rae waiting for a parent.
    await expect(page).toHaveURL(/\/coach\/evaluation$/)
    const list = page.getByRole('list', { name: 'Players' })
    await expect(list.getByRole('button', { name: /^Pat Synthetic/ })).toContainText('Steady · 6.2')
    await expect(list.getByRole('button', { name: /^Quinn Synthetic/ })).toContainText('Not rated yet')
    await expect(page.getByText(/^Not in this evaluation: Rae Synthetic\./)).toBeVisible()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`players-${width}.png`) })

    // Quinn alone: Technical from 5 to 8, a note only Quinn sees, Done.
    await list.getByRole('button', { name: /^Quinn Synthetic/ }).click()
    // Arc's text morph renders the words twice (one for screen readers), so the first is enough.
    await expect(page.getByText('Optional. Only Quinn sees it, never their family.').first()).toBeAttached()
    const technical = page.getByRole('slider').nth(3)
    await technical.focus()
    for (let i = 0; i < 3; i++) await technical.press('ArrowRight')
    await page.getByLabel('Note to Quinn').fill('Great first month.')
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`player-${width}.png`) })
    await page.getByRole('button', { name: 'Done' }).click()

    // Publish: fails once, keeps everything, then goes.
    await page.getByRole('button', { name: 'Next: Publish' }).click()
    await expect(page.getByRole('region', { name: 'Bands' })).toBeVisible()
    await page.getByRole('button', { name: 'Publish to 2 players' }).click()
    await expect(page.getByText("Couldn't publish the evaluation. Check your connection and try again; everything you entered is still here.")).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`publish-failed-${width}.png`) })
    await page.getByRole('button', { name: 'Publish to 2 players' }).click()
    await expect(page.getByText('Published to 2 players.')).toBeVisible()
    expect(published).toHaveLength(2)
    expect(published[1]).toEqual(published[0])
    expect(published[0]).toMatchObject({ p_plan_id: 'plan-1', p_players: [
      { squad_player_id: 'pat', work_rate: 7, tactical: 6, attitude: 6, technical: 6, physical: 6, coachability: 6, note: '' },
      { squad_player_id: 'quinn', work_rate: 5, tactical: 5, attitude: 5, technical: 8, physical: 5, coachability: 5, note: 'Great first month.' },
    ] })
    await expect(page.getByText(/^The next evaluation opens /)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`published-${width}.png`) })

    // Home again: the card has gone.
    await page.goto('/coach/home')
    await expect(page.getByRole('heading', { name: /^Needs you/ })).toBeVisible()
    await expect(page.getByText('Evaluation due')).toHaveCount(0)
    expect(unexpected).toEqual([])
  })
}
