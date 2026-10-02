/**
 * Trak Football — Smoke Tests (Item 06)
 *
 * Three smoke tests covering the happy path for each role:
 *   1. Landing page loads and shows role selection
 *   2. Player onboarding form renders correctly
 *   3. Coach onboarding form renders correctly
 *
 * These run against the live dev server (npm run dev → localhost:8080).
 * In CI: start the server first, then run `npx playwright test`.
 *
 * To run locally:
 *   npm run dev &
 *   npx playwright test e2e/smoke.spec.ts
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:8080'

test.describe('Landing page', () => {
  test('loads and shows sign-in options', async ({ page }) => {
    await page.goto(BASE)
    // The app should render without a blank white screen
    await expect(page.locator('body')).not.toBeEmpty()
    // Should contain some sign-in / role selection UI
    const text = await page.textContent('body')
    expect(text).toBeTruthy()
    expect(text!.length).toBeGreaterThan(50)
  })
})

test.describe('Player onboarding', () => {
  // TRAK-101: no public player signup. A child joins from their academy's
  // invitation; a signed-out visitor is pointed there instead of given a form.
  test('a signed-out visitor gets no signup form, only a pointer to their invitation', async ({ page }) => {
    await page.goto(`${BASE}/onboarding/player`)
    await expect(page.getByText(/Open the invitation your academy emailed you/)).toBeVisible()
    await expect(page.getByPlaceholder(/full name/i)).toHaveCount(0)
    await expect(page.getByPlaceholder(/email/i)).toHaveCount(0)
  })

  test('a used or expired invitation link says so and offers Sign in', async ({ page }) => {
    await page.goto(`${BASE}/onboarding/player#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)
    await expect(page.getByRole('heading', { name: 'This link has already been used or has expired' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
})

test.describe('Coach onboarding', () => {
  // TRAK-12: Trak sets up coach and academy accounts, so there is no form.
  test('explains that Trak sets up staff accounts', async ({ page }) => {
    await page.goto(`${BASE}/onboarding/coach`)
    await expect(page.getByText(/Trak sets up coach and academy accounts/i)).toBeVisible()
    await expect(page.getByPlaceholder(/full name/i)).toHaveCount(0)
  })
})

test.describe('Parent onboarding', () => {
  test('parent registration page loads', async ({ page }) => {
    await page.goto(`${BASE}/parent-onboarding`)
    const text = await page.textContent('body')
    expect(text).toBeTruthy()
    expect(text!.length).toBeGreaterThan(50)
  })
})
