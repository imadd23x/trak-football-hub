import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-199 (team decision, 21 Oct): a coach's screens use a tablet's or a laptop's
// width; a phone, upright or sideways, keeps today's layout, and so does every
// player and parent screen. Layout only. Production build, synthetic intercepted backend.
const ids = { coach: '97199000-0000-4000-8000-000000000001', player: '97199000-0000-4000-8000-000000000002' }
type Role = keyof typeof ids
const players = ['Hugo Lloris', 'Bukayo Saka', 'Beth Mead', 'Cole Palmer', 'Ella Toone', 'Declan Rice'].map((name, i) => ({
  id: `sq-${i + 1}`, coach_user_id: ids.coach, player_name: name, position: 'Defender', age_group: 'U16', shirt_number: i + 1,
  status: 'active', linked_player_id: `sq-${i + 1}-user`, created_at: '2026-10-01T08:00:00Z',
}))

async function backend(context: BrowserContext, role: Role, unexpected: string[], features: string[] = ['events']) {
  const id = ids[role]
  const user = { id, email: `${role}@wide199.test`, email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-wide199-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: id, id, role, full_name: role === 'coach' ? 'Synthetic Coach' : 'Synthetic Player' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: ids.coach, organization_id: 'org-199', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players' && role === 'coach') {
      const one = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(one ? players.filter(p => p.id === one) : players)
    }
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    // Events on; Games (TRAK-283) and Training (TRAK-294) off, as for every academy until they are switched on, unless a
    // test switches them on.
    if (path === '/rest/v1/rpc/feature_on') return json(features.includes(req.postDataJSON()?.p_feature))
    if (path.startsWith('/rest/v1/rpc/coach_squad_player_consent_required')) return json(false)
    // TRAK-250: the Squad tabs' reads. Two latest bands for three children, so Snapshot has columns to show.
    if (path === '/rest/v1/coach_assessments') return json(role === 'coach' ? [
      { squad_player_id: 'sq-1', coach_rating: 9, created_at: '2026-10-10T10:00:00Z', work_rate: 4, technical: 4, physical: 4, coachability: 4, attitude: 4, tactical: 4 },
      { squad_player_id: 'sq-2', coach_rating: 7, created_at: '2026-10-10T10:00:00Z', work_rate: 3, technical: 3, physical: 3, coachability: 3, attitude: 3, tactical: 3 },
      { squad_player_id: 'sq-3', coach_rating: 5, created_at: '2026-10-10T10:00:00Z', work_rate: 2, technical: 3, physical: 2, coachability: 3, attitude: 2, tactical: 3 },
    ] : [])
    if (['/rest/v1/coach_sessions', '/rest/v1/session_attendance', '/rest/v1/rpc/coach_squad_season', '/rest/v1/coach_calendar_events',
      '/rest/v1/event_confirmations', '/rest/v1/event_absences'].includes(path)) return json([])
    // Layout only: every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

async function open(page: Page, context: BrowserContext, role: Role, path: string, width: number, height: number, features?: string[]) {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await backend(context, role, unexpected, features)
  await page.goto(path)
  return { unexpected, errors }
}

// [screen, width, height, page width]
for (const [label, width, height, pageWidth] of [
  ['a phone', 390, 844, 390],
  ['a phone turned sideways', 844, 390, 430],
  ['an upright tablet', 820, 1180, 820], // TRAK-307: the menu pages' one column, 32 px from each side
] as const) {
  test(`coach Home on ${label}: the page, and the glass tab bar with the "+" under it`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', width, height)
    await expect(page.getByRole('heading', { name: 'Squad shape' })).toBeVisible()

    // TRAK-259: Home, Squad and Library, with the "+" merged in at the right; no Calendar, Feedback or Profile tab.
    const bar = page.getByRole('tablist', { name: 'Coach' })
    await expect(bar.getByRole('tab')).toHaveText(['Home', 'Squad', 'Library'])
    const shell = await box(page, '.trak-wide')
    expect(Math.round(shell.width)).toBe(pageWidth)
    expect(Math.round(shell.x + shell.width / 2)).toBe(Math.round(width / 2))
    const nav = (await page.getByRole('navigation', { name: 'Coach' }).boundingBox())!
    const plus = (await page.getByRole('button', { name: 'Quick add' }).boundingBox())!
    // The bar floats above the bottom edge, centred, with the "+" beside it inside the screen.
    expect(nav.y + nav.height).toBeLessThan(height)
    expect(Math.abs(nav.x + nav.width / 2 - width / 2)).toBeLessThanOrEqual(1)
    expect(plus.x).toBeGreaterThan((await bar.boundingBox())!.x)
    expect(plus.x + plus.width).toBeLessThanOrEqual(width)
    // The avatar (top left) opens the side menu; the calendar sits beside the bell.
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Schedule' })).toBeVisible() // TRAK-255
    await page.screenshot({ path: testInfo.outputPath(`coach-home-${width}.png`) })
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('coach Home on a laptop: the sidebar on the left, "+ Create" at the top right, the page beside it', async ({ page, context }, testInfo) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', 1440, 900)
  await expect(page.getByRole('heading', { name: 'Squad shape' })).toBeVisible()

  // TRAK-259: Arc's sidebar rail. The club, then Home, Calendar, Squad, Library; Settings and the coach at the bottom.
  const sidebar = page.getByRole('navigation', { name: 'Your academy' })
  const rows = sidebar.getByRole('button')
  await expect(rows).toHaveText(['Home', 'Schedule', 'Squad', 'Library', 'Settings']) // TRAK-255
  const rail = await sidebar.evaluate(el => el.closest('[id$="-sidebar"]')!.getBoundingClientRect().toJSON() as DOMRect)
  expect([rail.x, rail.y, rail.width, rail.height].map(Math.round)).toEqual([0, 0, 240, 900])
  const [first, last] = [(await rows.first().boundingBox())!, (await rows.last().boundingBox())!]
  expect(last.y + last.height).toBeGreaterThan(900 - 140)
  await expect(page.getByText('Synthetic Coach').first()).toBeVisible()
  expect(first.x).toBeLessThan(240)
  await page.waitForTimeout(600) // let the radar draw in for the screenshot
  await page.screenshot({ path: testInfo.outputPath('coach-home-1440.png') })
  // "+ Create" at the top right, after the bell; it opens the same menu.
  const create = page.getByRole('button', { name: 'Create' })
  const createBox = (await create.boundingBox())!
  expect(createBox.x + createBox.width).toBeGreaterThan(1440 - 40)
  expect(createBox.y).toBeLessThan(60)
  await create.click()
  // TRAK-265: Arc's Action morph; the button grows into the menu, titled "Create", with a close button.
  await expect(page.getByRole('menu', { name: 'Create' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close create' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Coach' })).toHaveCount(0)

  // TRAK-262: Home takes the wide column on a laptop, the week and Squad shape side by side. TRAK-307: the menu pages'
  // one column, up to 1,280 px, so the whole 1,200 px beside the sidebar here.
  const shell = await box(page, '.trak-wide')
  expect(Math.round(shell.width)).toBe(1200)
  expect(Math.round(shell.x + shell.width / 2)).toBe(240 + (1440 - 240) / 2)
  const [week, shape] = [(await page.getByRole('region', { name: 'This week' }).boundingBox())!, (await page.getByRole('region', { name: 'Squad shape' }).boundingBox())!]
  expect(shape.x).toBeGreaterThan(week.x + week.width - 1)
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

test("a coach's Settings sits in the frame on a laptop; on a phone it keeps no bottom bar", async ({ page, context }, testInfo) => {
  await open(page, context, 'coach', '/settings', 1440, 900)
  await expect(page.getByText('Synthetic Coach').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Your academy' }).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: 'Your academy' })).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: 'Coach' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('coach-settings-390.png'), fullPage: true })
})

// TRAK-261: a coach's Settings is Arc's settings page, its section menu beside the sections, in the wide column.
test("a coach's Settings is Arc's settings page in the wide column on a laptop", async ({ page, context }, testInfo) => {
  const { unexpected } = await open(page, context, 'coach', '/settings', 1440, 900)
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Synthetic Coach')
  const column = await box(page, '.trak-wide')
  expect(Math.round(column.x + column.width / 2)).toBe(240 + (1440 - 240) / 2)
  const menu = (await page.getByRole('navigation', { name: 'Settings sections' }).boundingBox())!
  const profile = (await page.getByRole('heading', { name: 'Profile', exact: true }).boundingBox())!
  expect(profile.x).toBeGreaterThan(menu.x + menu.width)
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')).toHaveText(['Profile', 'Club', 'Notifications', 'How Trak works', 'Account'])
  await page.screenshot({ path: testInfo.outputPath('coach-settings-1440.png') })
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
})

test("the Calendar's sheets stop at the Arc bottom sheet's width on a tablet", async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'coach', '/coach/schedule', 820, 1180)
  await page.getByRole('button', { name: 'Add event' }).click()
  const sheet = (await page.getByRole('dialog', { name: 'New event' }).boundingBox())!
  expect(Math.round(sheet.width)).toBe(576)
  expect(Math.round(sheet.x + sheet.width / 2)).toBe(410)
  expect(unexpected).toEqual([])
})

test("a player's Home keeps the phone column on a laptop", async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'player', '/player/home', 1440, 900)
  await expect(page.locator('nav.trak-nav')).toBeVisible()
  const shell = await box(page, '.trak-page')
  expect([Math.round(shell.width), Math.round(shell.x + shell.width / 2)]).toEqual([430, 720])
  const nav = await box(page, 'nav.trak-nav')
  expect([Math.round(nav.width), Math.round(nav.y + nav.height)]).toEqual([430, 900])
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBeUndefined()
  expect(unexpected).toEqual([])
})

// TRAK-250: Squad is a coach workspace of views. TRAK-263 (Imad, 22 Oct): Players (Arc's team
// directory) replaced Snapshot, and the views sit on Arc's glass segmented control. On a tablet
// or a laptop it uses the room: a page wider than the phone column, the profile beside the list.
// [screen, width, height, rail]
for (const [label, width, height, rail] of [
  ['an upright tablet', 820, 1180, 0],
  ['a laptop', 1440, 900, 240],
] as const) {
  test(`coach Squad on ${label}: the three views across a wide page, a player's profile beside the list, no sheet`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/squad', width, height)
    const views = page.getByRole('radiogroup', { name: 'Squad view' }).getByRole('radio')
    await expect(views).toHaveText(['Players', 'Attributes', 'Availability']) // TRAK-283: Games left Squad
    const playersView = page.getByRole('region', { name: 'Players', exact: true })
    await expect(playersView.getByRole('list', { name: 'Players' }).getByRole('listitem').first()).toBeVisible()

    // The wide page, right of the side menu on a laptop: no 430 px column.
    const panel = (await playersView.boundingBox())!
    expect(Math.round(panel.width)).toBe(Math.min(1280, width - rail) - 64)
    expect(Math.round(panel.x)).toBeGreaterThanOrEqual(rail)

    // Picking a player opens their profile beside the list.
    const first = playersView.getByRole('list', { name: 'Players' }).getByRole('button').first()
    const name = players[0].player_name
    await first.click()
    // The profile is the article named after the player (their assessment cards are articles too).
    const profile = playersView.getByRole('article', { name: new RegExp(`^${name},`) })
    await expect(profile.getByRole('heading', { level: 3, name })).toBeVisible()
    expect((await profile.boundingBox())!.x).toBeGreaterThan((await first.boundingBox())!.x + (await first.boundingBox())!.width - 1)
    await page.waitForTimeout(600) // let the radar draw in for the screenshot
    await page.screenshot({ path: testInfo.outputPath(`coach-squad-${width}.png`) })

    // Each view opens in place: no Arc sheet, and no read the backend does not answer.
    for (const name of ['Attributes', 'Availability', 'Players']) {
      await views.filter({ hasText: name }).click()
      await expect(views.filter({ hasText: name })).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByRole('region', { name, exact: true }).getByText(/^(Loading|Checking) /)).toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('Feedback on a laptop: a table with a filter by level and Assess on each row', async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'coach', '/coach/feedback', 1440, 900)
  const table = page.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveText(['Player', 'Status', 'Why', 'Assess'])
  await expect(table.getByRole('row')).toHaveCount(1 + players.length)
  await expect(table.getByRole('button', { name: 'Assess' })).toHaveCount(players.length)
  await expect(page.getByRole('radio', { name: `All ${players.length}` }).or(page.getByRole('tab', { name: `All ${players.length}` })).or(page.getByRole('button', { name: `All ${players.length}` }))).toBeVisible()
  expect(unexpected).toEqual([])
})

test('Feedback on a phone keeps its list', async ({ page, context }) => {
  await open(page, context, 'coach', '/coach/feedback', 390, 844)
  await expect(page.getByText('Hugo Lloris')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
})

for (const [label, width, height, beside] of [['an upright tablet', 820, 1180, false], ['a laptop', 1440, 900, true]] as const) {
  test(`the Calendar on ${label}: the chosen day ${beside ? 'beside' : 'under'} the month`, async ({ page, context }) => {
    const { unexpected } = await open(page, context, 'coach', '/coach/schedule', width, height)
    const month = (await page.getByRole('grid').boundingBox())!
    const day = (await page.getByText('Nothing planned. Tap + to schedule an event.').boundingBox())!
    if (beside) {
      expect(day.x).toBeGreaterThan(month.x + month.width)
      expect(day.y).toBeLessThan(month.y + month.height)
    } else expect(day.y).toBeGreaterThan(month.y + month.height)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
  })
}

// TRAK-265 (Imad, 22 Oct): the "+" is Arc's Action morph; the phone's sidebar sheet works; one title in the breadcrumb.
test('the "+" grows into its menu with a close button, and Escape folds it back', async ({ page, context }, testInfo) => {
  for (const [width, height, name] of [[390, 844, 'Quick add'], [1440, 900, 'Create']] as const) {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', width, height)
    await page.getByRole('button', { name, exact: true }).click()
    const menu = page.getByRole('menu', { name })
    await expect(menu.getByRole('menuitem')).toHaveText(['Log training', 'Log match', 'Assess player', 'New event'])
    await expect(page.getByRole('button', { name: `Close ${name.toLowerCase()}` })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'New event' }).click()
    const form = page.getByRole('dialog', { name: 'New event' })
    await expect(form.getByRole('button', { name: 'Save draft' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`coach-create-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name })).toBeVisible()
    // Focus comes back to the first row two frames after the form folds; on a slow runner a key pressed sooner lands on the page.
    await expect(page.getByRole('menu', { name }).getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('menu', { name })).toHaveCount(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  }
})

test("a phone's sidebar sheet takes a tap: the row opens its page and the sheet closes", async ({ page, context }) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', 390, 844)
  await page.getByRole('button', { name: 'Open menu' }).click()
  const sheet = page.getByRole('navigation', { name: 'Your academy' })
  await sheet.getByRole('button', { name: 'Squad', exact: true }).click()
  await expect(page).toHaveURL(/\/coach\/squad$/)
  await expect(page.getByRole('navigation', { name: 'Your academy' })).toHaveCount(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

test("a laptop's breadcrumb names the page, one title after several moves", async ({ page, context }) => {
  const { errors } = await open(page, context, 'coach', '/coach/home', 1440, 900)
  const side = page.getByRole('navigation', { name: 'Your academy' })
  for (const name of ['Squad', 'Schedule', 'Library', 'Home']) {
    await side.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(300)
  }
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/^Your academy\s*\/?\s*Home$/)
  expect(errors).toEqual([])
})

/** Where a page draws (its text, cards, buttons and boxes), right of a laptop's sidebar and under its top bar. Each box
 *  is cut to what its scrolling parents show; the page's own plain background doesn't count. */
const drawnEdges = (page: Page) => page.evaluate(() => {
  const sidebar = document.querySelector('[id$="-sidebar"]')
  const rail = sidebar ? sidebar.getBoundingClientRect().right : 0
  const top = sidebar ? 60 : 0
  let left = Infinity, right = -Infinity
  const add = (el: Element, r: DOMRect) => {
    if (r.width < 2 || r.height < 2 || r.top < top || r.top > window.innerHeight) return
    let l = Math.max(r.left, rail), rt = Math.min(r.right, window.innerWidth)
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') { const b = a.getBoundingClientRect(); l = Math.max(l, b.left); rt = Math.min(rt, b.right) }
    }
    if (rt - l >= 2) { left = Math.min(left, l); right = Math.max(right, rt) }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: node => {
    if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT
    const el = node as HTMLElement, style = getComputedStyle(el)
    return el.id.endsWith('-sidebar') || style.position === 'fixed' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  } })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      add(node.parentElement!, range.getBoundingClientRect())
      continue
    }
    const el = node as HTMLElement, style = getComputedStyle(el), r = el.getBoundingClientRect()
    const control = ['svg', 'img', 'button', 'input', 'textarea', 'select', 'canvas'].includes(el.tagName.toLowerCase())
    const bordered = parseFloat(style.borderTopWidth) > 0 && style.borderTopColor !== 'rgba(0, 0, 0, 0)'
    const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.width < (window.innerWidth - rail) * 0.95 && !el.classList.contains('bg-ground')
    if (control || bordered || filled) add(el, r)
  }
  return { left, right }
})

// TRAK-307 (Kostas, 29 Oct): ONE width for every page in a coach's menu, Squad's and Games'. On a tablet or a laptop the
// page fills the screen beside the menu, 32 px from each side, up to 1,280 px; a phone keeps the phone column (20 px).
// Each page's column is the same, its content starts at the margin, and nothing sits in the margins.
const MENU_PAGES = [
  ['Home', '/coach/home', ['events', 'games', 'training']], ['Schedule', '/coach/schedule', ['events', 'games', 'training']],
  ['Squad', '/coach/squad', ['events', 'games', 'training']], ['Matches', '/coach/matches', ['events', 'games', 'training']],
  ['Training', '/coach/training', ['events', 'games', 'training']], ['Drills', '/coach/training/drills', ['events', 'games', 'training']],
  ['Settings', '/settings', ['events', 'games', 'training']], ['Library', '/coach/trainings', ['events']], // Library: Training off
] as const
for (const [label, width, height] of [['a phone', 390, 844], ['an upright tablet', 820, 1180], ['a laptop', 1440, 900], ['a big screen', 1920, 1080]] as const) {
  test(`TRAK-307: every page in the coach's menu takes the same width on ${label}`, async ({ browser }, testInfo) => {
    const rail = width >= 1024 ? 240 : 0
    const margin = width >= 768 ? 32 : 20
    const column = Math.min(1280, width - rail)
    const start = rail + (width - rail - column) / 2
    const found: Record<string, string> = {}, wanted: Record<string, string> = {}
    for (const [name, path, features] of MENU_PAGES) {
      // A fresh coach for each page: the app keeps a switch's answer for 30 s.
      const context = await browser.newContext()
      const page = await context.newPage()
      const { unexpected, errors } = await open(page, context, 'coach', path, width, height, [...features])
      await expect(page.getByRole('heading').first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(/^(Loading|Checking) /)).toHaveCount(0)
      await page.waitForTimeout(400) // let the page settle
      // The menu pages' column (WIDE_COLUMN), if the page has it.
      const columns = page.locator('.trak-wide')
      const box = await columns.count() ? await columns.first().boundingBox() : null
      const { left, right } = await drawnEdges(page)
      // Within 6 px: a scrolling row may reach a few pixels into the margin to keep its focus rings.
      found[name] = [!box ? 'no menu-page column' : Math.abs(box.x - start) <= 1 && Math.abs(box.width - column) <= 1 ? 'same column' : `column ${Math.round(box.x)}+${Math.round(box.width)}`,
        Math.abs(left - (start + margin)) <= 6 ? 'starts at the margin' : `starts at ${Math.round(left)}`,
        right <= start + column - margin + 6 ? 'ends inside' : `ends at ${Math.round(right)}`].join(', ')
      wanted[name] = 'same column, starts at the margin, ends inside'
      if (width === 1440) await page.screenshot({ path: testInfo.outputPath(`menu-page-${name.toLowerCase()}-${width}.png`) })
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
      await context.close()
    }
    expect(found).toEqual(wanted)
  })
}
