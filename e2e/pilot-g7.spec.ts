import { test, expect } from '@playwright/test'

for (const role of ['player', 'coach', 'club'] as const) {
  test(`G7 ${role} routes, photos and manual feedback`, async ({ page, context }, testInfo) => {
    const id = '97000000-0000-4000-8000-000000000001'
    const user = { id, email: `${role}@example.test`, email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: {}, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' }
    const exp = Math.floor(Date.now() / 1000) + 3600
    const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
    await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)), {
      access_token: token, refresh_token: 'synthetic', expires_in: 3600, expires_at: exp, token_type: 'bearer', user,
    })
    const unexpected: string[] = [], errors: string[] = [], opened: unknown[] = []
    let failFeedback = true
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === 'http://127.0.0.1:4189') return route.continue()
      const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') {
        unexpected.push(request.url())
        return route.abort()
      }
      if (url.pathname === '/auth/v1/user') return json(user)
      if (url.pathname === '/rest/v1/profiles') return json({ id, user_id: id, role, full_name: 'Synthetic Pilot', avatar_url: 'https://photos.example.test/child.jpg' })
      if (url.pathname === '/rest/v1/telemetry_events') {
        opened.push(request.postDataJSON())
        return json(null, 201)
      }
      if (url.pathname === '/rest/v1/coach_shared_feedback') {
        expect(url.searchParams.get('assessment_id')).toBe('eq.synthetic-assessment')
        expect(url.searchParams.get('published_at')).toBe('not.is.null')
        return failFeedback ? json({ message: 'Synthetic failure' }, 503) : json({ body: 'Look up before receiving. Your coach wrote this.' })
      }
      if (url.pathname === `/rest/v1/${role}_details`) return json({})
      if (['/rest/v1/squad_players', '/rest/v1/player_parent_links', '/rest/v1/coach_sessions', '/rest/v1/coach_assessments'].includes(url.pathname)) return json([])
      unexpected.push(request.method() + ' ' + url.pathname)
      return json({ message: 'Unmocked request blocked' }, 500)
    })

    const paths = role === 'player' ? ['/player/passport', '/player/evolution']
      : role === 'club' ? ['/club/home', '/club/squads', '/club/coaches', '/club/profile', '/club/radar']
        : ['/coach/assistant', '/coach/feedback/synthetic-assessment', '/coach/schedule', '/coach/recognition', '/coach/award']
    for (const path of paths) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible()
      await expect(page.getByRole('link', { name: role === 'club' ? 'Account settings' : 'Back to home' }))
        .toHaveAttribute('href', role === 'club' ? '/settings' : `/${role}/home`)
    }
    await page.screenshot({ path: testInfo.outputPath('coming-soon-mobile.png'), fullPage: true })
    if (role === 'club') await page.getByRole('link', { name: 'Account settings' }).click()
    else await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Synthetic Pilot', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible()
    await expect(page.locator('input[type=file], img')).toHaveCount(0)
    await expect(page.getByText('Profile photos are coming soon.')).toBeVisible()

    if (role === 'coach') {
      await page.goto('/coach/squad/add')
      await expect(page).toHaveURL(/\/coach\/squad$/)
      await expect(page.getByRole('heading', { name: 'Squad' })).toBeVisible()
      await expect(page.getByRole('button', { name: /add player/i })).toHaveCount(0)
      await page.goto('/coach/quick-assess')
      await expect(page).toHaveURL(/\/coach\/assess$/)
      await expect(page.getByRole('heading', { name: 'Assessment' })).toBeVisible()
      await page.goto('/coach/sessions/quick')
      await expect(page.getByText(/No squad yet\./)).toBeVisible()
    }

    if (role === 'player') {
      await page.goto('/player/feedback/synthetic-assessment')
      // The SDK retries 503 responses with backoff before surfacing the error.
      await expect(page.getByRole('alert')).toContainText("Couldn't load feedback", { timeout: 15000 })
      expect(JSON.stringify(opened)).not.toContain('feedback_opened')
      failFeedback = false
      await page.getByRole('button', { name: 'Retry' }).click()
      await expect(page.getByText('Look up before receiving. Your coach wrote this.')).toBeVisible()
      await expect.poll(() => JSON.stringify(opened)).toContain('feedback_opened')
      await page.screenshot({ path: testInfo.outputPath('manual-feedback-mobile.png'), fullPage: true })
    }
    expect(errors).toEqual([])
    expect(unexpected).toEqual([])
  })
}
