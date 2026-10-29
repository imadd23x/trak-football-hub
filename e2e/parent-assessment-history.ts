import { test, expect } from '@playwright/test'

// Registered by parent-family.spec.ts so the existing CI browser gate runs it.
test.describe('TRAK-172 parent assessment history', () => {
  test.use({ timezoneId: 'Asia/Dubai', hasTouch: true })
  for (const width of [390, 768]) test(`one full card, history and exact training bands at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const parent = '97200000-0000-4000-8000-000000000001', alex = '97200000-0000-4000-8000-000000000002', zara = '97200000-0000-4000-8000-000000000003'
    const user = { id: parent, email: 'parent@assessment172.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }
    const exp = Math.floor(Date.now() / 1000) + 3600
    const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: parent, exp, role: 'authenticated' }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
    await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)), { access_token: token, refresh_token: 'synthetic-history-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user })
    const records = (child: string) => Array.from({ length: child === alex ? 24 : 2 }, (_, index) => ({
      id: `${child}-assessment-${index + 1}`, session_id: `${child}-session-${index + 1}`, squad_player_id: child, coach_user_id: `${child}-coach-${index + 1}`,
      created_at: new Date(Date.UTC(2026, 9, 12 - index, 10)).toISOString(), coach_rating: 7, work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7,
    }))
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), params = url.searchParams
      if (url.origin === 'http://127.0.0.1:4189') return route.continue()
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
      const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
      if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
      if (url.pathname === '/auth/v1/user') return json(user)
      if (url.pathname === '/rest/v1/profiles') {
        const filter = params.get('user_id') ?? ''
        const profiles = [{ user_id: parent, id: parent, role: 'parent', full_name: 'Synthetic Parent' }, { user_id: alex, full_name: 'Alex Example' }, { user_id: zara, full_name: 'Zara Example' }, ...[alex, zara].flatMap(child => records(child).map((record, index) => ({ user_id: record.coach_user_id, full_name: `${child === alex ? 'Alex' : 'Zara'} Coach ${index + 1}` })))]
        return json(profiles.filter(profile => filter.includes(profile.user_id)))
      }
      if (url.pathname === '/rest/v1/player_parent_links') return json([{ player_user_id: alex }, { player_user_id: zara }])
      if (url.pathname === '/rest/v1/squad_players') return json([{ id: params.get('linked_player_id')?.slice(3) }])
      if (url.pathname === '/rest/v1/coach_assessments') {
        expect(params.get('select')).not.toMatch(/\*|private_notes|feedback/)
        const child = params.get('squad_player_id')?.includes(zara) ? zara : alex
        let rows = records(child)
        if (params.has('id')) rows = rows.filter(row => `eq.${row.id}` === params.get('id'))
        if (params.has('session_id')) rows = rows.filter(row => `eq.${row.session_id}` === params.get('session_id'))
        const offset = Number(params.get('offset') ?? 0), limit = Number(params.get('limit') ?? rows.length)
        return json(rows.slice(offset, offset + limit))
      }
      if (url.pathname === '/rest/v1/rpc/family_training_history') {
        const child = req.postDataJSON().p_player_user_id
        return json([{ session_id: `${child}-session-3`, session_date: '2026-10-10', focus: ['Set pieces'], attendance: 'present' }])
      }
      // TRAK-174: a saved explicit link and a legacy row, for each child.
      if (url.pathname === '/rest/v1/matches') {
        const child = params.get('user_id')?.slice(3) ?? alex
        const id = params.get('id')?.slice(3)
        const label = child === alex ? 'Alex' : 'Zara'
        return json([true, false].map(linked => ({
          id: `${child}-${linked ? 'linked' : 'legacy'}-match`, user_id: child,
          session_id: linked ? `${child}-session-3` : null,
          opponent: `${label} ${linked ? 'linked' : 'legacy'} match`, match_date: '2026-10-10',
          created_at: '2026-10-10T10:00:00Z', competition: 'League', venue: 'Home',
          team_score: 1, opponent_score: 0, computed_rating: 8, position: 'ST', age_group: 'U19', minutes_played: 90, goals: 0, assists: 0,
        })).filter(row => !id || row.id === id))
      }
      if (['player_details', 'recognition_awards', 'game_for_family', 'game_review_for_family'] /* TRAK-286, TRAK-289: no shared plan, no review */.some(name => url.pathname === `/rest/v1/${name}`)) return json([])
      if (['child_events', 'get_children_awaiting_consent', 'get_roster_children_awaiting_consent', 'get_my_child_logins', 'get_my_approved_children_awaiting_signup'].some(name => url.pathname === `/rest/v1/rpc/${name}`)) return json([])
      if (url.pathname === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
      unexpected.push(`${req.method()} ${url.pathname}`)
      return route.fulfill({ status: 500, body: '{"message":"Unexpected synthetic request"}', contentType: 'application/json' })
    })
    await page.goto('/parent/home')
    const viewport = page.getByRole('region', { name: 'Assessment cards' })
    const first = page.getByRole('group', { name: 'Assessment 1 of 5' })
    await expect(first.getByRole('link', { name: 'Open assessment' })).toHaveAttribute('href', `/parent/assessment/${alex}-assessment-1`)
    await expect(first.getByText('Alex Coach 1', { exact: true })).toHaveCount(0) // TRAK-194: no coach name
    const box = await viewport.boundingBox(), card = await first.boundingBox()
    expect(Math.abs(box!.width - card!.width)).toBeLessThan(2)
    await page.screenshot({ path: testInfo.outputPath(`assessment-home-${width}.png`), fullPage: true })
    // Exercise an actual browser touch swipe on mobile, native arrow keys on desktop.
    if (width === 390) {
      await viewport.scrollIntoViewIfNeeded()
      const rect = (await viewport.boundingBox())!
      const cdp = await context.newCDPSession(page), y = rect.y + 90
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width - 25, y }] })
      // Give the gesture a human swipe duration; zero-time moves create an extreme fling.
      for (let step = 1; step <= 6; step++) {
        await page.waitForTimeout(50) // gesture timing, not a readiness wait
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + rect.width - 25 - step * (rect.width - 50) / 6, y }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.getByRole('group', { name: 'Assessment 2 of 5' })).toBeVisible()
      await expect.poll(() => viewport.evaluate(el => el.scrollLeft / el.clientWidth)).toBe(1)
      await page.getByRole('button', { name: 'Previous assessment' }).tap()
      await expect(viewport).toHaveJSProperty('scrollLeft', 0)
    } else { await viewport.focus(); await page.keyboard.press('ArrowRight'); await expect(page.getByRole('group', { name: 'Assessment 2 of 5' })).toBeVisible(); await page.keyboard.press('ArrowLeft') }
    for (let i = 0; i < 5; i++) {
      const next = page.getByRole('button', { name: 'Next assessment' })
      if (width === 390) await next.tap(); else await next.click()
      await expect.poll(() => viewport.evaluate(el => el.scrollLeft / el.clientWidth)).toBe(i + 1)
    }
    await page.getByRole('link', { name: 'All assessments', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Assessments', exact: true })).toBeVisible()
    await expect(page.locator(`a[href="/parent/assessment/${alex}-assessment-11"]`)).toBeVisible()
    await page.getByRole('button', { name: 'Load more' }).click()
    await expect(page.locator(`a[href="/parent/assessment/${alex}-assessment-24"]`)).toBeVisible()
    await page.getByRole('button', { name: 'Events', exact: true }).click()
    await expect(page.getByRole('link', { name: /Alex legacy match/ })).toHaveAttribute('href', `/parent/match/${alex}-legacy-match`)
    await page.getByRole('link', { name: /Alex linked match/ }).click()
    await expect(page.getByRole('heading', { name: 'Coach assessment' })).toBeVisible()
    await expect(page.getByText('10 Oct', { exact: true }) /* assessment 3's date */).toBeVisible()
    await expect(page.getByText('12 Oct', { exact: true }) /* assessment 1's date */).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`match-bands-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: 'Match details', exact: true }).click()
    await expect(page.getByText('vs Alex linked match', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Events', exact: true }).click()
    await page.getByRole('link', { name: /Alex legacy match/ }).click()
    await expect(page.getByText('No assessment link is available for this match.')).toBeVisible()
    await page.getByRole('button', { name: 'Events', exact: true }).click()
    await page.getByRole('link', { name: /Alex linked match/ }).click()
    await page.getByRole('link', { name: 'All assessments', exact: true }).click()
    await page.getByRole('button', { name: 'Events', exact: true }).click()
    await page.getByRole('link', { name: /Set pieces/ }).click()
    await expect(page.getByRole('heading', { name: 'Coach assessment' })).toBeVisible()
    await expect(page.getByText('10 Oct', { exact: true }) /* assessment 3's date */).toBeVisible()
    await expect(page.getByText('Work Rate', { exact: true })).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`training-bands-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: 'All assessments', exact: true }).click()
    await page.getByLabel('Following').selectOption(zara)
    await expect(page.locator(`a[href="/parent/assessment/${zara}-assessment-1"]`)).toBeVisible()
    await expect(page.locator(`a[href^="/parent/assessment/${alex}"]`)).toHaveCount(0)
    await page.getByRole('button', { name: 'Events', exact: true }).click()
    await expect(page.getByRole('link', { name: /Alex linked match/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Zara legacy match/ })).toHaveAttribute('href', `/parent/match/${zara}-legacy-match`)
    await page.getByRole('link', { name: /Zara linked match/ }).click()
    await expect(page.getByRole('heading', { name: 'Coach assessment' })).toBeVisible()
    await expect(page.getByText('10 Oct', { exact: true }) /* a third Zara record's date */).toHaveCount(0)
    // Zara has only two records: her linked match is not assessed yet, which must not read as an error.
    await expect(page.getByText("Zara Example hasn't been assessed for this match yet.")).toBeVisible()
    await expect(page.getByRole('link', { name: 'Match details' })).toBeVisible()
    expect(unexpected).toEqual([]); expect(errors).toEqual([])
  })
})
