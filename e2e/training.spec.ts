import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-294 (Training 1/5): Training home (Sessions and Drills) and the New drill sheet with the academy's training
// switch on, at a phone's and a laptop's width: no sideways scroll, and the keyboard reaches every control.
// TRAK-295 (Training 2/5): planning a training: "How do you want to plan it?", Write my own, and the plan, at the
// same two widths. TRAK-296 (Training 3/5): the Add/Swap sheet's My drills and Library views, and a Library preview.
// TRAK-297 (Training 4/5): Copy a past session. TRAK-298 (Training 5/5): View (TRAK-309: was Run it), and a closed training's log.
// TRAK-304: Home's Today card with a training planned today: the week first, then the day's practices.
// TRAK-306: the side menu (a laptop's sidebar, a phone's sheet) cuts no letter: g, q and p keep their tails.
// TRAK-310: each training coming up has View plan and Edit plan, or Create plan, on its right.
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
const drill = (id: string, name: string, minutes: number, how: string) => ({
  id, name, minutes, how, tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '', updated_at: '2026-10-27T10:00:00Z',
})
const DRILLS = [
  drill('d-1', 'Warm-up: rondos 4v1', 15, 'Four round one in a 10 m square. Two touches, then one.'),
  drill('d-2', 'Pressing on the trigger', 25, 'Press as soon as their 6 turns back.'),
  drill('d-3', 'Game: 8v8 with conditions', 30, '8v8 + 2 floaters in 30 × 24 m.'),
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

async function backend(context: BrowserContext, unexpected: string[]) {
  const plans = new Map(PLANNED)
  const user = { id: COACH, email: 'coach@training294.test', email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: COACH, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-training294-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
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
    // An `eq.` or `in.(…)` filter, as PostgREST reads it; no filter matches everything.
    const matches = (key: string) => {
      const value = url.searchParams.get(key)
      const wanted = value?.startsWith('in.(') ? value.slice(4, -1).split(',') : value ? [value.slice(3)] : null
      return (id: string) => !wanted || wanted.includes(id)
    }
    if (path === '/rest/v1/coach_calendar_events') return json(TRAININGS.filter(t => matches('id')(t.id)))
    if (path === '/rest/v1/training_plans') {
      return json([...plans.keys()].filter(matches('event_id')).map(event_id => ({ event_id, updated_at: '2026-10-28T10:00:00Z' })))
    }
    if (path === '/rest/v1/training_plan_practices') {
      return json([...plans].filter(([id]) => matches('event_id')(id)).flatMap(([event_id, rows]) => rows.map(row => ({ event_id, ...row }))))
    }
    if (path === '/rest/v1/coach_sessions') {
      const id = url.searchParams.get('id')?.slice(3)
      return json(id ? SESSIONS.filter(session => session.id === id) : SESSIONS.map(({ id: sid, event_id }) => ({ id: sid, event_id })))
    }
    if (path === '/rest/v1/rpc/save_training_plan') {
      const { p_event_id, p_practices } = req.postDataJSON() as { p_event_id: string; p_practices: Record<string, unknown>[] }
      // As the database does: a practice ticked "Save to My drills" becomes the coach's drill.
      plans.set(p_event_id, p_practices.map(({ save_to_drills, ...p }, i) =>
        ({ ...p, position: i + 1, ...(save_to_drills ? { source: 'drill', drill_id: `drill-${i + 1}` } : {}) })))
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/rest/v1/coach_drills' && req.method() === 'GET') return json(DRILLS)
    // Every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

async function open(page: Page, context: BrowserContext, path: string, width: number, height: number) {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await backend(context, unexpected)
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
  test(`Training home at ${width} px: Coming up and Last week`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    await expect(page.getByRole('heading', { level: 1, name: 'Training' })).toBeVisible()
    const coming = page.getByRole('region', { name: 'Coming up' })
    await expect(coming.getByRole('article')).toHaveCount(3)
    await expect(coming.getByRole('article').first()).toContainText('Before AEK U16 on Saturday')
    // TRAK-310: on each training's right, View plan and Edit plan, or Create plan; no New session at the top.
    await expect(coming.getByRole('button', { name: 'Create plan' })).toHaveCount(2)
    await expect(coming.getByRole('article', { name: /Receiving under pressure$/ }).getByRole('button')).toHaveText(['View plan', 'Edit plan'])
    await expect(page.getByRole('button', { name: 'New session' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Last week' }).getByRole('link')).toHaveCount(1)
    // TRAK-311: a training last week has the same buttons.
    await expect(page.getByRole('region', { name: 'Last week' }).getByRole('article', { name: /Pressing zones$/ }).getByRole('button'))
      .toHaveText(['View plan', 'Edit plan'])
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`training-sessions-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.count).toBeGreaterThan(5)
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-305: one age-group switcher at the top (the top bar on a laptop, the page's top on a phone); the pick holds.
  test(`Age groups at ${width} px: picked once at the top, kept after a reload`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    const ages = page.getByRole('group', { name: 'Age group' })
    await expect(ages.getByRole('button')).toHaveText(['All', 'U14', 'U16'])
    await expect(ages.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    const coming = page.getByRole('region', { name: 'Coming up' })
    await expect(coming.getByRole('article')).toHaveCount(3)
    await ages.getByRole('button', { name: 'U14' }).click()
    await expect(coming.getByRole('article')).toHaveCount(1)
    await expect(coming.getByRole('article')).toContainText('U14 finishing')
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`age-groups-${width}.png`) })
    await page.reload()
    await expect(page.getByRole('group', { name: 'Age group' }).getByRole('button', { name: 'U14' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('region', { name: 'Coming up' }).getByRole('article')).toHaveCount(1)
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Drills at ${width} px: My drills, the Library, and the New drill sheet`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/drills', width, height)
    await expect(page.getByRole('region', { name: 'My drills' }).getByRole('button', { name: /Edit$/ })).toHaveCount(3)
    // TRAK-296: each drill can go to the next training not planned yet.
    await expect(page.getByRole('region', { name: 'My drills' }).getByRole('button', { name: /^Add .+ to / })).toHaveCount(3)
    await expect(page.getByRole('region', { name: 'From the Library' }).getByRole('link')).toHaveCount(7)
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`training-drills-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.missed).toEqual([])

    await page.getByRole('button', { name: 'New drill' }).click()
    const sheet = page.getByRole('dialog', { name: 'New drill' })
    await expect(sheet.getByLabel('Name')).toBeVisible()
    await sheet.getByLabel('Name').fill('1v1 in channels')
    await sheet.getByText('Add details').click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-new-drill-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // TRAK-296: Add to <day> opens the planner with the drill, which survives the page being laid out again.
    await page.getByRole('region', { name: 'My drills' }).getByRole('button', { name: /^Add Pressing on the trigger to / }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-thu\/plan$/)
    await expect(page.getByRole('list', { name: 'Practices' }).getByRole('listitem')).toHaveCount(1)
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height })
    await expect(page.getByRole('list', { name: 'Practices' }).getByRole('listitem')).toHaveCount(1)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Planning at ${width} px: how to plan it, Write my own, and the plan`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    const first = page.getByRole('region', { name: 'Coming up' }).getByRole('article').first()
    await first.getByRole('button', { name: 'Create plan' }).click()
    const sheet = page.getByRole('dialog', { name: 'How do you want to plan it?' })
    await expect(sheet.getByRole('button', { name: /Write my own/ })).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-how-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await sheet.getByRole('button', { name: /Write my own/ }).click()

    await expect(page).toHaveURL(/\/coach\/training\/t-thu\/plan$/)
    const form = page.getByRole('form', { name: 'Practice 1' })
    await form.getByLabel('Name').fill('Pressing on the trigger')
    await form.getByRole('button', { name: '25' }).click()
    await form.getByLabel(/What you’ll tell them/).fill('Press as soon as their 6 turns back.')
    await form.getByRole('button', { name: 'Add practice' }).click()
    await page.getByRole('button', { name: 'Write it' }).click()
    await page.getByRole('form', { name: 'Practice 2' }).getByLabel('Name').fill('Finishing 3v2')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-write-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[1040px\\]')
    expect(keyboard.count).toBeGreaterThan(10)
    expect(keyboard.missed).toEqual([])
    await page.getByRole('form', { name: 'Practice 2' }).getByRole('button', { name: 'Add practice' }).click()

    await page.getByRole('button', { name: 'Save the plan' }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-thu$/)
    await expect(page.getByText('Ready')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Practices' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-plan-ready-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Add or swap at ${width} px: My drills, the Library and a preview`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/t-tue/plan', width, height)
    await expect(page.getByRole('list', { name: 'Practices' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('button', { name: 'From My drills' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add a practice' })
    await expect(sheet.getByRole('article', { name: 'Pressing on the trigger' })).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-add-drills-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    await sheet.getByRole('button', { name: 'Library' }).click()
    await sheet.getByRole('button', { name: 'Defending' }).click()
    await sheet.getByRole('button', { name: 'Preview Pressing duels' }).click()
    await expect(sheet.getByRole('heading', { name: 'Pressing duels' })).toBeVisible()
    await expect(sheet.getByRole('link')).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-add-preview-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await sheet.getByRole('button', { name: 'Use this' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByText('Library · Defending')).toBeVisible()

    await page.getByRole('button', { name: 'Swap Pressing duels' }).click()
    const swap = page.getByRole('dialog', { name: 'Swap “Pressing duels”' })
    await expect(swap).toBeVisible()
    // Close, not Escape: a key pressed while the sheet is still sliding in can land before it takes focus.
    await swap.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-add-plan-${width}.png`), fullPage: true })
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[1040px\\]')
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`Copy a past session at ${width} px`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training', width, height)
    const first = page.getByRole('region', { name: 'Coming up' }).getByRole('article').first()
    await first.getByRole('button', { name: 'Create plan' }).click()
    const how = page.getByRole('dialog', { name: 'How do you want to plan it?' })
    await how.getByRole('button', { name: /Copy a past session/ }).click()
    const copy = page.getByRole('dialog', { name: 'Copy a past session' })
    await expect(copy.getByRole('list', { name: 'Past sessions' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-copy-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await copy.getByRole('button', { name: /^Copy Receiving under pressure/ }).click()

    await expect(page).toHaveURL(/\/coach\/training\/t-thu\/plan$/)
    await expect(page.getByText(/Copied from Receiving under pressure/)).toBeVisible()
    // A copy survives the page being laid out again (a phone turned, a window resized across the laptop width).
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height })
    await expect(page.getByRole('list', { name: 'Practices' }).getByRole('listitem')).toHaveCount(2)
    await page.setViewportSize({ width, height })
    await expect(page.getByRole('list', { name: 'Practices' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-copied-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`View and a closed training at ${width} px`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/training/t-tue', width, height)
    await expect(page.getByRole('list', { name: 'Training loop' }).getByRole('listitem')).toHaveCount(3)
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await expect(page).toHaveURL(/\/coach\/training\/t-tue\/view$/)
    await expect(page.getByRole('list', { name: 'Practices to run' }).getByRole('listitem')).toHaveCount(2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`training-run-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[1040px\\]')
    expect(keyboard.missed).toEqual([])

    await page.goto('/coach/training')
    await expect(page.getByRole('region', { name: 'Last week' }).getByText('Closed')).toBeVisible()
    await page.getByRole('region', { name: 'Last week' }).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/coach\/training\/t-last$/)
    await expect(page.getByRole('list', { name: 'Training loop' }).getByText('(done)')).toHaveCount(3)
    await page.getByRole('button', { name: 'View log' }).click()
    await expect(page.getByRole('dialog', { name: 'The log' }).getByRole('link', { name: 'Edit log' })).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`training-closed-${width}.png`) })
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
    await expect(card.getByText('Training plan · 40 min')).toBeVisible()
    await expect(card.getByRole('link', { name: 'Run it' })).toBeVisible()
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
