/**
 * TRAK-11 (J2), follow-up to #196: someone who already has an account and
 * follows a sign-in link to /onboarding/{role} goes home instead of a sign-up
 * screen. A guardian first claims any roster rows added for them since they
 * signed up (a sibling loaded later), so parent home lists that child for
 * approval. Real App, AuthProvider and SDK with MSW.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { signInAs } from '../../../tests/support/session'
import { server } from '../../../tests/msw/server'
import { rpc, SUPABASE_URL } from '../../../tests/msw/supabase'

let sequence = 0
let claims: number
let claimFails: boolean

function signedInAs(role: 'parent' | 'player') {
  const account = `existing-${role}-${++sequence}`
  signInAs({ id: account, email: `${account}@example.test` })
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, () =>
      HttpResponse.json([{ id: account, user_id: account, role, full_name: 'Existing Synthetic', nationality: null }])),
  )
}

beforeEach(() => {
  claims = 0
  claimFails = false
  server.use(
    rpc('claim_my_roster_guardian_rows', () => {
      claims++
      return claimFails ? { status: 500, body: { code: 'XX000', message: 'synthetic failure' } } : 1
    }),
    rpc('get_children_awaiting_consent', () => []),
    rpc('get_roster_children_awaiting_consent', () => []),
    rpc('my_consent_status', () => ({ required: false, granted: true, invited_parent: null })),
    rpc('family_training_history', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => cleanup())

describe('an existing account following a sign-in link to onboarding', () => {
  it('a guardian claims rows added since they signed up, once, then lands on parent home', async () => {
    signedInAs('parent')
    renderApp('/onboarding/parent')
    await waitFor(() => expect(window.location.pathname).toBe('/parent/home'), { timeout: 4000 })
    expect(claims).toBe(1)
    expect(screen.queryByText(/Open the invitation your academy emailed you/)).toBeNull()
  })

  it('a failed claim says so and can be retried, rather than landing on a home that misses the child', async () => {
    signedInAs('parent')
    claimFails = true
    renderApp('/onboarding/parent')
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent("Couldn't add your new child")
    expect(window.location.pathname).toBe('/onboarding/parent')
    claimFails = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(window.location.pathname).toBe('/parent/home'), { timeout: 4000 })
    expect(claims).toBe(2)
  })

  it('a player who already has an account goes to player home, and claims nothing', async () => {
    signedInAs('player')
    renderApp('/onboarding/player')
    await waitFor(() => expect(window.location.pathname).toBe('/player/home'), { timeout: 4000 })
    expect(screen.queryByPlaceholderText('Email')).toBeNull()
    expect(claims).toBe(0)
  })
})
