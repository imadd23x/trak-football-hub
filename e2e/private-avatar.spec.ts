import { test, expect } from '@playwright/test'

// Production bundle + real router/AuthProvider/Storage SDK. All remote traffic is
// intercepted; these tests never use a real account or write production data.
for (const { role, stall } of [
  ...['parent', 'player', 'coach', 'club'].map(role => ({ role, stall: false })),
  { role: 'parent', stall: true },
]) {
  test(`${role} private photo ${stall ? 'times out, cancels and retries' : 'decodes, retries and survives upload/reload'}`, async ({ page, context }, testInfo) => {
    const id = '11111111-1111-4111-8111-111111111111'
    const profile = { id, user_id: id, role, full_name: 'Synthetic Avatar User', nationality: null,
      invite_code: 'ABC123', avatar_url: `https://xbykbqolvqyqmipikuae.supabase.co/storage/v1/object/public/avatars/${id}` }
    const user = { id, email: 'avatar@example.test', email_confirmed_at: '2026-09-01T00:00:00Z',
      app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' }
    const exp = Math.floor(Date.now() / 1000) + 3600
    const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated', email: user.email }]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
    const session = { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user }
    await context.addInitScript(value => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(value)), session)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    let denyPhoto = false
    let holdPhoto = stall
    const cancelled: string[] = []
    page.on('requestfailed', request => { if (request.url().includes('/storage/v1/object/avatars/')) cancelled.push(request.failure()?.errorText ?? 'unknown') })
    const unexpected: string[] = [], errors: string[] = [], reads: string[] = [], writes: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method()
      if (url.origin === 'http://127.0.0.1:4189') return route.continue()
      const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') {
        if (!url.hostname.includes('fonts.')) unexpected.push(request.url())
        return route.abort()
      }
      const path = url.pathname
      if (path === '/auth/v1/user' && method === 'GET') return json(user)
      if (path === `/storage/v1/object/avatars/${id}`) {
        expect(request.headers().authorization).toBe(`Bearer ${token}`)
        if (method === 'GET') {
          reads.push(path)
          if (holdPhoto) return new Promise<void>(() => {})
          return denyPhoto ? json({ message: 'Synthetic denied read' }, 403)
            : route.fulfill({ contentType: 'image/png', body: png, headers: { 'Cache-Control': 'no-store' } })
        }
        if (method === 'POST') { writes.push(path); return json({ Key: `avatars/${id}` }) }
      }
      if (path === '/rest/v1/profiles' && ['GET', 'PATCH'].includes(method)) {
        expect(url.searchParams.get('user_id')).toBe(`eq.${id}`)
        if (method === 'PATCH') {
          expect(request.headers().authorization).toBe(`Bearer ${token}`)
          const body = request.postDataJSON()
          expect(Object.keys(body)).toEqual(['avatar_url'])
          expect(body.avatar_url).toMatch(new RegExp(`^avatars/${id}\\?v=\\d+$`))
          profile.avatar_url = body.avatar_url
          writes.push(path)
        }
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile])
      }
      if (path === '/rest/v1/telemetry_events' && method === 'POST') return json(null, 201)
      if (['/rest/v1/rpc/get_children_awaiting_consent', '/rest/v1/rpc/get_player_invites_for_current_user'].includes(path) && method === 'POST') return json([])
      if (['/rest/v1/player_parent_links', '/rest/v1/squad_players', '/rest/v1/matches', '/rest/v1/organizations', '/rest/v1/player_details', '/rest/v1/coach_details'].includes(path) && method === 'GET') {
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? null : [])
      }
      unexpected.push(`${method} ${path}`)
      return json({ message: 'Unmocked request blocked' }, 500)
    })
    const decoded = async () => {
      const photo = page.getByRole('img', { name: 'Profile', exact: true })
      await expect(photo).toHaveAttribute('src', /^blob:/)
      await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
      return photo.getAttribute('src')
    }
    await page.goto(`/${role}/profile`)
    if (stall) {
      await expect(page.getByRole('status')).toHaveText('Loading profile photo')
      await expect(page.getByRole('button', { name: 'Retry profile photo' })).toBeVisible({ timeout: 25_000 })
      await expect.poll(() => cancelled).toContain('net::ERR_ABORTED')
      await page.screenshot({ path: testInfo.outputPath('private-photo-timeout.png') })
      holdPhoto = false
      await page.getByRole('button', { name: 'Retry profile photo' }).click()
    }
    await decoded()
    await page.screenshot({ path: testInfo.outputPath(`${role}-profile-photo.png`), fullPage: true })
    expect(reads.length).toBeGreaterThan(0)
    expect(writes).toEqual([])

    denyPhoto = true
    await page.reload()
    await expect(page.getByRole('button', { name: 'Retry profile photo' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Profile', exact: true })).toHaveCount(0)
    denyPhoto = false
    await page.getByRole('button', { name: 'Retry profile photo' }).click()
    await decoded()

    await page.getByRole('button', { name: /settings/i }).click()
    await expect(page).toHaveURL(/\/settings$/)
    const oldImage = await decoded()
    await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-photo.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByText('Profile photo updated', { exact: true })).toBeVisible()
    await expect.poll(decoded).not.toBe(oldImage)
    expect(writes).toEqual([`/storage/v1/object/avatars/${id}`, '/rest/v1/profiles'])
    await page.reload()
    await decoded()
    await page.goto(`/${role}/profile`)
    await decoded()
    expect(errors).toEqual([])
    expect(unexpected).toEqual([])
  })
}
