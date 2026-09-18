import { test, expect } from '@playwright/test'

// Real built app/AuthProvider/SDK, synthetic adult family and HTTP responses.
// SQL ordering, aggregates and RLS are independently exercised by the SQL suite.
test('complete totals, more than 1000 matches, failed-page recovery and recent backfills', async ({ page, context }) => {
  const parent = 'a1111111-1111-4111-8111-111111111111'
  const alex = 'a2222222-2222-4222-8222-222222222222'
  const zara = 'a3333333-3333-4333-8333-333333333333'
  const user = { id: parent, email: 'history@example.test', email_confirmed_at: '2026-09-01T00:00:00Z',
    app_metadata: {}, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: parent, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)), {
    access_token: token, refresh_token: 'synthetic-history', expires_in: 3600, expires_at: exp, token_type: 'bearer', user,
  })
  const history = Array.from({ length: 1001 }, (_, index) => ({
    id: `b0000000-0000-4000-8000-${String(1001 - index).padStart(12, '0')}`,
    created_at: index === 1000 ? '2026-09-18T10:00:00Z' : '2026-09-01T10:00:00Z',
    match_date: index === 1000 ? '2020-01-01' : '2026-09-01',
    opponent: index === 1000 ? 'Recently recorded backfill' : `Opponent ${index + 1}`,
    competition: 'Synthetic Adult League', venue: null,
    team_score: index === 1000 ? 0 : 2, opponent_score: 1, computed_rating: index === 1000 ? 0 : 8,
  }))
  const unexpected: string[] = [], errors: string[] = []
  const pageReads: { p_child_id: string; p_after_id?: string; p_limit: number }[] = []
  let failNext = false
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const reject = () => { unexpected.push(`${request.method()} ${url.pathname}`); return json({ message: 'Unexpected call blocked' }, 500) }
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') return reject()
    if (request.headers().authorization !== `Bearer ${token}`) return reject()
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') return json(user)
    if (request.method() === 'POST') {
      if (url.pathname === '/rest/v1/telemetry_events') return json(null, 201)
      if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') return json([])
      const body = request.postDataJSON()
      if (![alex, zara].includes(body?.p_child_id)) return reject()
      if (url.pathname === '/rest/v1/rpc/get_parent_match_summary') return json([body.p_child_id === alex
        ? { total_count: 1001, rated_count: 1001, average_rating: 8000 / 1001, wins: 1000, draws: 0, losses: 1 }
        : { total_count: 1, rated_count: 1, average_rating: 8, wins: 1, draws: 0, losses: 0 }])
      if (url.pathname === '/rest/v1/rpc/get_parent_match_page') {
        pageReads.push(body)
        if (body.p_limit !== 51) return reject()
        if (body.p_child_id === zara) return json([{ ...history[0], opponent: 'Zara opponent' }])
        if (body.p_after_id && failNext) return json({ message: 'Synthetic page unavailable' }, 503)
        const start = body.p_after_id ? history.findIndex(row => row.id === body.p_after_id) + 1 : 0
        if (body.p_after_id && start === 0) return reject()
        return json(history.slice(start, start + 51))
      }
      return reject()
    }
    if (request.method() !== 'GET') return reject()
    if (url.pathname === '/rest/v1/player_parent_links') return json([{ player_user_id: alex }, { player_user_id: zara }])
    if (url.pathname === '/rest/v1/profiles') {
      if (url.searchParams.get('user_id') === `eq.${parent}`) {
        const profile = { id: parent, user_id: parent, role: 'parent', full_name: 'Synthetic Parent' }
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile])
      }
      return json([{ user_id: alex, full_name: 'Alex Adult' }, { user_id: zara, full_name: 'Zara Adult' }])
    }
    if (url.pathname === '/rest/v1/player_details' || url.pathname === '/rest/v1/squad_players') return json([])
    if (url.pathname === '/rest/v1/matches') {
      const limit = url.searchParams.get('limit'), order = url.searchParams.get('order')
      if (limit === '20' && order === 'created_at.desc.nullslast,id.desc') return json([history[1000], ...history.slice(0, 19)])
      if (limit === '5' && order === 'match_date.desc.nullslast,created_at.desc.nullslast,id.desc') return json(history.slice(0, 5))
    }
    return reject()
  })

  await page.goto('/parent/home')
  await expect(page.getByRole('region', { name: 'Recorded matches summary' })).toContainText('1001')
  await expect(page.getByRole('region', { name: 'Recent matches' }).getByText(/^Opponent \d+$/)).toHaveCount(5)
  await page.getByRole('button', { name: 'Matches', exact: true }).click()
  await expect(page.getByText(/^Opponent \d+$/)).toHaveCount(50)
  failNext = true
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Opponent 1', { exact: true })).toBeVisible()
  failNext = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('Opponent 51', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Match history · page 2', exact: true })).toBeFocused()
  await expect(page.getByText('Opponent 51', { exact: true })).toBeInViewport()
  // All 1,001 records remain reachable and only one page is rendered at once.
  for (let pageNumber = 2; pageNumber < 20; pageNumber++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByText(`Opponent ${pageNumber * 50 + 1}`, { exact: true })).toBeVisible()
    await expect(page.getByText(/^Opponent \d+$/)).toHaveCount(50)
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Recently recorded backfill', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect(page.getByText(/^Opponent \d+$/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText('Opponent 951', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Match history · page 20', exact: true })).toBeFocused()
  await expect(page.getByText('Opponent 951', { exact: true })).toBeInViewport()
  await page.getByRole('combobox').selectOption(zara)
  await expect(page.getByText('Zara opponent', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
  await page.getByRole('combobox').selectOption(alex)
  await page.getByRole('button', { name: 'Alerts', exact: true }).click()
  await expect(page.getByText('vs Recently recorded backfill · 0–1', { exact: true })).toBeVisible()
  await expect(page.getByText('Match logged', { exact: true })).toHaveCount(20)
  expect(pageReads.some(read => read.p_after_id === history[999].id)).toBe(true)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})
