/**
 * TRAK-101 (J3), found in the 1 Oct TRAK-24 run: a used or expired invitation
 * link dead-ended for a guardian, and for a child opened the old public
 * "Player Registration" form (name, date of birth, nationality), the sign-up
 * path the roster model replaced (TRAK-48 refuses a non-roster player). With
 * no session, neither setup page shows a form; when Auth sends someone back
 * with a used or expired link, both say so and offer Sign in. Real App,
 * AuthProvider and SDK with MSW.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL } from '../../../tests/msw/supabase'

// What Auth appends to the redirect when a one-time link was already used or has expired.
const EXPIRED = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'

beforeEach(() => {
  localStorage.clear()
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => cleanup())

describe('a used or expired invitation link, or no session at all (TRAK-101)', () => {
  it.each(['player', 'parent'])('/onboarding/%s with no session shows no sign-up form and points to the invitation', async role => {
    renderApp(`/onboarding/${role}`)
    expect(await screen.findByText(/Open the invitation your academy emailed you/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Email')).toBeNull()
    expect(screen.queryByPlaceholderText('Full name')).toBeNull()
    expect(screen.queryByText(/Registration/)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it.each(['player', 'parent'])('a used or expired link on /onboarding/%s says so, offers Sign in and a new link', async role => {
    renderApp(`/onboarding/${role}${EXPIRED}`)
    expect(await screen.findByRole('heading', { name: 'This link has already been used or has expired' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Ask your academy for a new link.')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Email')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('CONTROL without an error in the link, a signed-out visitor is not told the link expired', async () => {
    renderApp('/onboarding/player')
    expect(await screen.findByText(/Open the invitation your academy emailed you/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByText('This link has already been used or has expired')).toBeNull()
  })
})
