import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-294 (Training 1/5): Training home (Sessions and Drills; TRAK-387: Drills is the Library) with the academy's training
// switch on, at a phone's and a laptop's width: no sideways scroll, and the keyboard reaches every control.
// TRAK-295 (Training 2/5): planning a training: "How do you want to plan it?", Write my own, and the plan, at the
// same two widths. TRAK-296 (Training 3/5): the Add/Swap sheet's My drills and Library views, and a Library preview.
// TRAK-297 (Training 4/5): Copy a past session. TRAK-298 (Training 5/5): View (TRAK-309: was Run it), and a closed training's log.
// TRAK-304: Home's Today card with a training planned today: the week first, then the day's practices; a training's
// name, however long, isn't on it.
// TRAK-306: the side menu (a laptop's sidebar, a phone's sheet) cuts no letter: g, q and p keep their tails.
// TRAK-310: each training coming up has View plan and Edit plan, or Create plan, on its right.
// TRAK-339 (Training redo 1/5): Training home like Matches: the Next training card, Upcoming trainings, Past trainings;
// Plan session goes straight to the planner, Use a past plan copies one, and Notes close a training.
// Production build, synthetic intercepted backend; test people are named after footballers.
test.use({ timezoneId: 'Asia/Dubai' })

const COACH = '97294000-0000-4000-8000-000000000001'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** A Dubai academy's training (UTC+4 all year): the wall clock typed and its instant. */
function training(id: string, squad: string | null, days: number, hhmm: string, title: string, over: Record<string, unknown> = {}) {
  const date = new Date(Date.now() + 4 * 60 * MINUTE + days * DAY).toISOString().slice(0, 10)
  const starts = Date.parse(`${date}T${hhmm}:00+04:00`)
  return {
    id, coach_user_id: COACH, squad, title, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + 90 * MINUTE).toISOString(), event_date: date,
    start_time: `${hhmm}:00`, venue: 'Pitch 2', organization_id: 'org-294', ...over,
  }
}
const TRAININGS = [
  training('t-thu', 'U16', 2, '18:00', 'Before AEK U16 on Saturday'),
  training('t-tue', 'U16', 7, '18:00', 'Receiving under pressure'),
  training('t-u14', 'U14', 3, '17:00', 'U14 finishing', { published: false }),
  training('t-last', 'U16', -5, '18:00', 'Pressing zones'),
]
// Receiving under pressure is planned already. Each test starts from this; a save keeps the plan sent, so the plan
// page reads it back.
const PLANNED: [string, Record<string, unknown>[]][] = [['t-tue', [
  { position: 1, name: 'Warm-up: rondos 4v1', minutes: 15, how: '', tell: '', area: '10 × 10 m', numbers: '', direction: '', targets: '',
    conditions: '', source: 'drill', drill_id: 'd-1', library_session: null },
  { position: 2, name: 'Pressing on the trigger', minutes: 25, how: '', tell: 'Press as soon as their 6 turns back.', area: '30 × 40 m',
    numbers: '6v6', direction: '', targets: '', conditions: '', source: 'own', drill_id: null, library_session: null },
]], ['t-last', [
  { position: 1, name: 'Pressing zones', minutes: 30, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
    source: 'own', drill_id: null, library_session: null },
]]]
// TRAK-298: last week's training had its register taken, so it is closed.
const SESSIONS = [{ id: 's-last', event_id: 't-last', session_type: 'training', title: 'Pressing zones', session_date: null, training_type: null, notes: null }]
const players = [['Thierry Henry', 'U16'], ['Patrick Vieira', 'U16'], ['Robert Pires', 'U14']].map(([name, squad], i) => ({
  id: `sq-${i + 1}`, coach_user_id: COACH, player_name: name, position: 'Midfielder', age_group: squad, shirt_number: i + 1,
  status: 'active', linked_player_id: null, created_at: '2026-10-01T08:00:00Z',
}))

async function backend(context: BrowserContext, unexpected: string[], trainings = TRAININGS, extra: typeof PLANNED = [], sessions = SESSIONS,
  attendance: { session_id: string; squad_player_id: string; status: string }[] = []) {
  const plans = new Map([...PLANNED, ...extra])
  const user = { id: COACH, email: 'coach@training294.test', email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: COACH, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-training294-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  // TRAK-390: the coach's bookmarks (My drills), kept for the test.
  const bookmarks = new Set<string>()
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: COACH, id: COACH, role: 'coach', full_name: 'Jürgen Klopp' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: COACH, organization_id: 'org-294', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/organizations') return json([{ id: 'org-294', name: 'Rehearsal FC', logo_url: null }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    // TRAK-350: the season plan's switch is on here, so Home asks for the squad's plan; there is none.
    if (path === '/rest/v1/season_plans') return json([])
    // An `eq.` or `in.(…)` filter, as PostgREST reads it; no filter matches everything.
    const matches = (key: string) => {
      const value = url.searchParams.get(key)
      const wanted = value?.startsWith('in.(') ? value.slice(4, -1).split(',') : value ? [value.slice(3)] : null
      return (id: string) => !wanted || wanted.includes(id)
    }
    if (path === '/rest/v1/coach_calendar_events') return json(trainings.filter(t => matches('id')(t.id)))
    if (path === '/rest/v1/training_plans') {
      return json([...plans.keys()].filter(matches('event_id')).map(event_id => ({ event_id, updated_at: '2026-10-28T10:00:00Z', note: '' })))
    }
    if (path === '/rest/v1/training_plan_practices') {
      return json([...plans].filter(([id]) => matches('event_id')(id)).flatMap(([event_id, rows]) => rows.map(row => ({ event_id, ...row }))))
    }
    if (path === '/rest/v1/coach_sessions') {
      const id = url.searchParams.get('id')?.slice(3)
      return json(id ? sessions.filter(session => session.id === id) : sessions.map(({ id: sid, event_id }) => ({ id: sid, event_id })))
    }
    if (path === '/rest/v1/session_attendance') return json(attendance)
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/rpc/save_training_plan') {
      const { p_event_id, p_practices } = req.postDataJSON() as { p_event_id: string; p_practices: Record<string, unknown>[] }
      // As the database does: a practice ticked "Save to My drills" becomes the coach's drill.
      plans.set(p_event_id, p_practices.map(({ save_to_drills, ...p }, i) =>
        ({ ...p, position: i + 1, ...(save_to_drills ? { source: 'drill', drill_id: `drill-${i + 1}` } : {}) })))
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/rest/v1/coach_drill_bookmarks') {
      if (req.method() === 'POST') { bookmarks.add((req.postDataJSON() as { drill: string }).drill); return route.fulfill({ status: 201, body: '' }) }
      if (req.method() === 'DELETE') { bookmarks.delete(url.searchParams.get('drill')!.slice(3)); return route.fulfill({ status: 204, body: '' }) }
      return json([...bookmarks].map(drill => ({ drill, created_at: '2026-11-09T00:00:00Z' })))
    }
    // Every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

async function open(page: Page, context: BrowserContext, path: string, width: number, height: number, trainings = TRAININGS,
  ...more: Parameters<typeof backend> extends [unknown, unknown, unknown, ...infer R] ? R : never) {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await backend(context, unexpected, trainings, ...more)
  await page.goto(path)
  return { unexpected, errors }
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** Tab from the top of the page; every control in `scope` must take focus at least once. */
async function everyControlByKeyboard(page: Page, scope: string) {
  const controls = await page.locator(`${scope} :is(a[href], button:not([disabled]), input, textarea, [tabindex="0"]):not([tabindex="-1"])`).evaluateAll(els =>
    els.filter(el => (el as HTMLElement).offsetParent !== null && el.getAttribute('aria-hidden') !== 'true'
      // Add details folded away: its fields take focus once it's opened.
      && !el.closest('details:not([open])')
      // A segmented control is one stop (roving focus): only its selected option takes Tab.
      && !(el.closest('[role="group"][aria-label="Training view"]') && el.getAttribute('aria-pressed') !== 'true'))
      .map((el, i) => { (el as HTMLElement).dataset.kb = String(i); return String(i) }))
  const reached = new Set<string>()
  await page.locator('body').focus()
  for (let i = 0; i < 100 && reached.size < controls.length; i++) {
    await page.keyboard.press('Tab')
    const kb = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.kb)
    if (kb) reached.add(kb)
  }
  const missed = controls.filter(kb => !reached.has(kb))
  const names = await Promise.all(missed.map(kb => page.locator(`[data-kb="${kb}"]`).first().evaluate(el => el.outerHTML.slice(0, 120))))
  return { count: controls.length, missed: names }
}

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`Training home at ${width} px: the Next training card, Upcoming trainings, Past trainings`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    await expect(page.getByRole('heading', { level: 1, name: 'Training' })).toHaveCount(1)
    const next = page.getByRole('region', { name: 'Before AEK U16 on Saturday' })
    await expect(next.getByText('Plan not written')).toBeVisible()
    await expect(next.getByRole('button', { name: 'Plan session' })).toBeVisible()
    await expect(next.getByRole('button', { name: 'Use a past plan' })).toBeVisible()
    const upcoming = page.getByRole('region', { name: 'Upcoming trainings' }).first()
    await expect(upcoming.getByRole('link')).toHaveCount(3)
    await expect(upcoming.getByRole('link').first()).toContainText('Before AEK U16 on Saturday')
    await expect(upcoming.getByRole('link', { name: /Receiving under pressure/ })).toContainText('Plan ready')
    await expect(page.getByRole('button', { name: /^Past trainings/ })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`training-sessions-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.count).toBeGreaterThan(5)
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-305, TRAK-324: one squad switcher (the sidebar on a laptop; TRAK-376, the side menu on a phone, opened by the
  // page's avatar); the pick holds.
  test(`Age groups at ${width} px: picked once in the switcher, kept after a reload`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    const phone = width < 1024
    const menu = async () => {
      if (!phone) return
      await page.getByRole('button', { name: 'Open menu' }).click()
      await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
    }
    const closeMenu = async () => {
      if (!phone) return
      await page.getByRole('button', { name: 'Close menu' }).click()
      await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)
    }
    const coming = page.getByRole('region', { name: 'Upcoming trainings' }).first()
    await expect(coming.getByRole('link')).toHaveCount(3)
    if (phone) await expect(page.getByRole('button', { name: /^Squad: / })).toHaveCount(0)
    await menu()
    const trigger = page.getByRole('button', { name: /^Squad: / })
    await expect(trigger).toHaveAccessibleName(/^Squad: All squads\./)
    await trigger.click()
    const options = page.getByRole('listbox').getByRole('option')
    await expect(options).toHaveCount(3)
    // Squads have no role, so the tick is pinned to the last column; otherwise "All squads" was cut to "All squ…".
    expect(await options.evaluateAll(rows => rows.filter(row => {
      const name = row.querySelector<HTMLElement>('[class*="rowName"]')!
      return name.scrollWidth > name.clientWidth
    }).length)).toBe(0)
    await expect(page.getByText('Create workspace')).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`squad-switcher-${width}.png`) })
    await page.getByRole('option', { name: /^U14/ }).click()
    await expect(trigger).toHaveAccessibleName(/^Squad: U14\./)
    await closeMenu()
    await expect(coming.getByRole('link')).toHaveCount(1)
    await expect(coming.getByRole('link')).toContainText('U14 finishing')
    await page.reload()
    await menu()
    await expect(page.getByRole('button', { name: /^Squad: / })).toHaveAccessibleName(/^Squad: U14\./)
    await closeMenu()
    await expect(page.getByRole('region', { name: 'Upcoming trainings' }).first().getByRole('link')).toHaveCount(1)
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-387 (Drill Library 3/11): Drills is the Library: Find a drill, My drills and All drills, the three kinds, a
  // practice page and a drill's page, each picture fitted to the squad. No coach-made drills.
  test(`Drills at ${width} px: the Library home, a practice page and a drill (Harder, Players today, Another drill, bookmarks)`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/drills', width, height)
    await expect(page.getByRole('heading', { name: 'Find a drill' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New drill' })).toHaveCount(0)
    const kinds = page.getByRole('region', { name: 'What kind of practice?' })
    await expect(kinds.getByRole('link')).toHaveCount(6) // the three tiles, Change any practice, Individual work, Goalkeeping
    // TRAK-394: the old FA Library's tiles left Drills.
    await expect(page.getByRole('region', { name: 'From the Library' })).toHaveCount(0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`training-drills-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.missed).toEqual([])

    // Typing shows picture cards in place of everything else.
    await page.getByRole('searchbox', { name: 'Search drills' }).fill('piggy in the middle')
    await expect(page.getByRole('list', { name: 'Drills found' }).getByRole('link')).toHaveCount(6)
    await expect(kinds).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`training-drills-search-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await page.getByRole('searchbox', { name: 'Search drills' }).fill('')

    await page.getByRole('region', { name: 'What kind of practice?' }).getByRole('link', { name: /^Skill/ }).click()
    await expect(page.getByRole('heading', { name: 'Skill practices', level: 1 })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-drills-skill-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    // TRAK-390: the card's bookmark adds the drill to My drills.
    await page.getByRole('button', { name: 'Add to My drills: Keep the ball' }).click()
    await expect(page.getByRole('button', { name: 'In My drills: Keep the ball' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Added to My drills')).toBeVisible()
    await page.getByRole('link', { name: /^Keep the ball/ }).click()
    await expect(page.getByRole('button', { name: 'In My drills' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('img', { name: /^Keep the ball set-up\./ })).toBeVisible()
    // TRAK-389: Harder says what changed and why; Players today refits it.
    await page.getByRole('button', { name: 'Harder' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Harder. Here’s what Trak changed:' })).toBeVisible()
    await page.getByRole('group', { name: 'Players today' }).getByRole('button', { name: 'One player more' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'players today. Trak refitted the drill:' })).toBeVisible()
    // Laid out again (phone ↔ laptop), the drill keeps its level and players.
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height })
    await expect(page.getByRole('status').filter({ hasText: 'players today. Trak refitted the drill:' })).toBeVisible()
    await page.setViewportSize({ width, height })
    await expect(page.getByRole('status').filter({ hasText: 'players today. Trak refitted the drill:' })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-drill-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const drillKeys = await everyControlByKeyboard(page, '.trak-wide')
    expect(drillKeys.missed).toEqual([])
    await page.getByRole('button', { name: 'Another drill' }).click()
    await expect(page.getByRole('heading', { name: 'Four corners', level: 1 })).toBeVisible()
    // My drills shows it.
    await page.goto('/coach/training/drills/mine')
    await expect(page.getByRole('heading', { name: 'Skill practices', level: 2 })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Keep the ball/ })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-my-drills-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-394 (Drill Library 9/11): Change any practice, from the Drills tab. Steve's five things: a set-up's picture and
  // what changes, and Conditions' three rules.
  test(`Change any practice at ${width} px: the five things, an example, Conditions`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/drills', width, height)
    await page.getByRole('link', { name: 'Change any practice' }).click()
    await expect(page.getByRole('heading', { name: 'Change any practice', level: 1 })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Area shape and size example: 20 wide, 40 long' })).toBeVisible()
    await page.getByRole('group', { name: 'Five things that shape a practice' }).getByRole('button', { name: 'Direction' }).click()
    await page.getByRole('group', { name: 'Pick an example' }).getByRole('button', { name: 'End line, 60x15' }).click()
    await expect(page.getByRole('img', { name: 'Direction example: End line, 60x15' })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-change-practice-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keys = await everyControlByKeyboard(page, '.trak-wide')
    expect(keys.missed).toEqual([])
    await page.getByRole('group', { name: 'Five things that shape a practice' }).getByRole('button', { name: 'Conditions' }).click()
    await expect(page.getByRole('list', { name: 'Three rules' }).getByRole('listitem')).toHaveCount(3)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-change-conditions-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-391 (Drill Library 6/11): Add to training. The drill joins the training's plan at the end, at the level set.
  test(`Add to training at ${width} px: a drill page, which training, Review, saved, Added to <day>`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/drills/d/lib-pass-between-defenders', width, height)
    await expect(page.getByRole('heading', { name: 'Pass between defenders', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Harder' }).click()
    await page.getByRole('button', { name: 'Add to training' }).click()
    const picker = page.getByRole('dialog', { name: 'Add Pass between defenders to which training?' })
    const coming = picker.getByRole('list', { name: 'Trainings coming up' })
    await expect(coming.getByRole('listitem').filter({ hasText: 'Before AEK U16 on Saturday' })).toContainText('Not planned')
    await expect(coming.getByRole('listitem').filter({ hasText: 'Receiving under pressure' })).toContainText('Planned')
    await expect(coming.getByRole('listitem').filter({ hasText: 'Pressing zones' })).toHaveCount(0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`training-add-picker-${width}.png`) })
    await coming.getByRole('button', { name: /^Add to Before AEK U16 on Saturday/ }).click()

    await expect(page).toHaveURL(/\/coach\/training\/t-thu\/plan$/)
    await expect(page.getByText('Pass between defenders is added at the end. Check the plan, then save it.')).toBeVisible()
    const plan = page.getByRole('list', { name: 'The plan' }).getByRole('listitem')
    await expect(plan).toHaveCount(6)
    await expect(plan.last()).toContainText('Pass between defenders')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-add-review-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: 'Save the plan' }).click()
    await expect(page).toHaveURL(/\/coach\/training$/)

    // Back on the drill page, the button says where it went and opens the plan.
    await page.goto('/coach/training/drills/d/lib-pass-between-defenders')
    const added = page.getByRole('link', { name: /^Added to / })
    await expect(added).toHaveAttribute('href', '/coach/training/t-thu/plan')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-add-added-${width}.png`), fullPage: true })
    const keys = await everyControlByKeyboard(page, '.trak-wide')
    expect(keys.missed).toEqual([])
    await added.click()
    await expect(page.getByRole('list', { name: 'The plan' }).getByRole('listitem').last()).toContainText('Pass between defenders')
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-395 (Drill Library 11/11): the whole way, once. A Library drill, bookmarked, added to a training that has
  // started, saved with the plan, then Who's here fits it to the players who came (1 of the U16's 2, too few for it).
  test(`Library to Who's here at ${width} px: a drill, bookmarked, added to training, saved, refitted`, async ({ page, context }) => {
    const started = Date.now() - 10 * MINUTE
    const today = { ...training('t-now', 'U16', 0, '18:00', 'Keep it tight'), starts_at: new Date(started).toISOString(),
      ends_at: new Date(started + 90 * MINUTE).toISOString() }
    const { unexpected, errors } = await open(page, context, '/coach/training/drills', width, height, [today, ...TRAININGS], [],
      [...SESSIONS, { id: 's-now', event_id: 't-now', session_type: 'training', title: 'Keep it tight', session_date: null, training_type: null, notes: null }],
      [{ session_id: 's-now', squad_player_id: 'sq-1', status: 'present' }])
    // Library → a drill → bookmark.
    await page.getByRole('region', { name: 'What kind of practice?' }).getByRole('link', { name: /^Skill/ }).click()
    await page.getByRole('link', { name: /^Keep the ball/ }).click()
    await expect(page.getByRole('heading', { name: 'Keep the ball', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Add to My drills' }).click()
    await expect(page.getByRole('button', { name: 'In My drills' })).toHaveAttribute('aria-pressed', 'true')
    // → Add to training → Plan session at Review → saved.
    await page.getByRole('button', { name: 'Add to training' }).click()
    await page.getByRole('dialog', { name: 'Add Keep the ball to which training?' }).getByRole('button', { name: /^Add to Keep it tight/ }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-now\/plan$/)
    // Keep the ball is already Rondo's starter drill, so that part takes it rather than a second copy (TRAK-392).
    await expect(page.getByRole('list', { name: 'The plan' }).getByRole('listitem').filter({ hasText: 'Keep the ball' })).toHaveCount(1)
    await page.getByRole('button', { name: 'Save the plan' }).click()
    await expect(page).toHaveURL(/\/coach\/training$/)
    // → Who's here: the Library drill is fitted again for the one who came.
    await page.goto('/coach/training/t-now/here')
    await expect(page.getByRole('heading', { name: 'Today’s plan for 1 player' })).toBeVisible()
    await expect(page.getByText('Keep the ball is set up for 8 to 20 players. With 1, pick another drill.')).toBeVisible()
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-340: Plan session is parts, one step each, then Review.
  test(`Planning at ${width} px: Trak's five parts, a drill each, Review, saved`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    await page.getByRole('region', { name: 'Before AEK U16 on Saturday' }).getByRole('button', { name: 'Plan session' }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-thu\/plan$/)
    const warmup = page.getByRole('region', { name: 'Dry warm-up' })
    // TRAK-392: the Library's starter drill is picked; the three choices are the Library's.
    await expect(warmup.getByRole('button', { name: /^Moving warm-up/, pressed: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Parts of the session' }).getByRole('listitem')).toHaveCount(5)
    await warmup.getByRole('button', { name: /^Tag games/ }).click()
    await expect(warmup.getByRole('button', { name: /^Tag games/, pressed: true })).toBeVisible()
    await expect(warmup.getByRole('button', { name: /^Moving warm-up/, pressed: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write your own' })).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-part-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.count).toBeGreaterThan(15)
    expect(keyboard.missed).toEqual([])

    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /^Next: / }).click()
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'The plan' }).getByRole('listitem')).toHaveCount(5)
    await page.getByLabel(/A note for you/).fill('Remind the back four to talk.')
    await page.waitForTimeout(300)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-review-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const reviewKeys = await everyControlByKeyboard(page, '.trak-wide')
    expect(reviewKeys.missed).toEqual([])

    await page.getByRole('button', { name: 'Save the plan' }).click()
    await expect(page).toHaveURL(/\/coach\/training$/)
    await expect(page.getByText(/^Plan saved for Before AEK U16 on Saturday,/)).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-saved-${width}.png`), fullPage: true })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Planner pop-ups at ${width} px: Add a part, Find another drill, View drill`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/t-thu/plan', width, height)
    await expect(page.getByRole('region', { name: 'Dry warm-up' })).toBeVisible()
    await page.getByRole('button', { name: 'Add a part' }).first().click()
    const add = page.getByRole('dialog', { name: 'Add a part' })
    await expect(add.getByRole('button', { name: /^Set pieces/ })).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-add-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await add.getByRole('button', { name: /^Cool-down/ }).click()
    await add.getByRole('button', { name: 'Add part' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Parts of the session' }).getByRole('listitem')).toHaveCount(6)

    // TRAK-392: View drill shows a Library drill with Easier / Harder; Use this drill picks it.
    const warmup = page.getByRole('region', { name: 'Dry warm-up' })
    await warmup.getByRole('button', { name: 'View drill: Tag games' }).click()
    const view = page.getByRole('dialog', { name: 'Tag games' })
    // Kostas, 10 Nov: wider than the other pop-ups on a laptop, so the words beside the picture aren't squeezed.
    if (width > 1000) expect((await view.boundingBox())!.width).toBeGreaterThan(900)
    await expect(view.getByRole('img', { name: /^Tag games set-up\./ })).toBeVisible()
    await view.getByRole('button', { name: 'Harder' }).click()
    await expect(view.getByText('Harder. Here’s what Trak changed:')).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-view-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await view.getByRole('button', { name: 'Use this drill' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(warmup.getByRole('button', { name: /^Tag games/, pressed: true })).toBeVisible()

    // TRAK-404: Find another drill, the fourth choice: the part's drills by drill type, then the rest of the Library.
    await page.getByRole('button', { name: /^Next: Passing & movement/ }).click()
    await page.getByRole('region', { name: 'Passing & movement' }).getByRole('button', { name: /^Find another drill/ }).click()
    const more = page.getByRole('dialog', { name: 'Find another drill for Passing & movement' })
    await expect(more.getByRole('heading', { level: 3 })).toHaveText(['Passing', 'Pressing movement', 'Follow and copy', 'Repetition', 'Individual', 'Goalkeeping', 'Get ready', 'Skill practices', 'Game related practices'])
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-more-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await more.getByRole('button', { name: 'Close' }).last().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Use a past plan at ${width} px`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    await page.getByRole('region', { name: 'Before AEK U16 on Saturday' }).getByRole('button', { name: 'Use a past plan' }).click()
    const copy = page.getByRole('dialog', { name: 'Use a past plan' })
    await expect(copy.getByRole('list', { name: 'Past plans' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-copy-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await copy.getByRole('button', { name: /^Use this plan: Receiving under pressure/ }).click()

    await expect(page).toHaveURL(/\/coach\/training\/t-thu\/plan$/)
    await expect(page.getByText(/Copied from Receiving under pressure/)).toBeVisible()
    // A copy survives the page being laid out again (a phone turned, a window resized across the laptop width).
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height })
    await expect(page.getByRole('list', { name: 'Parts of the session' }).getByRole('listitem')).toHaveCount(2)
    await page.setViewportSize({ width, height })
    await expect(page.getByRole('list', { name: 'Parts of the session' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-copied-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-341: a saved plan's page is Review: Edit opens only that part, × removes one, Add a part.
  test(`Review a saved plan at ${width} px`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/t-tue', width, height)
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'The plan' }).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Change the plan' })).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-review-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[1040px\\]')
    expect(keyboard.missed).toEqual([])
    await page.getByRole('button', { name: 'Edit Pressing on the trigger' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Edit: Pressing on the trigger' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save and go back to Review' })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-review-edit-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-tue$/)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-342: Who's here, with the register saved: one of the two U16 players came; Trak checks each part.
  // TRAK-367 (Kostas, 3 Nov): a part moves on Review as it does while planning: by its handle, with a finger or a mouse.
  test(`Moving a part on Review at ${width} px`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/t-tue', width, height)
    const rows = page.getByRole('list', { name: 'The plan' }).getByRole('listitem')
    await expect(rows.first()).toContainText('Warm-up: rondos 4v1')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-review-move-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    const from = await page.getByRole('button', { name: /^Move Pressing on the trigger/ }).boundingBox()
    const to = await rows.first().boundingBox()
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(from!.x + from!.width / 2, to!.y + 10, { steps: 12 })
    await page.mouse.move(from!.x + from!.width / 2, to!.y - 6, { steps: 6 })
    await page.mouse.up()
    await expect(rows.first()).toContainText('Pressing on the trigger')
    // Saved once it lands: the page read again keeps the new order.
    await page.waitForTimeout(500)
    await page.reload()
    await expect(rows.first()).toContainText('Pressing on the trigger')
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Who's here at ${width} px: the register, then Trak's suggestions`, async ({ page, context }, testInfo) => {
    const started = Date.now() - 10 * MINUTE
    const here = { ...training('t-here', 'U16', 0, '18:00', 'Pressing triggers'), starts_at: new Date(started).toISOString(),
      ends_at: new Date(started + 90 * MINUTE).toISOString() }
    const part = (position: number, trak_drill: string, name: string, part: string, part_type: string, minutes: number) => ({
      position, name, minutes, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '', source: 'trak',
      drill_id: null, library_session: null, trak_drill, part, part_type, players_kind: null, group_size: null })
    const { unexpected, errors } = await open(page, context, '/coach/training/t-here/here', width, height, [here, ...TRAININGS],
      [['t-here', [part(1, 'w1', 'Dynamic warm-up', 'Dry warm-up', 'warmup', 10), part(2, 'p4', 'Passing in pairs on the move', 'Passing & movement', 'passing', 15),
        part(3, 'g1', 'Free play', 'Game', 'game', 25)]]],
      [...SESSIONS, { id: 's-here', event_id: 't-here', session_type: 'training', title: 'Pressing triggers', session_date: null, training_type: null, notes: null }],
      [{ session_id: 's-here', squad_player_id: 'sq-1', status: 'present' }])
    await expect(page.getByRole('heading', { name: 'Today’s plan for 1 player' })).toBeVisible()
    await expect(page.getByText('2 parts don’t work with 1 player. Change them yourself.')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Today’s plan' }).getByRole('article')).toHaveCount(3)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-here-plan-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.missed).toEqual([])
    await page.getByRole('button', { name: 'Change', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done: 1 here' })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-here-register-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`View and a closed training at ${width} px`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/t-tue', width, height)
    await expect(page.getByRole('list', { name: 'Training loop' }).getByRole('listitem')).toHaveCount(4)
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-tue\/view$/)
    await expect(page.getByRole('list', { name: 'Practices to run' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-run-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[1040px\\]')
    expect(keyboard.missed).toEqual([])

    // TRAK-339: past trainings have their own page, from the button at the bottom of Training.
    await page.goto('/coach/training')
    await page.getByRole('button', { name: /^Past trainings/ }).click()
    await expect(page).toHaveURL(/\/coach\/training\/past$/)
    const past = page.getByRole('list', { name: 'Past trainings' }).getByRole('listitem')
    await expect(past).toHaveCount(1)
    await expect(past.first()).toContainText('1 practice · 30 min · Pressing zones')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-past-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const pastKeys = await everyControlByKeyboard(page, '.trak-wide')
    expect(pastKeys.missed).toEqual([])
    await past.first().getByRole('button', { name: /^View Pressing zones/ }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-last$/)
    await expect(page.getByRole('list', { name: 'Training loop' }).getByText('(done)')).toHaveCount(3)
    await page.getByRole('button', { name: 'View log' }).click()
    // TRAK-426: Training and Matches are on, so the old Edit session is gone; the log is read only here.
    await expect(page.getByRole('dialog', { name: 'The log' }).getByText(/Attended/)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'The log' }).getByRole('link', { name: 'Edit log' })).toHaveCount(0)
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-closed-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-339: a training that ended three hours ago waits on the card for its Notes.
  test(`Notes after a training at ${width} px`, async ({ page, context }, testInfo) => {
    const ended = Date.now() - 3 * 60 * MINUTE
    const done = { ...training('t-done', 'U16', 0, '18:00', 'Defending the box'),
      starts_at: new Date(ended - 90 * MINUTE).toISOString(), ends_at: new Date(ended).toISOString() }
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height, [done, ...TRAININGS])
    const card = page.getByRole('region', { name: 'Defending the box' })
    await expect(card.getByText('Would you run this session again?')).toBeVisible()
    await card.getByRole('button', { name: 'Yes, with changes' }).click()
    await card.getByLabel('A note for next time').fill('Rondo grids too small.')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-notes-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// Kostas, 29 Oct: a rehearsal coach's training had a whole session plan pasted as its name (1,000+ characters), and
// Today showed all of it. Today names no training ("keep it simple"; the week above cuts the name to one line), and a
// long name never widens the card or the page.
const PASTED = `How To Win Games${' '.repeat(40)}OBJECTIVES ORGANISATION ${'Players will develop their understanding of how to organise their team effectively. '.repeat(12)}`
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`Home at ${width} px: a training with a long name keeps Today a small snapshot`, async ({ page, context }, testInfo) => {
    const today = [...TRAININGS.map(t => t.id === 't-tue' ? training('t-tue', 'U16', 0, '18:00', 'Receiving under pressure') : t),
      training('t-long', 'U14', 0, '19:45', PASTED)]
    await page.route('**/rest/v1/coach_calendar_events*', route => {
      const type = new URL(route.request().url()).searchParams.get('event_type')
      const rows = type && type !== 'eq.training' ? [] : today
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    })
    const { unexpected, errors } = await open(page, context, '/coach/home', width, height)
    const card = page.getByRole('region', { name: 'Today' })
    const planned = card.getByRole('article', { name: 'Training, Receiving under pressure' })
    const long = card.getByRole('article', { name: /^Training, How To Win Games/ })
    await expect(long.getByRole('link', { name: 'Plan this session' })).toBeVisible()
    // Each header is one line: as tall as its words on their own. This coach has U14 and U16, and Home starts on All, so
    // each says its age group (Kostas, 29 Oct).
    for (const [article, text] of [[planned, 'Training plan · U16'], [long, 'Training plan · U14']] as const) {
      await expect(article.getByText(text, { exact: true })).toBeVisible()
      const words = (await article.getByText(text, { exact: true }).boundingBox())!
      const label = (await article.getByText(text, { exact: true }).locator('..').boundingBox())!
      expect(Math.round(label.height)).toBe(Math.round(words.height))
    }
    await expect(card.getByText(/How To Win Games|Receiving under pressure/)).toHaveCount(0)
    // The total time on the label's line, on the right.
    const [total, words] = [(await planned.getByText('40 min', { exact: true }).boundingBox())!, (await planned.getByText('Training plan · U16', { exact: true }).boundingBox())!]
    expect(Math.abs(total.y - words.y)).toBeLessThanOrEqual(2)
    expect(total.x).toBeGreaterThan(words.x + words.width)
    // The card stays a snapshot: the long one is no taller than the planned one with its two practices.
    expect((await long.boundingBox())!.height).toBeLessThan((await planned.boundingBox())!.height)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`home-today-long-name-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`Home at ${width} px: today's training as a quick snapshot, after the week`, async ({ page, context }, testInfo) => {
    // Receiving under pressure (planned) moved to today, 18:00.
    const today = TRAININGS.map(t => t.id === 't-tue' ? training('t-tue', 'U16', 0, '18:00', 'Receiving under pressure') : t)
    // Games reads matches only: none here.
    await page.route('**/rest/v1/coach_calendar_events*', route => {
      const type = new URL(route.request().url()).searchParams.get('event_type')
      const rows = type && type !== 'eq.training' ? [] : today
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    })
    const { unexpected, errors } = await open(page, context, '/coach/home', width, height)
    const card = page.getByRole('region', { name: 'Today' })
    const list = card.getByRole('list', { name: 'Today’s practices' })
    await expect(list.getByRole('listitem')).toHaveText(['Warm-up: rondos 4v115 min', 'Pressing on the trigger25 min'])
    // Kostas, 29 Oct: which age group the plan is for (this coach has U14 and U16; Home starts on All).
    await expect(card.getByText('Training plan · U16', { exact: true })).toBeVisible()
    // Kostas, 29 Oct: no Run it; the total time is on the right.
    await expect(card.getByText('40 min', { exact: true })).toBeVisible()
    await expect(card.getByRole('link', { name: 'Run it' })).toHaveCount(0)
    if (width < 1024) {
      // Kostas, 28 Oct: on a phone the week comes first.
      const week = await page.getByRole('heading', { name: 'This week' }).boundingBox()
      expect(week!.y).toBeLessThan((await card.boundingBox())!.y)
    }
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`home-today-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

/** The texts in `scope` that a box clips top or bottom: the glyphs (a Range's box, the font's full height) reach past
 *  an ancestor that hides its overflow. Screen-reader-only text (a 1 px box) is clipped on purpose, so it's left out. */
const cutOff = (page: Page, scope: string) => page.locator(scope).evaluate(root => {
  const cut: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    const parent = node.parentElement
    if (!text || !parent || parent.getBoundingClientRect().height <= 1) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const glyphs = range.getBoundingClientRect()
    for (let el: HTMLElement | null = parent; el && el !== root.parentElement; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (style.overflowY === 'visible' && style.overflowX === 'visible') continue
      const box = el.getBoundingClientRect()
      if (glyphs.bottom > box.bottom + 0.5 || glyphs.top < box.top - 0.5) { cut.push(text); break }
    }
  }
  return cut
})

test('the side menu cuts no letter: on a laptop and in a phone’s menu (Kostas, 29 Oct)', async ({ page, context }) => {
  const { unexpected, errors } = await open(page, context, '/coach/training', 1440, 900)
  // The sidebar's id is React's (":r9:-sidebar"), so it's matched as an attribute.
  const sidebar = `[id="${await page.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-controls')}"]`
  await expect(page.locator(sidebar).getByRole('button', { name: 'Training' })).toBeVisible()
  expect(await cutOff(page, sidebar)).toEqual([])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu.getByRole('button', { name: 'Settings' })).toBeVisible()
  expect(await cutOff(page, '[role="dialog"]')).toEqual([])
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-415: below 1024 px the frame drew pages with no `.arc` around them, so Arc's parts there (Upcoming's badges,
// Add to training) lost Arc's colours and sizes. Any part from an Arc stylesheet must sit inside `.arc`.
const outsideArc = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[class]')]
  .filter(el => /(?:^|\s)_[A-Za-z]+_[a-z0-9]{4,6}_\d+/.test(el.getAttribute('class') ?? '') && !el.closest('.arc') && el.getBoundingClientRect().width > 0)
  .map(el => `${el.getAttribute('class')} "${(el.textContent ?? '').trim().slice(0, 30)}"`))

for (const [width, height] of [[390, 844], [820, 1180]] as const) {
  test(`TRAK-415 at ${width} px: Training's badges and Add to training keep Arc's styling`, async ({ page, context }) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    await expect(page.getByRole('region', { name: 'Upcoming trainings' }).first().getByText('Plan ready')).toBeVisible()
    expect(await outsideArc(page)).toEqual([])
    await page.goto('/coach/training/drills/d/lib-pass-between-defenders')
    await expect(page.getByRole('button', { name: 'Add to training' })).toBeVisible()
    expect(await outsideArc(page)).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
