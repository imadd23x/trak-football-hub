import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-579 (coach–player P02): My tasks on the player's Home in a real browser, in the family look, at 390 and 1280.
// Got it answers at once and Undo takes it back; a changed Got it comes first with Updated; nothing scrolls sideways.
// Production build, synthetic intercepted backend.
const playerId = '97579000-0000-4000-8000-000000000002'
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

async function backend(context: BrowserContext, unexpected: string[], answers: string[]) {
  const user = { id: playerId, email: 'player@tasks579.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-tasks579', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  const answered = new Set<string>(['shin-pads'])
  await context.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const rows = (all: Record<string, unknown>[]) => json(req.headers()['accept']?.includes('vnd.pgrst.object') ? all[0] ?? null : all)
    const path = url.pathname
    if (path === '/rest/v1/telemetry_events' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/rpc/my_announcements') return json([]) // TRAK-603: no announcements
    if (path === '/rest/v1/profiles') return rows([{ id: playerId, user_id: playerId, role: 'player', full_name: 'Theodoros Zagorakis' }])
    if (path === '/rest/v1/player_details') return rows([{ user_id: playerId, position: 'Midfielder', age_group: 'U16', current_club: 'Synthetic FC' }])
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, invited_parent: null })
    if (path === '/rest/v1/rpc/family_feature_on') return json(true)
    if (path === '/rest/v1/rpc/my_tasks') return json([
      { task_id: 'plan', title: 'Read the plan for Tuesday', answer_kind: 'got_it', due_at: inDays(4), outdated: true },
      { task_id: 'video', title: 'Watch the pressing clip before training', answer_kind: 'done', due_at: inDays(1), outdated: false },
      { task_id: 'shin-pads', title: 'Bring your shin pads on Saturday', answer_kind: 'done', due_at: inDays(3), outdated: false },
      { task_id: 'first-touch', title: 'Your first touch', answer_kind: 'ready_for_review', due_at: null, outdated: false },
    ].map(t => ({ ...t, source_type: 'manual', source_id: null, time_zone: 'Asia/Dubai',
      answered: t.task_id === 'plan' || answered.has(t.task_id) }))
    )
    if (path === '/rest/v1/rpc/respond_to_task' || path === '/rest/v1/rpc/undo_task_response') {
      const id = (req.postDataJSON() as { p_task_id: string }).p_task_id
      answers.push(`${path.endsWith('undo_task_response') ? 'undo' : 'answer'} ${id}`)
      if (path.endsWith('undo_task_response')) answered.delete(id); else answered.add(id)
      return json(null)
    }
    // Every other read is empty: this is about My tasks, not the rest of Home.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return rows([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[390, 844], [1280, 800]] as const) {
  test(`My tasks at ${width} px: Updated first, Got it and Undo answer at once, nothing scrolls sideways`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], answers: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, answers)
    await page.setViewportSize({ width, height })
    await page.goto('/player/home')
    const region = page.getByRole('region', { name: 'My tasks' })
    const titles = region.getByRole('article').getByRole('heading')
    await expect(titles).toHaveText(['Read the plan for Tuesday', 'Watch the pressing clip before training', 'Bring your shin pads on Saturday'])
    await expect(region.getByRole('article').first().getByText('Updated')).toBeVisible()
    await expect(region.getByRole('button', { name: 'See more (1)' })).toBeVisible()
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await region.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`my-tasks-${width}.png`) })

    await region.getByRole('button', { name: 'Done: Watch the pressing clip before training' }).click()
    await expect(region.getByRole('button', { name: 'Undo Done: Watch the pressing clip before training' })).toBeVisible()
    await region.getByRole('button', { name: 'Undo Done: Bring your shin pads on Saturday' }).click()
    await expect(region.getByRole('button', { name: 'Done: Bring your shin pads on Saturday' })).toBeVisible()
    await expect.poll(() => answers).toEqual(['answer video', 'undo shin-pads'])
    await page.screenshot({ path: testInfo.outputPath(`my-tasks-answered-${width}.png`) })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
