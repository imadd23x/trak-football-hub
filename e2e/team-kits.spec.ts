import { test, expect } from '@playwright/test'

// Actual app routes against a synthetic intercepted backend. Database permissions
// are separately exercised by supabase/tests/team_kits.sql, never a shared project.
test('coach saves squad kits, publishes a kit event and reopens its announcement', async ({ page, context }, testInfo) => {
  const coach = '98203000-0000-4000-8000-000000000010'
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
  const user = { id: coach, email: 'coach@kits.invalid', email_confirmed_at: `${day}T00:00:00Z`, created_at: `${day}T00:00:00Z`,
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  // The page's clock is fixed at 08:00 UTC below. The session must outlive that
  // clock, not the real one: run before 07:00 UTC, an hour from now had already
  // expired at 08:00 and the app refreshed its token in a loop.
  const clockAt = new Date(`${day}T08:00:00Z`)
  const exp = Math.floor(Math.max(Date.now(), clockAt.getTime()) / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coach, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  let kits: Record<string, unknown> | null = null
  let event: Record<string, unknown> | null = null
  const errors: string[] = [], unexpected: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(request.url()); return route.abort() }
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') return json([{ id: coach, user_id: coach, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: coach, organization_id: 'org-203' }])
    // TRAK-196: Home's quiet line names the academy.
    if (path === '/rest/v1/organizations') return json([{ id: 'org-203', name: 'Synthetic Academy' }])
    if (path === '/rest/v1/squad_players') return json([
      { id: 'sp-203', coach_user_id: coach, player_name: 'Synthetic Player', status: 'active', age_group: 'U14', linked_player_id: null },
    ])
    if (path === '/rest/v1/coach_team_kits') {
      if (request.method() === 'POST') { kits = request.postDataJSON(); return json({ kits: kits?.kits }) }
      return json(kits ? [kits] : [])
    }
    if (path === '/rest/v1/coach_calendar_events') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        event = { ...(Array.isArray(body) ? body[0] : body), id: 'event-203', status: 'scheduled', sequence: 0 }
      } else if (request.method() === 'PATCH') event = { ...event, ...request.postDataJSON() }
      return json(event ? [event] : [])
    }
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    // TRAK-262: notification_settings is coach Home's Needs you switch (no row: on).
    if (['coach_sessions', 'coach_assessments', 'event_absences', 'session_attendance', 'coach_shared_feedback', 'matches', 'recognition_awards', 'notification_settings',
      // TRAK-286: no game plan, shared or not.
      'game_plans', 'game_shares', 'game_evaluations', 'game_evaluation_players', 'game_evaluation_notes', 'game_review_for_family', 'game_review_for_player', 'training_plans', 'training_plan_practices'].some(t => path === `/rest/v1/${t}`)) return json([])
    if (path === '/rest/v1/telemetry_events') return json(null)
    // TRAK-261: the coach's notification switches (the bell's "Can't make it"); no row means on.
    if (path === '/rest/v1/notification_settings') return json([])
    // TRAK-135 (#369): Publish asks the server to send the families' emails, fire-and-forget,
    // so whether it lands before the test ends is timing; expect it either way.
    if (path === '/functions/v1/send-event-emails') return json({ accepted: true })
    if (path.startsWith('/rest/v1/rpc/')) return json([])
    unexpected.push(`${request.method()} ${path}`)
    return route.fulfill({ status: 500, body: 'Unmocked request blocked' })
  })
  await page.clock.setFixedTime(clockAt)
  await page.goto('/coach/schedule')
  await page.getByRole('button', { name: 'Add event' }).click()
  const form = page.getByRole('dialog', { name: 'New event' })
  await form.getByRole('button', { name: 'Match', exact: true }).click()
  await form.getByLabel('Opponent').fill('Synthetic United')
  // TRAK-288: with Games on, New event asks a match's competition.
  await form.getByRole('group', { name: 'Competition' }).getByRole('button', { name: 'League' }).click()
  await form.getByRole('button', { name: 'Next', exact: true }).click()
  await form.getByRole('button', { name: /^Kickoff\b/ }).click()
  await page.getByRole('option', { name: '4:00 PM', exact: true }).click()
  await form.getByRole('button', { name: 'Next', exact: true }).click()
  await form.getByRole('button', { name: 'Set up team kits' }).click()
  await form.getByLabel('Start with a color set').selectOption('burgundy-gold')
  await form.getByLabel('Home shirt style').selectOption('stripes')
  await form.getByRole('button', { name: 'Save team kits', exact: true }).click()
  await form.getByRole('button', { name: 'Edit team kits' }).waitFor()
  await page.screenshot({ path: testInfo.outputPath('kit-selection.png'), fullPage: true })
  await form.getByRole('radio', { name: /^Away/ }).click()
  await expect(form.getByRole('heading', { name: 'Away kit' })).toBeVisible()
  await form.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(form.getByRole('heading', { name: 'Away kit' })).toBeVisible()
  await form.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(form).not.toBeVisible()
  // Publish saves the draft, closes the sheet, then publishes it: wait for that last step.
  await expect.poll(() => event).toMatchObject({ published: true, kit_snapshot: { version: 1, slot: 'away', design: { shirt: '#F5F3EC' } } })
  await page.goto('/coach/home')
  // TRAK-262: the coach's week picks an event on a tap; Details opens its sheet.
  await page.getByRole('button', { name: /Synthetic United/ }).click()
  await page.getByRole('button', { name: 'Details' }).click()
  const sheet = page.getByRole('dialog', { name: 'vs Synthetic United' })
  await expect(sheet.getByRole('heading', { name: 'Away kit' })).toBeVisible()
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(sheet.getByRole('img', { name: /Away kit:/ })).toBeVisible()
    await expect.poll(async () => (await sheet.boundingBox())?.y ?? 1000).toBeLessThan(100)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`announcement-${width}.png`), fullPage: true })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await sheet.locator('.trak-kit-animated > g').evaluateAll(parts => parts.every(part => getComputedStyle(part).animationName === 'none'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).not.toBeVisible()
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
})
