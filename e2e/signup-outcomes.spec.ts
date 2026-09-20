import { test, expect } from '@playwright/test'

for (const role of ['player', 'coach', 'club']) {
  test(`${role} duplicate signup offers truthful recovery without signing in or provisioning`, async ({ page, context }, testInfo) => {
    const calls: string[] = [], unexpected: string[] = [], errors: string[] = []
    const email = 'existing@example.test'
    let resendCount = 0
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === 'http://127.0.0.1:4189') return route.continue()
      if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort()
      const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.hostname.endsWith('.supabase.co')) {
        calls.push(url.pathname)
        if (url.pathname === '/auth/v1/signup') {
          expect(request.postDataJSON()).toMatchObject({ email, data: { trak_onboarding: { role } } })
          return json({ id: '00000000-0000-4000-8000-000000000001', email, aud: 'authenticated', identities: [], app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' })
        }
        if (url.pathname === '/auth/v1/recover') {
          expect(request.postDataJSON()).toMatchObject({ email })
          expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:4189/reset-password')
          return json({})
        }
        if (url.pathname === '/auth/v1/resend') {
          expect(request.postDataJSON()).toMatchObject({ type: 'signup', email })
          return ++resendCount === 1 ? json({ msg: 'Please wait and try again' }, 429) : json({})
        }
      }
      unexpected.push(request.url()); return route.abort()
    })
    await page.goto(`/onboarding/${role}`)
    await page.getByPlaceholder('Full name', { exact: true }).fill('Synthetic Tester')
    await page.getByPlaceholder('Email', { exact: true }).fill(email)
    await page.locator('input[type=password]').nth(0).fill('SyntheticOnly1!')
    await page.getByPlaceholder('Confirm password', { exact: true }).fill('SyntheticOnly1!')
    const choose = async (placeholder: string, value: string) => {
      await page.locator('select').filter({ has: page.locator('option', { hasText: new RegExp(`^${placeholder}$`) }) }).selectOption(value)
    }
    if (role === 'club') {
      await page.getByPlaceholder('Academy / club name').fill('Synthetic Academy')
      await page.getByRole('button', { name: 'Create Administrator Account' }).click()
    } else {
      await choose('Select nationality', 'United Arab Emirates')
      if (role === 'player') {
        await choose('Day', '1'); await choose('Month', 'January'); await choose('Year', String(new Date().getFullYear() - 12))
      }
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByPlaceholder('Current club', { exact: true }).fill('Synthetic Academy')
      await choose('Select age group', 'U13')
      if (role === 'player') {
        await choose('Select position', 'Goalkeeper')
        await page.getByRole('button', { name: 'Next', exact: true }).click()
        await page.getByPlaceholder("Parent or guardian's email").fill('parent@example.test')
      } else await choose('Select role', 'Head Coach')
      await page.getByRole('button', { name: 'Create Account', exact: true }).click()
    }
    await expect(page.getByRole('heading', { name: 'Check your email or sign in' })).toBeVisible()
    await expect(page.getByText(/Your account is created|We've asked your parent|We sent a confirmation link/)).toHaveCount(0)
    expect(calls).toEqual(['/auth/v1/signup'])
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('auth-token')))).toEqual([])
    if (role === 'player') await expect(page.getByText(/review the invitation status for/)).toContainText('parent@example.test')
    await page.getByRole('button', { name: 'Resend confirmation email' }).click()
    await expect(page.getByRole('alert')).toContainText('Please wait and try again')
    await page.getByRole('button', { name: 'Resend confirmation email' }).click()
    await expect(page.getByRole('status')).toContainText('If this account needs confirmation')
    await page.getByRole('button', { name: 'Reset password' }).click()
    await expect(page.getByRole('status')).toContainText('If this email has a Trak account')
    await page.screenshot({ path: testInfo.outputPath(`${role}-signup-outcome.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL('http://127.0.0.1:4189/')
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    expect(calls).toEqual(['/auth/v1/signup', '/auth/v1/resend', '/auth/v1/resend', '/auth/v1/recover'])
    expect(unexpected).toEqual([]); expect(errors).toEqual([])
  })
}
