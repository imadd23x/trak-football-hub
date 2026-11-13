import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-402 (Season plan 18/18 build 7/8): the family's evaluation in a real browser, at 1280, 834 and 390. Home's assessment
// card says how the objectives went; the assessment opens as "Evaluation" with the bands, the Progress with its history
// and one line where the coach's note would be. The note is never requested. A failed progress read is said, with Retry.
// Production build, synthetic intercepted backend.
const parent = '97402000-0000-4000-8000-000000000001', alex = '97402000-0000-4000-8000-000000000002'

async function backend(context: BrowserContext, unexpected: string[], state: { failProgress: boolean; noteReads: number; progressChildren: string[] }) {
  const user = { id: parent, email: 'guardian@eval402.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: parent, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-eval402', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
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
    if (path === '/rest/v1/profiles') {
      if ((url.searchParams.get('user_id') ?? '') === `eq.${parent}`) return rows([{ id: parent, user_id: parent, role: 'parent', full_name: 'Synthetic Guardian', nationality: null }])
      return rows([{ user_id: alex, full_name: 'Alex Example' }])
    }
    if (path === '/rest/v1/player_parent_links') return json([{ player_user_id: alex }])
    if (path === '/rest/v1/rpc/guardian_consent_applies') return json(true)
    if (path === '/rest/v1/player_details') return rows([{ position: 'Midfielder', current_club: 'Synthetic FC', age_group: 'U15' }])
    if (path === '/rest/v1/squad_players') return rows([{ id: 'sq-402' }])
    if (path === '/rest/v1/coach_assessments') return rows([{ id: 'as-eval', squad_player_id: 'sq-402', session_id: null, evaluation_id: 'ev-1',
      coach_user_id: 'coach-402', created_at: '2026-11-01T10:00:00Z', coach_rating: 7,
      work_rate: 9, tactical: 6, attitude: 8, technical: 5, physical: 7, coachability: 3 }])
    if (path === '/rest/v1/coach_shared_feedback') { state.noteReads += 1; return rows([]) }
    if (path === '/rest/v1/rpc/evaluation_progress') {
      state.progressChildren.push((req.postDataJSON() as { p_child?: string }).p_child ?? '')
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
  test(`the family's evaluation at ${width} px: Home's Progress line, then the page with Progress and the quiet note line`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], state = { failProgress: false, noteReads: 0, progressChildren: [] as string[] }
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, state)
    await page.setViewportSize({ width, height })
    await page.goto('/parent/home')
    const card = page.getByRole('region', { name: 'Latest coach assessment' })
    await expect(card.getByText('Progress: 1 on track, 1 some progress')).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`family-evaluation-home-${width}.png`) })
    await card.getByRole('link', { name: 'Open assessment' }).click()

    await expect(page).toHaveURL(/\/parent\/assessment\/as-eval$/)
    await expect(page.getByRole('heading', { name: 'Evaluation' })).toBeVisible()
    const progress = page.getByRole('region', { name: 'Progress' })
    await expect(progress.getByText('Holds the line together')).toBeVisible()
    await expect(progress.getByText('4 Oct: Not yet, then 1 Nov: On track')).toBeVisible()
    await expect(page.getByText("Your coach's note is for Alex Example. You see the band, the six ratings and the progress.")).toBeVisible()
    expect((await progress.boundingBox())!.width).toBeLessThanOrEqual(390)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`family-evaluation-page-${width}.png`), fullPage: true })
    // The guardian's read names the child, and the note is never requested.
    expect(new Set(state.progressChildren)).toEqual(new Set([alex]))
    expect(state.noteReads).toBe(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('a failed progress read is said, with Retry, and the quiet line still shows', async ({ context, page }) => {
  const unexpected: string[] = [], errors: string[] = [], state = { failProgress: true, noteReads: 0, progressChildren: [] as string[] }
  page.on('pageerror', error => errors.push(error.message))
  await backend(context, unexpected, state)
  await page.goto('/parent/assessment/as-eval')
  await expect(page.getByText("Couldn't load the progress.")).toBeVisible()
  await expect(page.getByText(/Your coach's note is for Alex Example/)).toBeVisible()
  state.failProgress = false
  await page.getByRole('button', { name: /retry|try again/i }).click()
  await expect(page.getByRole('region', { name: 'Progress' }).getByText('Holds the line together')).toBeVisible()
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})
