import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-357 (Season plan 9/18): Squad › Formations in a real browser. A real pointer drag swaps a bench player onto
// the pitch, a second formation is built and swapped by tap, and both survive a reload. At every width from 320 to
// 1440 nothing is clipped and nothing scrolls sideways; focus shows; reduced motion is respected. Production build,
// synthetic intercepted backend that remembers what's saved.
const coachId = '97357000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>
type Starter = { slot: number; squad_player_id: string }

async function backend(context: BrowserContext, unexpected: string[]) {
  const lines: [string, number][] = [['Goalkeeper', 2], ['Defender', 6], ['Midfielder', 6], ['Attacker', 4]]
  const players: Row[] = lines.flatMap(([position, count]) => Array.from({ length: count }, () => position)).map((position, i) => ({
    id: `sq-${i + 1}`, coach_user_id: coachId, player_name: `Synthetic ${position} ${String(i + 1).padStart(2, '0')}`, position,
    age_group: 'U16', shirt_number: i + 1, status: 'active', linked_player_id: `child-${i + 1}`, created_at: '2026-10-01T08:00:00Z',
  }))
  let saved: { id: string; name: string; format: number; shape: string; formation_players: Starter[] }[] = []
  let started = false
  const saves: Row[] = []
  const keep = (b: { p_id?: string | null; p_name: string; p_format: number; p_shape: string; p_starters: Starter[] }) => {
    const id = b.p_id ?? `f-${saved.length + 1}-${saves.length}`
    const row = { id, name: b.p_name, format: b.p_format, shape: b.p_shape, formation_players: b.p_starters }
    saved = b.p_id ? saved.map(f => (f.id === id ? row : f)) : [...saved, row]
    return id
  }
  const user = { id: coachId, email: 'coach@formations357.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-formations357-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
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
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-357', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/formations') return json(saved)
    if (path === '/rest/v1/rpc/start_formations') {
      if (started) return json(false)
      started = true
      for (const f of req.postDataJSON().p_formations) keep({ p_name: f.name, p_format: f.format, p_shape: f.shape, p_starters: f.starters })
      return json(true)
    }
    if (path === '/rest/v1/rpc/save_formation') { const body = req.postDataJSON(); saves.push(body); return json(keep(body)) }
    // Every other read is empty: this is about formations, not the rest of the app.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return saves
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const pitch = (page: Page) => page.getByRole('group', { name: /starting players\. Attacking upwards\.$/ })
const place = (page: Page, slot: number) => pitch(page).getByRole('button', { name: new RegExp(`place ${slot}\\.`) })

/** A real drag with the mouse's pointer events: press, move in steps, release over the target. The pitch is
 *  centred first, so both ends are on screen (a coach's own drag scrolls the page near its edges). */
async function drag(page: Page, from: ReturnType<Page['getByRole']>, to: ReturnType<Page['getByRole']>) {
  const height = page.viewportSize()!.height
  const [a0, b0] = [(await from.boundingBox())!, (await to.boundingBox())!]
  // Scroll so the midway point between the two is in the middle of the screen.
  await page.evaluate(by => window.scrollBy(0, by), (Math.min(a0.y, b0.y) + Math.max(a0.y + a0.height, b0.y + b0.height)) / 2 - height / 2)
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!
  expect(a.y >= 0 && a.y + a.height <= height && b.y >= 0 && b.y + b.height <= height, 'both ends of the drag are on screen').toBe(true)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`formations at ${width} px: a real drag, a second formation swapped by tap, kept after a reload`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    const saves = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/squad?tab=formations')
    const cards = page.getByRole('group', { name: 'Saved formations' })
    await expect(cards.getByRole('button')).toHaveCount(3)
    await expect(place(page, 1)).toHaveAccessibleName(/^Synthetic Goalkeeper 01/)

    // A drag: the second keeper from the bench onto the keeper's place.
    await drag(page, page.getByRole('group', { name: 'Bench' }).getByRole('button', { name: /^Synthetic Goalkeeper 02, bench/ }), place(page, 1))
    await expect(place(page, 1)).toHaveAccessibleName(/^Synthetic Goalkeeper 02/)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('All changes saved')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`formations-${width}.png`) })

    // A second formation, from the pitch as it is, then two taps.
    await page.getByRole('button', { name: 'New formation' }).click()
    await page.getByRole('textbox', { name: 'Formation name' }).fill('High press')
    await page.getByRole('button', { name: 'Create formation' }).click()
    await expect(cards.getByRole('button')).toHaveCount(4)
    await expect(page.getByRole('heading', { name: 'High press' })).toBeVisible()
    await place(page, 2).click()
    await place(page, 3).click()
    const two = await place(page, 2).getAttribute('aria-label')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('All changes saved')).toBeVisible()
    expect(saves.length).toBe(3)

    await page.reload()
    await expect(cards.getByRole('button')).toHaveCount(4)
    await cards.getByRole('button', { name: /^High press/ }).click()
    await expect(place(page, 2)).toHaveAttribute('aria-label', two!)
    await cards.getByRole('button', { name: /^Attacking tactic/ }).click()
    await expect(place(page, 1)).toHaveAccessibleName(/^Synthetic Goalkeeper 02/)
    expect(unexpected).toEqual([])
  })
}

test('every width from 320 to 1440: no clipped faces or controls, no sideways scroll, focus shows, reduced motion respected', async ({ context, page }) => {
  const unexpected: string[] = []
  await backend(context, unexpected)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/coach/squad?tab=formations')
  await expect(page.getByRole('group', { name: 'Saved formations' }).getByRole('button')).toHaveCount(3)
  for (const width of [320, 360, 390, 430, 600, 768, 834, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(place(page, 11)).toBeVisible()
    await expect.poll(() => noSidewaysScroll(page), { message: `${width} px scrolls sideways` }).toBeLessThanOrEqual(0)
    // The pitch and its places in one snapshot, once the layout has settled (at 1024 the frame swaps to the laptop's).
    await expect.poll(() => pitch(page).evaluate(el => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll('[data-spot^="slot:"]')].map(place => place.getBoundingClientRect())
        .filter(b => b.left < box.left - 1 || b.right > box.right + 1 || b.top < box.top - 1 || b.bottom > box.bottom + 1).length
    }), { message: `${width} px: every place stays inside the pitch` }).toBe(0)
  }
  // Focus is visible on a place on the pitch, from the keyboard.
  await page.keyboard.press('Tab')
  await place(page, 1).focus()
  const ring = await place(page, 1).evaluate(el => getComputedStyle(el).boxShadow)
  expect(ring).not.toBe('none')
  // Reduced motion: the board's colour changes don't animate.
  const transition = await place(page, 1).evaluate(el => getComputedStyle(el).transitionDuration)
  expect(transition.split(',').every(d => parseFloat(d) === 0)).toBe(true)
  expect(unexpected).toEqual([])
})
