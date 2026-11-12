import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-401 (Season plan 18/18 build 6/8): the player's evaluation in a real browser, at 1280, 834 and 390. Home's assessment
// card says how the objectives went; the assessment opens as "Evaluation" with the bands, the Progress with its history and
// the coach's note, which is the player's alone. A failed progress read is said, and the note still shows. Production
// build, synthetic intercepted backend.
const playerId = '97401000-0000-4000-8000-000000000002'
const NOTE = 'Strong month, Manos. Keep talking to Sam at corners and the back four will follow.'

async function backend(context: BrowserContext, unexpected: string[], state: { failProgress: boolean }) {
  const user = { id: playerId, email: 'player@eval401.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-eval401', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const rows = (all: Record<string, unknown>[]) => json(req.headers()['accept']?.includes('vnd.pgrst.object') ? all[0] ?? null : all)
    const path = url.pathname
    if (path === '/rest/v1/telemetry_events' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') return rows([{ id: playerId, user_id: playerId, role: 'player', full_name: 'Manos Synthetic' }])
    if (path === '/rest/v1/player_details') return rows([{ user_id: playerId, position: 'Defender', age_group: 'U16', current_club: 'Synthetic FC' }])
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, invited_parent: null })
    if (path === '/rest/v1/squad_players') return rows([{ id: 'sq-401', coach_user_id: 'coach-401' }])
    if (path === '/rest/v1/coach_assessments') return rows([{ id: 'as-eval', squad_player_id: 'sq-401', coach_user_id: 'coach-401',
      created_at: '2026-11-01T10:00:00Z', work_rate: 9, tactical: 6, attitude: 8, technical: 5, physical: 7, coachability: 3, coach_rating: 7,
      evaluation_id: 'ev-1' }])
    if (path === '/rest/v1/coach_shared_feedback') return rows([{ body: NOTE, published_at: '2026-11-01T10:00:00Z' }])
    if (path === '/rest/v1/rpc/evaluation_progress') {
      if (state.failProgress) return json({ message: 'boom' }, 500)
      return json([{ assessment_id: 'as-eval', due_on: '2026-11-01', objectives: [
        { id: 'po-1', title: 'Holds the line together', status: 'on_track',
          history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'on_track' }] },
        { id: 'po-2', title: 'Talks to the keeper at every corner', status: 'some_progress',
          history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'some_progress' }] }] }])
    }
    // Every other read is empty: this is about the assessment, not the rest of Home.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return rows([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [834, 1112], [390, 844]] as const) {
  test(`the player's evaluation at ${width} px: Home's Progress line, then the page with Progress and the coach's note`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], state = { failProgress: false }
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, state)
    await page.setViewportSize({ width, height })
    await page.goto('/player/home')
    const card = page.getByRole('region', { name: 'Latest coach assessment' })
    await expect(card.getByText('Progress: 1 on track, 1 some progress')).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`evaluation-home-${width}.png`) })
    await card.getByRole('link', { name: 'Open assessment' }).click()

    await expect(page).toHaveURL(/\/player\/feedback\/as-eval$/)
    await expect(page.getByRole('heading', { name: 'Evaluation' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Your bands' })).toBeVisible()
    const progress = page.getByRole('region', { name: 'Progress' })
    await expect(progress.getByText('Holds the line together')).toBeVisible()
    await expect(progress.getByText('4 Oct: Not yet, then 1 Nov: On track')).toBeVisible()
    await expect(progress.getByText('4 Oct: Not yet, then 1 Nov: Some progress')).toBeVisible()
    const note = page.getByRole('region', { name: 'From your coach' })
    await expect(note).toContainText('From your coach, only you see this')
    await expect(note).toContainText(NOTE)
    // One phone-width column at every width, nothing scrolls sideways.
    expect((await progress.boundingBox())!.width).toBeLessThanOrEqual(390)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-page-${width}.png`), fullPage: true })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('a failed progress read is said, with Retry, and the coach note still shows', async ({ context, page }) => {
  const unexpected: string[] = [], errors: string[] = [], state = { failProgress: true }
  page.on('pageerror', error => errors.push(error.message))
  await backend(context, unexpected, state)
  await page.goto('/player/feedback/as-eval')
  await expect(page.getByRole('alert')).toContainText("Couldn't load your progress")
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'From your coach' })).toContainText(NOTE)
  state.failProgress = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('region', { name: 'Progress' }).getByText('Holds the line together')).toBeVisible()
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})
