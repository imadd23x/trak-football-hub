/**
 * TRAK-11: a roster invitee who opens trakfootball.com before finishing setup
 * is signed in (the invitation link made the session) but has no profile yet.
 * The home page must send them back to their own setup page, not to the
 * player-initiated parent invitation page, which knows nothing about the
 * roster and says "No active invitations" (30 Sep TRAK-24 phone run).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { signInAs } from '../../../tests/support/session'
import { server } from '../../../tests/msw/server'
import { rpc, SUPABASE_URL } from '../../../tests/msw/supabase'

let sequence = 0

function signInWithoutProfile(invitedAs?: string) {
  const account = `landing-invitee-${++sequence}`
  signInAs({ id: account, email: `${account}@example.test`,
    user_metadata: invitedAs ? { invited_as: invitedAs, child_first_name: 'Ana', academy_name: 'Synthetic Academy' } : {} })
}

beforeEach(() => {
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, () => HttpResponse.json([])),
    rpc('get_children_awaiting_consent', () => []),
    rpc('get_roster_children_awaiting_consent', () => []),
    rpc('my_consent_status', () => ({ required: false, granted: true, invited_parent: null })),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('get_my_pending_parent_invites', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => cleanup())

describe('the home page sends an unfinished roster invitee back to their setup (TRAK-11)', () => {
  it('an invited child goes to the player setup, not the parent invitation page', async () => {
    signInWithoutProfile('player')
    renderApp('/')
    await waitFor(() => expect(window.location.pathname).toBe('/onboarding/player'))
    expect(await screen.findByRole('heading', { name: 'Welcome, Ana' })).toBeInTheDocument()
  })

  it('an invited guardian goes to the guardian setup, not the parent invitation page', async () => {
    signInWithoutProfile('parent')
    renderApp('/')
    await waitFor(() => expect(window.location.pathname).toBe('/onboarding/parent'))
  })

  it('CONTROL: an account with no invitation role still goes to the parent invitation page', async () => {
    signInWithoutProfile()
    renderApp('/')
    await waitFor(() => expect(window.location.pathname).toBe('/parent-invite'))
  })
})
