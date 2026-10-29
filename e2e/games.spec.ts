import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-283 (Games 1/8): Games home and a game's page with the academy's games switch on, at a phone's and a
// laptop's width: no sideways scroll, and the keyboard reaches every control. TRAK-284: plan step 1, opponent and
// goals, saved as a draft; what was typed survives a look at another tab. Production build, synthetic intercepted
// backend; test people are named after footballers.
test.use({ timezoneId: 'Asia/Dubai' })

const COACH = '97283000-0000-4000-8000-000000000001'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** A Dubai academy's match (UTC+4 all year): the wall clock typed and its instant. */
function match(id: string, squad: string | null, days: number, hhmm: string, over: Record<string, unknown> = {}) {
  const date = new Date(Date.now() + 4 * 60 * MINUTE + days * DAY).toISOString().slice(0, 10)
  const starts = Date.parse(`${date}T${hhmm}:00+04:00`)
  return {
    id, coach_user_id: COACH, squad, title: 'Match', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + 90 * MINUTE).toISOString(), event_date: date,
    start_time: `${hhmm}:00`, end_time: null, meet_time: null, opponent: 'Synthetic Rovers U16', home_away: 'home',
    venue: 'Rehearsal Park', kit: 'Blue shirts', kit_snapshot: null, family_note: 'Bring water', notes: null, series_id: null,
    training_theme: null, cancel_reason: null, source: 'manual', organization_id: 'org-283', ...over,
  }
}
const MATCHES = [
  match('m-next', 'U16', 3, '11:00', { opponent: 'Parkview Athletic U16' }),
  match('m-draft', 'U14', 6, '17:30', { opponent: 'Synthetic United U14', published: false, home_away: 'away', venue: 'United Ground' }),
  match('m-past', 'U16', -5, '10:00', { opponent: 'Lakeside FC U16' }),
  match('m-old', null, -12, '18:00', { opponent: 'Riverside Academy' }),
]
// TRAK-285: Greece's Euro 2004 squad as the U16 roster; Karagounis is U14. Zagorakis to Basinas are confirmed, and
// Nikopolidis's family said he can't make it.
const players = [['Theodoros Zagorakis', 'U16'], ['Angelos Charisteas', 'U16'], ['Giorgos Karagounis', 'U14'], ['Traianos Dellas', 'U16'],
  ['Giourkas Seitaridis', 'U16'], ['Michalis Kapsis', 'U16'], ['Takis Fyssas', 'U16'], ['Angelos Basinas', 'U16'],
  ['Antonios Nikopolidis', 'U16'], ['Kostas Katsouranis', 'U16'], ['Stelios Giannakopoulos', 'U16'], ['Zisis Vryzas', 'U16'],
  ['Vasilios Tsiartas', 'U16'], ['Demis Nikolaidis', 'U16']].map(([name, squad], i) => ({
  id: `sq-${i + 1}`, coach_user_id: COACH, player_name: name, position: 'Midfielder', age_group: squad, shirt_number: i + 1,
  status: 'active', linked_player_id: null, created_at: '2026-10-01T08:00:00Z',
}))
const CONFIRMED = ['sq-1', 'sq-2', 'sq-4', 'sq-5', 'sq-6', 'sq-7', 'sq-8'].map(squad_player_id => ({ squad_player_id }))
const ABSENT = [{ squad_player_id: 'sq-9' }]

/** game_plans as the database keeps them: one row per match, written by the app's upsert. TRAK-285: the line-up rows
 *  go under `line-up:<match>:<squad row>`. TRAK-286: a share under `share:<match>`, as share_game_plan logs it. */
type Plans = Map<string, Record<string, unknown>>
// TRAK-286: Theodoros Zagorakis (sq-1) signs in as a player to read the shared plan.
const PLAYER = '97283000-0000-4000-8000-000000000002'

async function backend(context: BrowserContext, unexpected: string[], plans: Plans, me = COACH) {
  const user = { id: me, email: 'coach@games283.test', email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: me, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-games283-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/1' },
      body: JSON.stringify(single && Array.isArray(rows) ? rows[0] ?? null : rows) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') {
      const asked = url.searchParams.get('user_id') ?? ''
      // A player reads only their own profile, never their coach's (TRAK-300): the note's name comes with the copy.
      return json([{ user_id: COACH, id: COACH, role: 'coach', full_name: 'Fernando Santos' },
        { user_id: PLAYER, id: PLAYER, role: 'player', full_name: 'Theodoros Zagorakis' }]
        .filter(profile => asked.includes(profile.user_id) && (me === COACH || profile.user_id === me)))
    }
    // TRAK-286: what Share wrote for Theodoros, and the share itself.
    if (path === '/rest/v1/rpc/child_events') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(MATCHES.filter(m => m.published && (!id || m.id === id)))
    }
    if (path === '/rest/v1/game_for_family') return json(plans.has('share:m-next') ? [{ event_id: 'm-next', squad_player_id: 'sq-1',
      role: 'starter', job: 'Stay tight to their winger.', has_note: true, changed_at: null, coach_name: 'Fernando Santos' }] : [])
    if (path === '/rest/v1/game_for_player') return json(plans.has('share:m-next') ? [{ event_id: 'm-next', squad_player_id: 'sq-1',
      goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
      note: 'Second game at right-back. Proud of you.', changed_at: null }] : [])
    // TRAK-288: the evaluation draft as save_game_evaluation keeps it, under `evaluation:<match>`.
    if (path === '/rest/v1/rpc/save_game_evaluation') {
      const body = req.postDataJSON() as Record<string, unknown>
      const saved_at = new Date().toISOString()
      plans.set(`evaluation:${body.p_event_id}`, { ...body, saved_at })
      return json(saved_at)
    }
    // TRAK-289: publishing marks the draft published and writes Theodoros's review (sq-1), as publish_game_evaluation does.
    if (path === '/rest/v1/rpc/publish_game_evaluation') {
      const body = req.postDataJSON() as { p_event_id: string }
      const draft = plans.get(`evaluation:${body.p_event_id}`)!
      plans.set(`evaluation:${body.p_event_id}`, { ...draft, published_at: new Date().toISOString() })
      const played = (draft.p_players as { played: boolean }[]).filter(p => p.played).length
      return json({ reviews: played, logged: 0, skipped: [] })
    }
    if (path === '/rest/v1/game_review_for_family' || path === '/rest/v1/game_review_for_player') {
      const draft = [...plans.entries()].find(([key, value]) => key.startsWith('evaluation:') && value.published_at)?.[1]
      const own = (draft?.p_players as { id: string; played: boolean; did_job?: string; against_expectation?: string; note?: string }[] | undefined)
        ?.find(p => p.id === 'sq-1' && p.played)
      if (!draft || !own) return json([])
      const line = (plans.get(`line-up:${draft.p_event_id}:sq-1`) ?? {}) as { job?: string; context?: string[]; expectation?: string }
      return json(path.endsWith('for_player') ? (own.note ? [{ event_id: draft.p_event_id, squad_player_id: 'sq-1', note: own.note }] : [])
        : [{ event_id: draft.p_event_id, session_id: 'session-1', squad_player_id: 'sq-1', our_score: draft.p_our_score, their_score: draft.p_their_score,
          job: line.job ?? '', did_job: own.did_job ?? 'yes', expectation: line.expectation ?? 'usual', context: line.context ?? [],
          against_expectation: own.against_expectation ?? 'met', has_note: !!own.note, coach_name: 'Fernando Santos', published_at: draft.published_at }])
    }
    if (path.startsWith('/rest/v1/game_evaluation')) {
      const drafts = [...plans.entries()].filter(([key]) => key.startsWith('evaluation:')).map(([, draft]) => draft)
      const one = url.searchParams.get('event_id')?.replace(/^eq\./, '')
      const mine = drafts.filter(draft => !one || draft.p_event_id === one)
      const listed = mine.flatMap(draft => draft.p_players as { id: string; played: boolean; did_job?: string; against_expectation?: string; note?: string }[])
      if (path === '/rest/v1/game_evaluations') return json(mine.map(draft => ({ event_id: draft.p_event_id, our_score: draft.p_our_score,
        their_score: draft.p_their_score, goals: draft.p_goals, how_they_scored: draft.p_how_they_scored, plan_worked: draft.p_plan_worked,
        saved_at: draft.saved_at, published_at: draft.published_at ?? null })))
      if (path === '/rest/v1/game_evaluation_players') return json(listed.map(p => ({ squad_player_id: p.id, played: p.played,
        did_job: p.did_job ?? 'yes', against_expectation: p.against_expectation ?? 'met' })))
      if (path === '/rest/v1/game_evaluation_notes') return json(listed.filter(p => p.note).map(p => ({ squad_player_id: p.id, note: p.note })))
    }
    if (path === '/rest/v1/game_shares') return json([...plans.entries()].filter(([key]) => key.startsWith('share:')).map(([, share]) => share))
    if (path === '/rest/v1/rpc/share_game_plan') {
      const body = req.postDataJSON() as { p_event_id: string; p_talked: boolean }
      plans.set(`share:${body.p_event_id}`, { event_id: body.p_event_id, shared_at: new Date().toISOString(), talked: body.p_talked })
      return json(1)
    }
    if (path === '/rest/v1/squad_players' && me === PLAYER) return json([{ id: 'sq-1', coach_user_id: COACH }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: COACH, organization_id: 'org-283', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/organizations') return json([{ id: 'org-283', name: 'Rehearsal FC', logo_url: null }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/event_confirmations') return json(CONFIRMED)
    if (path === '/rest/v1/event_absences') return json(ABSENT)
    if (path === '/rest/v1/game_plan_players' && req.method() === 'POST') {
      for (const row of req.postDataJSON() as Record<string, unknown>[]) plans.set(`line-up:${row.event_id}:${row.squad_player_id}`, row)
      return route.fulfill({ status: 201, body: '' })
    }
    if (path === '/rest/v1/game_plan_players') {
      const one = url.searchParams.get('event_id')?.replace(/^eq\./, '')
      return json([...plans.entries()].filter(([key]) => key.startsWith(`line-up:${one}:`)).map(([, row]) => row))
    }
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    if (path === '/rest/v1/coach_calendar_events') {
      const one = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(one ? MATCHES.filter(m => m.id === one) : MATCHES)
    }
    if (path === '/rest/v1/game_plans' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>
      plans.set(body.event_id as string, { ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return route.fulfill({ status: 201, body: '' })
    }
    if (path === '/rest/v1/game_plans') {
      const one = url.searchParams.get('event_id')?.replace(/^eq\./, '')
      return json([...plans.entries()].filter(([key, plan]) => !key.includes(':') && (!one || plan.event_id === one)).map(([, plan]) => plan))
    }
    // Every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

async function open(page: Page, context: BrowserContext, path: string, width: number, height: number, plans: Plans = new Map(), me = COACH) {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await backend(context, unexpected, plans, me)
  await page.goto(path)
  return { unexpected, errors }
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** Tab from the top of the page; every control in `scope` must take focus at least once. A tab list is one stop
 *  (roving focus): its other tabs are reached with the arrow keys, which the tests check separately. So is a radio
 *  group, when `fields` adds a form's inputs. A closed card's fields are inert (TRAK-288), so they're left out. */
async function everyControlByKeyboard(page: Page, scope: string, fields = false) {
  const kinds = `a[href], button:not([disabled]), [tabindex="0"]${fields ? ', input:not([type="radio"]), textarea' : ''}`
  const controls = await page.locator(`${scope} :is(${kinds}):not([tabindex="-1"], [role="tablist"])`).evaluateAll(els =>
    els.filter(el => (el as HTMLElement).offsetParent !== null && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[inert]'))
      .map((el, i) => { (el as HTMLElement).dataset.kb = String(i); return String(i) }))
  const reached = new Set<string>()
  await page.locator('body').focus()
  for (let i = 0; i < 120 && reached.size < controls.length; i++) {
    await page.keyboard.press('Tab')
    const kb = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.kb)
    if (kb) reached.add(kb)
  }
  const missed = controls.filter(kb => !reached.has(kb))
  const names = await Promise.all(missed.map(kb => page.locator(`[data-kb="${kb}"]`).first().evaluate(el => el.outerHTML.slice(0, 120))))
  return { count: controls.length, missed: names }
}

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`Games home at ${width} px: the next game, open drafts and the squad's matches`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([['m-next', { event_id: 'm-next', strength: null, their_formation: null, key_players: [], scouting: '',
      goals: [{ title: 'Win it back in their half', looks_like: '' }], created_at: '2026-10-27T17:00:00Z', updated_at: '2026-10-27T17:40:00Z' }]])
    const { unexpected, errors } = await open(page, context, '/coach/games', width, height, plans)
    await expect(page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible()
    const next = page.getByRole('region', { name: 'Next game' })
    await expect(next.getByText('vs Parkview Athletic U16')).toBeVisible()
    await expect(next.getByText('Plan not shared')).toBeVisible()
    // TRAK-286: with a draft, sharing it is next.
    await expect(next.getByRole('button', { name: 'Share the plan' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Open drafts' }).getByRole('button', { name: 'Open the plan, vs Parkview Athletic U16' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your games' }).getByRole('link')).toHaveCount(4)
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`games-home-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.count).toBeGreaterThan(5)
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`a game's page at ${width} px: Logistics, then Game plan and Evaluation`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/games/m-draft', width, height)
    await expect(page.getByRole('heading', { level: 1, name: 'vs Synthetic United U14' })).toBeVisible()
    await expect(page.getByText('Logistics not shared')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`game-logistics-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[960px\\]')
    expect(keyboard.missed).toEqual([])

    // The keyboard moves between the panels (Arc tabs).
    await page.getByRole('tab', { name: 'Logistics' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('heading', { name: 'Your goals' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    // TRAK-288: until full time it says when it opens.
    await expect(page.getByRole('heading', { name: /^Opens at full time, \d\d:\d\d$/ })).toBeVisible()
    expect(page.url()).toContain('?tab=evaluation')
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`a game's plan at ${width} px: opponent and goals, kept across tabs and saved as a draft`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map()
    const { unexpected, errors } = await open(page, context, '/coach/games/m-next?tab=plan', width, height, plans)
    await expect(page.getByRole('heading', { name: 'Your goals' })).toBeVisible()
    await expect(page.getByText('Plan not written')).toBeVisible()
    const goal = page.getByRole('group', { name: 'Goal 1' })
    await goal.getByLabel('Goal').fill('Win it back in their half')
    await goal.getByLabel('What it looks like').fill('Press when their keeper plays short.')
    await page.getByText('Stronger', { exact: true }).click()
    await page.getByRole('button', { name: 'Add a key player' }).click()
    const player = page.getByRole('group', { name: 'Key player 1' })
    await player.getByLabel('Number').fill('9')
    await player.getByLabel('Position').fill('Striker')
    await player.getByLabel('Note').fill('Quick. Runs in behind.')
    await page.getByLabel('What you know about them').fill('Their keeper plays short to the left centre-back.')

    // A look at Logistics, with the panel's exit animation, keeps every field.
    await page.getByRole('tab', { name: 'Logistics' }).click()
    await expect(page.getByText('Shared with families')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('tab', { name: 'Game plan' }).click()
    await expect(goal.getByLabel('Goal')).toHaveValue('Win it back in their half')
    await expect(player.getByLabel('Number')).toHaveValue('9')

    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    await expect(page.getByText('Plan not shared')).toBeVisible()
    expect(plans.get('m-next')).toMatchObject({ strength: 'stronger', key_players: [{ number: 9, position: 'Striker', note: 'Quick. Runs in behind.' }],
      goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }] })
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`game-plan-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(10)
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-285: on a phone the player's sheet is a bottom sheet: it opens, scrolls, and closes with Esc and with a swipe.
test("a game's line-up at 390 px: the player's sheet opens, scrolls and closes with Esc and with a swipe", async ({ page, context }, testInfo) => {
  const { unexpected, errors } = await open(page, context, '/coach/games/m-next?tab=plan', 390, 844)
  await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
  await expect(page.getByRole('heading', { name: '4-4-2' })).toBeVisible()
  await page.getByRole('button', { name: 'Slot 1, empty' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Who plays here?' }).click()
  await page.getByRole('option', { name: /^Theodoros Zagorakis/ }).click()
  await expect(sheet.getByLabel('Job · Theodoros and family see it')).toBeVisible()
  await sheet.getByLabel('Job · Theodoros and family see it').fill('Command the box on crosses.')
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('line-up-sheet-390.png') })

  // Expanded with its grabber, it scrolls to the last field.
  await sheet.getByRole('button', { name: 'Expand sheet' }).click()
  await page.waitForTimeout(500)
  const box = (await sheet.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75)
  await page.mouse.wheel(0, 1200)
  await expect(sheet.getByRole('group', { name: 'Expectation · only you' })).toBeInViewport()

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('button', { name: 'Theodoros Zagorakis, slot 1' })).toBeVisible()

  // A swipe down on the sheet's header closes it too.
  await page.getByRole('button', { name: 'Theodoros Zagorakis, slot 1' }).click()
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(500)
  const title = (await sheet.getByRole('heading', { name: 'Theodoros Zagorakis' }).boundingBox())!
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2)
  await page.mouse.down()
  await page.mouse.move(title.x + title.width / 2, title.y + 520, { steps: 12 })
  await page.mouse.up()
  await expect(sheet).toBeHidden()
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-285: on a laptop the sheet is a panel beside the pitch, so the pitch stays in view while the coach edits.
test("a game's line-up at 1440 px: the pitch stays in view while the panel beside it is edited", async ({ page, context }, testInfo) => {
  const plans: Plans = new Map()
  const { unexpected, errors } = await open(page, context, '/coach/games/m-next?tab=plan', 1440, 900, plans)
  await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
  const pitch = page.getByRole('region', { name: '4-4-2' })
  await expect(pitch).toBeVisible()
  await page.waitForTimeout(400)
  await page.getByRole('region', { name: 'Format and formation' }).screenshot({ path: testInfo.outputPath('formations-1440.png') })
  await page.getByRole('button', { name: 'Slot 2, empty' }).click()
  await page.getByRole('combobox', { name: 'Who plays here?' }).click()
  await page.getByRole('option', { name: /^Traianos Dellas/ }).click()
  const job = page.getByLabel('Job · Traianos and family see it')
  await job.fill('Stay tight to their number 9. Win the first header.')
  await expect(pitch).toBeInViewport()
  await expect(job).toBeInViewport()
  await expect(page.getByRole('progressbar', { name: '1 of 11 starters have a job' })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  expect(plans.get('line-up:m-next:sq-4')).toMatchObject({ role: 'starter', slot: 2, job: 'Stay tight to their number 9. Win the first header.' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: testInfo.outputPath('line-up-1440.png'), fullPage: true })
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
  expect(keyboard.missed).toEqual([])
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-286: the Share step. Share now waits for the face-to-face tick; the keyboard ticks it and shares. The preview
// switches between the player and the parent with the arrow keys, and the parent never reads the note.
const DRAFT = (): Plans => new Map([
  ['m-next', { event_id: 'm-next', strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11,
    formation: '4-4-2', goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
    created_at: '2026-10-27T17:00:00Z', updated_at: '2026-10-27T17:40:00Z' }],
  ['line-up:m-next:sq-1', { event_id: 'm-next', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
    note: 'Second game at right-back. Proud of you.', context: ['out_of_position'], expectation: 'stretch' }],
])
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`a game's Share step at ${width} px: the preview by keyboard, then tick and share`, async ({ page, context }, testInfo) => {
    const plans = DRAFT()
    const { unexpected, errors } = await open(page, context, '/coach/games/m-next?tab=plan&step=share', width, height, plans)
    const block = page.getByRole('region', { name: 'Share the plan' })
    await expect(block).toBeVisible()
    const shareNow = block.getByRole('button', { name: 'Share now' })
    await expect(shareNow).toBeDisabled()
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(preview.getByRole('heading', { name: 'From Coach Fernando Santos · just for you' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`share-step-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    await preview.getByRole('button', { name: 'As the player' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(preview.getByText('Theodoros’s job')).toBeVisible()
    await expect(preview.getByText('Coach Fernando Santos’s note is just for Theodoros.')).toBeVisible()
    await expect(preview.getByText('Second game at right-back. Proud of you.')).toHaveCount(0)

    const tick = block.getByRole('checkbox', { name: /talked selection through/ })
    await tick.focus()
    await page.keyboard.press('Space')
    await expect(tick).toBeChecked()
    await expect(shareNow).toBeEnabled()
    // Every control, Share now included once it's enabled, takes focus from the keyboard.
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(5)
    expect(keyboard.missed).toEqual([])
    await shareNow.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Shared' })).toBeVisible()
    expect(plans.get('share:m-next')).toMatchObject({ talked: true })
    expect(plans.get('m-next')).toMatchObject({ goals: [{ title: 'Win it back in their half' }] })
    await expect(page.getByText('Plan shared').first()).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`shared-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-286: what Theodoros reads on his phone once it's shared: the goals, his job and the note just for him.
test("the player's event page at 390 px: the shared game plan", async ({ page, context }, testInfo) => {
  const plans = DRAFT()
  plans.set('share:m-next', { event_id: 'm-next', shared_at: new Date().toISOString() })
  const { unexpected, errors } = await open(page, context, '/player/event/m-next', 390, 844, plans, PLAYER)
  const section = page.getByRole('region', { name: 'Game plan' })
  await expect(section).toBeVisible()
  await expect(section.getByText('1 · Win it back in their half')).toBeVisible()
  await expect(section.getByText('Your job')).toBeVisible()
  await expect(section.getByRole('heading', { name: 'From Coach Fernando Santos · just for you' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: testInfo.outputPath('player-game-plan-390.png'), fullPage: true })
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-287: a match that has kicked off shows its plan locked: read only, with no Save or Share, and the lock's note.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`a locked plan at ${width} px: read only, with the lock's note`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([
      ['m-past', { event_id: 'm-past', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: 'Their 9 is quick.', format: 11,
        formation: '4-4-2', goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
        created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }],
      ['line-up:m-past:sq-1', { event_id: 'm-past', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
        note: '', context: [], expectation: 'usual' }],
    ])
    const { unexpected, errors } = await open(page, context, '/coach/games/m-past?tab=plan', width, height, plans)
    await expect(page.getByText(/^Locked at kick-off, \d\d:\d\d$/)).toBeVisible()
    await expect(page.getByText(/It wasn’t shared, so only you saw it\./)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Goal' })).toHaveAttribute('readonly', '')
    await expect(page.getByRole('button', { name: /Add a goal/ })).toHaveCount(0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`locked-plan-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    // Read-only fields still take focus, so the plan can be read with the keyboard.
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(3)
    expect(keyboard.missed).toEqual([])
    await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
    await expect(page.getByText('Tap a player to see their job and note.')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`locked-line-up-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-288: after full time, the evaluation as one draft: Result, Team and Players, read against the plan as it locked,
// saved with Save draft · sleep on it and reloaded. Every field is reachable by keyboard, and nothing scrolls sideways.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`an evaluation at ${width} px: every step by keyboard, saved as a draft and reloaded`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([
      ['m-past', { event_id: 'm-past', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: '', format: 11, formation: '4-4-2',
        goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }, { title: 'Switch play early', looks_like: '' }],
        created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }],
      ['line-up:m-past:sq-1', { event_id: 'm-past', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
        note: '', context: ['out_of_position'], expectation: 'stretch' }],
      ['line-up:m-past:sq-4', { event_id: 'm-past', squad_player_id: 'sq-4', role: 'starter', slot: 2, job: 'Win the first header.',
        note: '', context: [], expectation: 'usual' }],
    ])
    const { unexpected, errors } = await open(page, context, '/coach/games/m-past?tab=evaluation', width, height, plans)
    // Result: 2–1, Zagorakis scored the first, Charisteas came on.
    await page.getByRole('button', { name: 'Increase Our score' }).click()
    await page.getByRole('button', { name: 'Increase Our score' }).click()
    await page.getByRole('button', { name: 'Increase Their score' }).click()
    await page.getByRole('combobox', { name: 'Scored by' }).first().click()
    await page.getByRole('option', { name: 'Theodoros Zagorakis' }).click()
    await page.getByRole('checkbox', { name: 'Angelos Charisteas' }).click()
    await page.getByRole('textbox', { name: 'How their goals came' }).fill('A corner at the back post.')
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-result-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    let keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(10)
    expect(keyboard.missed).toEqual([])

    // Team: did the plan work?
    await page.getByRole('button', { name: 'Next: Team' }).click()
    await page.getByRole('group', { name: 'Win it back in their half' }).getByText('Worked').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-team-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    // Players: everyone starts at Did the job · Met; Zagorakis did part of his job, above what was expected.
    await page.getByRole('button', { name: 'Next: Players' }).click()
    const card = page.getByRole('button', { name: /^Theodoros Zagorakis/ })
    await expect(card).toContainText('Did the job · Met')
    await expect(card).toContainText('Expected: Stretch')
    await card.click()
    const expanded = page.locator('article').filter({ has: card })
    await expanded.getByRole('group', { name: 'Did the job' }).getByText('Partly').click()
    await expanded.getByRole('group', { name: 'Against expectation' }).getByText('Above').click()
    await expanded.getByRole('textbox', { name: /^Note to Theodoros/ }).fill('Brave all game.')
    await expect(card).toContainText('Did part of the job · Above')
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-players-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.missed).toEqual([])

    await page.getByRole('button', { name: 'Save draft · sleep on it' }).click()
    await expect(page.getByText(/^Draft saved \d\d:\d\d$/)).toBeVisible()
    await expect(page.getByText('Evaluation draft')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-saved-${width}.png`) })

    // A reload shows the draft.
    await page.reload()
    await expect(page.getByRole('spinbutton', { name: 'Our score' })).toHaveAttribute('aria-valuenow', '2')
    await expect(page.getByRole('checkbox', { name: 'Angelos Charisteas' })).toBeChecked()
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-289: publishing closes the loop. The coach publishes a complete draft from the Publish step, sees the closed
// loop with its History, and the player reads After the game on their event page. By keyboard, with no sideways scroll.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`publishing at ${width} px: the Publish step, the closed loop, and the player's After the game`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([
      ['m-past', { event_id: 'm-past', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: '', format: 11, formation: '4-4-2',
        goals: [{ title: 'Win it back in their half', looks_like: '' }, { title: 'Switch play early', looks_like: '' }],
        created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }],
      ['line-up:m-past:sq-1', { event_id: 'm-past', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
        note: '', context: ['out_of_position'], expectation: 'stretch' }],
      ['line-up:m-past:sq-4', { event_id: 'm-past', squad_player_id: 'sq-4', role: 'starter', slot: 2, job: 'Win the first header.',
        note: '', context: [], expectation: 'usual' }],
      ['evaluation:m-past', { p_event_id: 'm-past', p_our_score: 2, p_their_score: 1, p_goals: [{ scorer: 'sq-1', assist: null }, { scorer: null, assist: null }],
        p_how_they_scored: 'A corner.', p_plan_worked: ['worked', 'partly'], saved_at: '2026-10-24T17:40:00Z',
        p_players: [{ id: 'sq-1', played: true, did_job: 'partly', against_expectation: 'above', note: 'Brave all game.' }, { id: 'sq-4', played: true }] }],
    ])
    const coach = await open(page, context, '/coach/games/m-past?tab=evaluation', width, height, plans)
    await page.getByRole('button', { name: 'Next: Team' }).click()
    await page.getByRole('button', { name: 'Next: Players' }).click()
    await page.getByRole('button', { name: 'Next: Publish' }).click()
    await expect(page.getByText('2 players · 1 changed from “Met” · 1 note')).toBeVisible()
    // This match was made before New event asked the competition (Imad, 29 Oct): the Publish step asks it.
    await expect(page.getByText('Pick the competition first.')).toBeVisible()
    await page.getByRole('group', { name: 'Competition' }).getByText('League').click()
    await expect(page.getByRole('button', { name: 'Publish to 2 players and families' })).toBeEnabled()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`publish-step-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])')
    expect(keyboard.missed).toEqual([])

    await page.getByRole('button', { name: 'Publish to 2 players and families' }).click()
    await expect(page.getByText('Published to 2 players and their families. The loop is closed.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'History' }).getByText('Evaluation published. The loop is closed.')).toBeVisible()
    await expect(page.locator('header.arc').getByText('Published')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`published-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(coach.unexpected).toEqual([])
    expect(coach.errors).toEqual([])

    // Theodoros reads After the game on his event page.
    const player = await page.context().browser()!.newContext({ timezoneId: 'Asia/Dubai' })
    const phone = await player.newPage()
    const kid = await open(phone, player, '/player/event/m-past', width, height, plans, PLAYER)
    const after = phone.getByRole('region', { name: 'After the game' })
    await expect(after.getByText('You did part of your job')).toBeVisible()
    await expect(after.getByText('From Coach Fernando Santos · just for you')).toBeVisible()
    await phone.waitForTimeout(500)
    await phone.screenshot({ path: testInfo.outputPath(`player-after-the-game-${width}.png`), fullPage: true })
    expect(await sideways(phone)).toBeLessThanOrEqual(0)
    expect(kid.unexpected).toEqual([])
    expect(kid.errors).toEqual([])
    await player.close()
  })
}
