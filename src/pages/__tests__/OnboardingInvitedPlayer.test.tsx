/**
 * TRAK-11 phase 4, player side: a rostered child follows the invitation link
 * the academy's roster sent (send-roster-invites) and arrives at
 * /onboarding/player already signed in, with no password and no profile. They
 * set a password, confirm their name, and provision_my_profile admits them from
 * the roster, which supplies their date of birth, academy and age group. Real
 * App, AuthProvider and SDK, with MSW behind them.
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
let account: string
let provisioned: boolean
let passwordSet: unknown[]
let provisionCalls: unknown[]
let provisionAnswer: () => Record<string, unknown>

beforeEach(() => {
  account = `invited-child-${++sequence}`
  provisioned = false
  passwordSet = []
  provisionCalls = []
  provisionAnswer = () => { provisioned = true; return { ok: true } }
  signInAs({ id: account, email: `${account}@example.test`,
    user_metadata: { invited_as: 'player', child_first_name: 'Ana', academy_name: 'Synthetic Academy' } })
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, () => HttpResponse.json(provisioned
      ? [{ id: account, user_id: account, role: 'player', full_name: 'Ana Synthetic', nationality: null }] : [])),
    http.put(`${SUPABASE_URL}/auth/v1/user`, async ({ request }) => {
      passwordSet.push(await request.json())
      return HttpResponse.json({ id: account, aud: 'authenticated', role: 'authenticated', email: `${account}@example.test`,
        user_metadata: { invited_as: 'player', child_first_name: 'Ana', academy_name: 'Synthetic Academy' } })
    }),
    rpc('provision_my_profile', args => { provisionCalls.push(args); return provisionAnswer() }),
    rpc('my_consent_status', () => ({ required: false, granted: true, invited_parent: null })),
    rpc('get_player_invites_for_current_user', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => cleanup())

async function setPassword(password = 'SyntheticOnly1!', confirm = password) {
  await userEvent.type(await screen.findByLabelText('New password'), password)
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('an invited child finishes signing up (TRAK-11 phase 4)', () => {
  it('is welcomed by first name and academy, and is not shown the email signup form', async () => {
    renderApp('/onboarding/player')
    expect(await screen.findByRole('heading', { name: 'Welcome, Ana' })).toBeInTheDocument()
    expect(screen.getByText(/Synthetic Academy has added you to Trak/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Email')).toBeNull()
    expect(screen.queryByPlaceholderText('Full name')).toBeNull()
  })

  it('sets a password, confirms their name, and is admitted from the roster', async () => {
    renderApp('/onboarding/player')
    await setPassword()
    // The password goes through the SDK's auth client, which queues its own
    // session work; allow it a few seconds on a busy runner.
    await waitFor(() => expect(passwordSet).toEqual([expect.objectContaining({ password: 'SyntheticOnly1!' })]), { timeout: 4000 })

    const name = await screen.findByLabelText('Your name', {}, { timeout: 4000 })
    expect(name).toHaveValue('Ana')
    await userEvent.clear(name)
    await userEvent.type(name, 'Ana Synthetic')
    await userEvent.selectOptions(screen.getByLabelText('Position (optional)'), 'Midfielder')
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))

    await waitFor(() => expect(provisionCalls).toHaveLength(1))
    // The roster supplies date of birth, academy and age group; the child
    // names no guardian (G2).
    expect(provisionCalls[0]).toEqual({ p: { role: 'player', full_name: 'Ana Synthetic', player_details: { position: 'Midfielder' } } })
    await waitFor(() => expect(window.location.pathname).toBe('/player/home'), { timeout: 4000 })
  })

  it('refuses a password that is too weak or does not match, without sending it', async () => {
    renderApp('/onboarding/player')
    await setPassword('short')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.clear(screen.getByLabelText('Confirm password'))
    await setPassword('SyntheticOnly1!', 'SyntheticOnly2!')
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(passwordSet).toEqual([])
  })

  it.each([
    ['not on the roster', "Your academy hasn't added this email yet"],
    ['no consent yet', 'Your parent or guardian needs to approve first'],
  ])('says so plainly when the academy refuses (%s) and stays on the screen', async (_, message) => {
    provisionAnswer = () => ({ status: 403, body: { code: '42501', message, details: null, hint: null } })
    renderApp('/onboarding/player')
    await setPassword()
    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }, { timeout: 4000 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(window.location.pathname).toBe('/onboarding/player')
  })

  it('CONTROL someone who is not signed in still gets the signup form', async () => {
    localStorage.clear()
    renderApp('/onboarding/player')
    expect(await screen.findByPlaceholderText('Email')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Welcome/ })).toBeNull()
  })
})
