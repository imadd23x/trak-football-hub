import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Real built route/AuthProvider/SDK, with every backend call intercepted.
// This verifies the UI boundary, not database authority or email delivery.
const appOrigin = 'http://127.0.0.1:4189'
const backendOrigin = 'https://xbykbqolvqyqmipikuae.supabase.co'
const playerId = '11111111-1111-4111-8111-111111111111'
const inviteId = '22222222-2222-4222-8222-222222222222'
const guardianEmail = 'academy.supplied.guardian.with.a.long.address@example.test'
const guidance = 'Contact your academy to add a guardian or correct their email.'
type State = 'empty' | 'accepted' | 'pending' | 'expired'

async function profileFixture(page: Page, context: BrowserContext, state: State, failedRead = false) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const user = {
    id: playerId, email: 'synthetic.player@example.test', email_confirmed_at: '2026-09-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-09-01T00:00:00Z',
  }
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp: expiresAt, role: 'authenticated', email: user.email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  const session = { access_token: token, refresh_token: 'synthetic-profile-refresh', expires_in: 3600, expires_at: expiresAt, token_type: 'bearer', user }
  await context.addInitScript(value => {
    localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(value))
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  }, session)
  let invitation = {
    id: inviteId, player_user_id: playerId, parent_email: guardianEmail,
    invite_token: 'synthetic-old-token', status: state === 'accepted' ? 'accepted' : 'pending',
    expires_at: new Date(Date.now() + (state === 'expired' ? -1 : 1) * 86_400_000).toISOString(),
  }
  const unexpected: string[] = []
  const errors: string[] = []
  const resends: unknown[] = []
  let reads = 0
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === appOrigin) return route.continue()
    if (url.origin !== backendOrigin) {
      unexpected.push(request.url())
      return route.abort()
    }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const reject = () => {
      unexpected.push(`${request.method()} ${url.pathname}${url.search}`)
      return json({ message: 'Unexpected synthetic request blocked' }, 500)
    }
    if (request.headers().authorization !== `Bearer ${token}`) return reject()
    if (request.method() === 'GET') {
      if (url.pathname === '/auth/v1/user') return json(user)
      if (url.pathname === '/rest/v1/profiles' && url.searchParams.get('user_id') === `eq.${playerId}`) {
        const profile = { id: playerId, user_id: playerId, full_name: 'Synthetic Player', role: 'player', avatar_url: null, nationality: null }
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile])
      }
      if (['/rest/v1/player_details', '/rest/v1/matches', '/rest/v1/squad_players'].includes(url.pathname)
        && url.searchParams.get(url.pathname.endsWith('squad_players') ? 'linked_player_id' : 'user_id') === `eq.${playerId}`) {
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? null : [])
      }
    }
    if (request.method() === 'POST') {
      if (url.pathname === '/rest/v1/telemetry_events') return json(null, 201)
      if (url.pathname === '/rest/v1/rpc/get_player_invites_for_current_user') {
        reads++
        if (failedRead && reads === 1) return json({ message: 'Synthetic offline response' }, 503)
        return json(state === 'empty' ? [] : [invitation])
      }
      if (url.pathname === '/functions/v1/send-parent-invite') {
        const body = request.postDataJSON() as unknown
        resends.push(body)
        if (JSON.stringify(body) !== JSON.stringify({ invite_id: inviteId, resend: true })) return reject()
        invitation = { ...invitation, invite_token: 'synthetic-rotated-token', expires_at: new Date(Date.now() + 86_400_000).toISOString() }
        return json({ sent: true })
      }
    }
    // Creation, provisioning and recipient/profile writes are never allowed.
    return reject()
  })
  return { unexpected, errors, resends, reads: () => reads }
}

for (const state of ['empty', 'accepted', 'pending', 'expired'] as const) {
  test(`Profile has no guardian editor with ${state} invitations`, async ({ page, context }, testInfo) => {
    const observed = await profileFixture(page, context, state)
    await page.goto('/player/profile')
    const card = page.getByRole('region', { name: 'Parent invitations' })
    await expect(card.getByText(guidance, { exact: true })).toBeVisible()
    await expect(card.getByText('Loading invitations…')).toHaveCount(0)
    await expect(card.getByRole('textbox')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
    if (state === 'empty' || state === 'accepted') await expect(card.getByRole('button')).toHaveCount(0)
    if (state !== 'empty') await expect(card.getByText(guardianEmail, { exact: true })).toBeVisible()
    if (state === 'accepted') await expect(card.getByText('Parent linked')).toBeVisible()
    if (state === 'expired') await expect(card.getByRole('button', { name: 'Share link' })).toHaveCount(0)
    await card.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`profile-${state}.png`) })
    expect(observed.resends).toEqual([])
    expect(observed.unexpected).toEqual([])
    expect(observed.errors).toEqual([])
  })
}

test('Profile retries a failed invitation lookup without offering creation', async ({ page, context }) => {
  const observed = await profileFixture(page, context, 'empty', true)
  await page.goto('/player/profile')
  const card = page.getByRole('region', { name: 'Parent invitations' })
  await expect(card.getByRole('alert')).toContainText("Couldn't load current invitations")
  await expect(card.getByRole('textbox')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: 'Retry loading' }).click()
  await expect(card.getByRole('alert')).toHaveCount(0)
  await expect(card.getByText(guidance, { exact: true })).toBeVisible()
  await expect(card.getByRole('textbox')).toHaveCount(0)
  expect(observed.reads()).toBe(2)
  expect(observed.resends).toEqual([])
  expect(observed.unexpected).toEqual([])
  expect(observed.errors).toEqual([])
})

test('Profile renews an expired invitation only for its existing recipient', async ({ page, context }) => {
  const observed = await profileFixture(page, context, 'expired')
  await page.goto('/player/profile')
  const card = page.getByRole('region', { name: 'Parent invitations' })
  await expect(card.getByRole('button', { name: 'Share link' })).toHaveCount(0)
  await card.getByRole('button', { name: 'Resend email' }).click()
  await expect(card.getByText('Email sent. Ask your parent to check their inbox and spam folder.')).toBeVisible()
  await expect(card.getByText(guardianEmail, { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Share link' }).click()
  const link = card.getByRole('textbox')
  await expect(link).toHaveValue(`${appOrigin}/parent-invite?token=synthetic-rotated-token`)
  await expect(link).toHaveAttribute('readonly', '')
  await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
  expect(observed.resends).toEqual([{ invite_id: inviteId, resend: true }])
  expect(observed.reads()).toBe(2)
  expect(observed.unexpected).toEqual([])
  expect(observed.errors).toEqual([])
})
