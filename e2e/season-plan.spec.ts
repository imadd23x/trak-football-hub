import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-350 (Season plan 2/18): the season plan's step 1 in a real browser, on a laptop and a phone. The coach starts
// from Home, picks one of the six and writes their own, saves a draft, and finds it after a reload. Production build,
// synthetic intercepted backend; the two season tables are a small in-memory stand-in.
const coachId = '97350000-0000-4000-8000-000000000001'
const players = ['Synthetic Player Pat', 'Synthetic Player Quinn'].map((name, i) => ({
  id: `sq-${i + 1}`, coach_user_id: coachId, player_name: name, position: 'Defender', age_group: 'U16', shirt_number: i + 1,
  status: 'active', linked_player_id: null, created_at: '2026-10-01T08:00:00Z',
}))
type Row = Record<string, unknown>

async function backend(context: BrowserContext, unexpected: string[], seen: string[] = []) {
  const plans: Row[] = [], objectives: Row[] = []
  const user = { id: coachId, email: 'coach@season350.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coachId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-season350-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname, eq = (key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
    // What the page asked for, in order: printed if the test fails, as CI keeps no trace.
    if (/season_|feature_on|squad_players/.test(path)) seen.push(`${Date.now() % 100000} ${req.method()} ${path}${url.search} ${req.postData() ?? ''}`.slice(0, 220))
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') return json([{ user_id: coachId, id: coachId, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: coachId, organization_id: 'org-350', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    // The season plan's switch answers last, as it did on CI on 3 Nov: the page must wait for it, not show "Not started".
    if (path === '/rest/v1/rpc/feature_on') {
      const feature = req.postDataJSON()?.p_feature
      if (feature === 'season_plan') await new Promise(resolve => setTimeout(resolve, 800))
      return json(['events', 'season_plan'].includes(feature))
    }
    if (path === '/rest/v1/season_plans') {
      if (req.method() === 'GET') return json(plans.filter(p => p.squad === eq('squad')))
      if (req.method() === 'POST') {
        const plan = { id: `plan-${plans.length + 1}`, shared_at: null, ...req.postDataJSON() }
        plans.push(plan)
        return json({ id: plan.id }, 201)
      }
      if (req.method() === 'PATCH') { Object.assign(plans.find(p => p.id === eq('id')) ?? {}, req.postDataJSON()); return route.fulfill({ status: 204, body: '' }) }
    }
    if (path === '/rest/v1/season_objectives') {
      if (req.method() === 'GET') return json(objectives.filter(o => o.plan_id === eq('plan_id')).sort((a, b) => Number(a.place) - Number(b.place)))
      if (req.method() === 'POST') {
        for (const row of req.postDataJSON() as Row[]) objectives.push({ id: `objective-${objectives.length + 1}`, ...row })
        return route.fulfill({ status: 201, body: '' })
      }
    }
    // Every other read is empty: this is about the season plan, not the rest of Home.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`season plan step 1 at ${width} px: start from Home, two objectives, save, reload`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], seen: string[] = []
    await backend(context, unexpected, seen)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/home')
    // TRAK-361: the card, a Start row while there's no plan.
    const row = page.getByRole('region', { name: 'U16 season plan' })
    await expect(row.getByText('Not started')).toBeVisible()
    await row.getByRole('button', { name: 'Start' }).click()

    await expect(page.getByRole('heading', { name: 'Season plan', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Stay compact' }).click()
    await page.getByRole('button', { name: 'Write your own' }).click()
    await page.getByLabel('Objective 2', { exact: true }).fill('Win the second ball')
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await expect(page.getByLabel('Objective 1', { exact: true })).toHaveValue('Stay compact')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    // Only once it's saved: a full-page screenshot can pass through a 1×1 window, the coach frame swaps to the phone
    // layout and back, and the page is rebuilt with nothing typed in it. CI caught it at 1280 on 4 Nov ("click Save
    // draft with inputs []" after "resize 1x1"). A saved plan comes back from the cache.
    await page.screenshot({ path: testInfo.outputPath(`season-plan-${width}.png`), fullPage: true })

    // After the reload the plan comes back first, then its objectives: wait for each in turn, so a failure says which.
    seen.push('--- reload')
    await page.reload()
    try {
      await expect(page.getByText('U16 · Draft, only you see it')).toBeVisible()
      await expect(page.getByLabel('Objective 1', { exact: true })).toHaveValue('Stay compact')
      await expect(page.getByLabel('Objective 2', { exact: true })).toHaveValue('Win the second ball')
    } catch (error) {
      console.log(`season-plan ${width}: requests\n${seen.join('\n')}\npage:\n${(await page.locator('body').innerText()).slice(0, 1500)}`)
      throw error
    }
    expect(unexpected).toEqual([])
  })
}
