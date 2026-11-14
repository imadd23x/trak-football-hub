import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-356 (Season plan 8/18): the issue's own check, in a real browser on a laptop and a phone. Step 4 shows what goes
// out and waits for the face-to-face tick; Share opens View plan. Removing a season objective there retires it into
// the plan's history, the change waits under Not shared yet, and Share the changes clears it. Home offers View plan.
// Production build, synthetic intercepted backend that keeps the plan's list of changes as the database does.
const coachId = '97356000-0000-4000-8000-000000000001'
type Row = Record<string, unknown>

async function backend(context: BrowserContext, unexpected: string[]) {
  const players: Row[] = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'].map((position, i) => ({
    id: `sq-${i + 1}`, coach_user_id: coachId, player_name: `Synthetic Player ${String(i + 1).padStart(2, '0')}`, position,
    age_group: 'U16', shirt_number: i + 1, status: 'active', linked_player_id: `child-${i + 1}`, created_at: '2026-10-01T08:00:00Z',
  }))
  let plan: Row = { id: 'plan-1', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: null, positions_known: 'yes',
    last_shared_at: null, unshared_parts: [], unshared_players: [] }
  let objectives: Row[] = [
    { id: 'so-1', plan_id: 'plan-1', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press the moment we lose it.', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
    { id: 'so-2', plan_id: 'plan-1', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m from back to front.', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
  ]
  const held: Row[] = [{ id: 'po-1', squad_player_id: 'sq-2', title: 'Holds the line together', source: 'library', season_objective_id: null, created_at: '2026-11-01T08:00:00Z', status: 'open', retired_at: null }]
  const shares: Row[] = []
  const deletes: string[] = []
  const note = (part: string) => {
    const parts = plan.unshared_parts as string[]
    if (plan.shared_at && !parts.includes(part)) plan = { ...plan, unshared_parts: [...parts, part] }
  }
  const user = { id: coachId, email: 'coach@share356.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-share356-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
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
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-356', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/feature_on') return json(['events', 'season_plan'].includes(req.postDataJSON()?.p_feature))
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    if (path === '/rest/v1/season_plans' && method === 'GET') return json([plan])
    if (path === '/rest/v1/season_objectives' && method === 'GET') return json(objectives)
    if (path === '/rest/v1/season_objectives' && method === 'PATCH') {
      const ids = (url.searchParams.get('id') ?? '').replace(/^(eq\.|in\.\()|\)$/g, '').split(',').map(id => id.replace(/"/g, ''))
      const body = req.postDataJSON()
      objectives = objectives.map(o => (ids.includes(o.id as string) ? { ...o, ...body, retired_at: body.status === 'retired' ? new Date().toISOString() : o.retired_at } : o))
      note('season_objectives')
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/rest/v1/season_objectives' && method === 'DELETE') { deletes.push(url.search); return route.fulfill({ status: 204, body: '' }) }
    if (path === '/rest/v1/player_objectives') return json(held)
    if (path === '/rest/v1/objective_progress') return json([])
    if (path === '/rest/v1/rpc/stuck_player_objectives') return json([])
    if (path === '/rest/v1/rpc/share_season_plan') {
      shares.push(req.postDataJSON())
      const now = new Date().toISOString()
      plan = { ...plan, shared_at: plan.shared_at ?? now, last_shared_at: now, unshared_parts: [], unshared_players: [] }
      return json(now)
    }
    // Every other read is empty: this is about sharing the plan, not the rest of the app.
    if (path.startsWith('/rest/v1/') && (method === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${method} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return { shares, deletes }
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`share at ${width} px: the tick, View plan, a removed objective in its history, and Share the changes`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = []
    const { shares, deletes } = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/season-plan/share')

    // Step 4: what goes out, and Share waits for the tick.
    await expect(page.getByRole('heading', { name: 'What goes out' })).toBeVisible()
    await expect(page.getByText('1 of 4 players has one or two')).toBeVisible()
    await expect(page.getByText(/don.t see the season plan/)).toHaveCount(0)
    const share = page.getByRole('button', { name: 'Share now' })
    await expect(share).toBeDisabled()
    await page.getByRole('checkbox', { name: 'I’ve talked objectives through with the players, face to face' }).click()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`share-step-${width}.png`) })
    await share.click()

    // View plan, read-only, with an Edit beside each part.
    await expect(page.getByText(`Shared ${today}.`)).toBeVisible()
    await expect(page).toHaveURL(/\/coach\/season-plan$/)
    expect(shares).toEqual([{ p_plan_id: 'plan-1', p_talked: true }])
    await expect(page.getByRole('navigation', { name: 'Season plan steps' })).toHaveCount(0)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`view-plan-${width}.png`) })

    // One screen: remove Stay compact, and it retires into the history.
    await page.getByRole('button', { name: 'Edit season objectives' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Season objectives' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Stay compact' }).click()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`edit-objectives-${width}.png`) })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Not shared yet: season objectives.')).toBeVisible()
    const history = page.getByRole('heading', { name: 'Removed' }).locator('..')
    await expect(history).toContainText('Stay compact')
    await expect(history).toContainText(`removed ${today}`)
    expect(deletes).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`not-shared-yet-${width}.png`) })

    // Share the changes clears the banner, with no second tick.
    await page.getByRole('button', { name: 'Share the changes' }).click()
    await expect(page.getByText(`Shared ${today}.`)).toBeVisible()
    await expect(page.getByText(/^Not shared yet/)).toHaveCount(0)
    expect(shares).toEqual([{ p_plan_id: 'plan-1', p_talked: true }, { p_plan_id: 'plan-1', p_talked: false }])

    // Home: View plan, and a set-up step's address shows the plan.
    await page.goto('/coach/home')
    // TRAK-361: the card folds; open, it offers View plan.
    const card = page.getByRole('region', { name: 'U16 season plan' })
    await expect(card.getByText(new RegExp(`^Shared ${today} · \\d+ weeks? left$`))).toBeVisible()
    await card.locator('button[aria-expanded]').first().click()
    await card.getByRole('button', { name: 'View plan' }).click()
    await expect(page.getByText(`Shared ${today}.`)).toBeVisible()
    await page.goto('/coach/season-plan/positions')
    await expect(page).toHaveURL(/\/coach\/season-plan$/)
    await expect(page.getByRole('heading', { name: 'Season objectives' })).toBeVisible()
    expect(unexpected).toEqual([])
  })
}
