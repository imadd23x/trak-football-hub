/**
 * TRAK-11 phase 4, guardian side: a guardian the academy's roster names
 * follows the invitation send-roster-invites emailed them and arrives at
 * /onboarding/parent already signed in, with no password and no profile. They
 * set a password and give their name; provision_my_profile admits them from
 * roster_guardians and claims those rows, and parent home then lists the child
 * waiting for their approval (#183). Real App, AuthProvider and SDK with MSW.
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
  account = `invited-guardian-${++sequence}`
  provisioned = false
  passwordSet = []
  provisionCalls = []
  provisionAnswer = () => { provisioned = true; return { warnings: [] } }
  signInAs({ id: account, email: `${account}@example.test`,
    user_metadata: { invited_as: 'parent', child_first_name: 'Ana', academy_name: 'Synthetic Academy' } })
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, () => HttpResponse.json(provisioned
      ? [{ id: account, user_id: account, role: 'parent', full_name: 'Maria Synthetic', nationality: null }] : [])),
    http.put(`${SUPABASE_URL}/auth/v1/user`, async ({ request }) => {
      passwordSet.push(await request.json())
      return HttpResponse.json({ id: account, aud: 'authenticated', role: 'authenticated', email: `${account}@example.test`,
        user_metadata: { invited_as: 'parent', child_first_name: 'Ana', academy_name: 'Synthetic Academy' } })
    }),
    rpc('provision_my_profile', args => { provisionCalls.push(args); return provisionAnswer() }),
    rpc('get_children_awaiting_consent', () => []),
    rpc('get_roster_children_awaiting_consent', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => cleanup())

async function setPassword(password = 'SyntheticOnly1!', confirm = password) {
  await userEvent.type(await screen.findByLabelText('New password', {}, { timeout: 4000 }), password)
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('an invited guardian finishes signing up (TRAK-11 phase 4)', () => {
  it("is welcomed as the child's guardian from the academy, not told \"Invalid role\"", async () => {
    renderApp('/onboarding/parent')
    expect(await screen.findByRole('heading', { name: 'Welcome' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText(/Synthetic Academy has added you as Ana's parent or guardian/)).toBeInTheDocument()
    expect(screen.queryByText('Invalid role')).toBeNull()
  })

  it('sets a password, gives their name, and is admitted from the roster to parent home', async () => {
    renderApp('/onboarding/parent')
    await setPassword()
    await waitFor(() => expect(passwordSet).toEqual([expect.objectContaining({ password: 'SyntheticOnly1!' })]), { timeout: 4000 })
    const name = await screen.findByLabelText('Your name', {}, { timeout: 4000 })
    expect(name).toHaveValue('')
    // A guardian has no football details to give.
    expect(screen.queryByLabelText('Position (optional)')).toBeNull()
    await userEvent.type(name, 'Maria Synthetic')
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(provisionCalls).toEqual([{ p: { role: 'parent', full_name: 'Maria Synthetic' } }]))
    await waitFor(() => expect(window.location.pathname).toBe('/parent/home'), { timeout: 4000 })
  })

  it('says so plainly when the roster does not name them, and stays on the screen', async () => {
    provisionAnswer = () => ({ status: 403, body: { code: '42501', message: "Your academy hasn't added this email yet", details: null, hint: null } })
    renderApp('/onboarding/parent')
    await setPassword()
    const name = await screen.findByLabelText('Your name', {}, { timeout: 4000 })
    await userEvent.type(name, 'Maria Synthetic')
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Your academy hasn't added this email yet")
    expect(window.location.pathname).toBe('/onboarding/parent')
  })

  it('asks for a name before finishing, without sending anything', async () => {
    renderApp('/onboarding/parent')
    await setPassword()
    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }, { timeout: 4000 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter your name')
    expect(provisionCalls).toEqual([])
  })

  it('someone who is not signed in is pointed to their invitation, not "Invalid role"', async () => {
    localStorage.clear()
    renderApp('/onboarding/parent')
    expect(await screen.findByText(/Open the invitation your academy emailed you/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByText('Invalid role')).toBeNull()
  })

  // TRAK-109 (run 4, Family X): a guardian whose invitation expired reset their
  // password, then setup asked for a password again; the same one read as a
  // connection error, and they couldn't tell which password was theirs.
  describe('TRAK-109: a guardian who already has a password', () => {
    const authRefusal = (code: string, msg: string) => server.use(
      http.put(`${SUPABASE_URL}/auth/v1/user`, () => HttpResponse.json({ code: 422, error_code: code, msg }, { status: 422 })))
    afterEach(() => sessionStorage.clear())

    it('goes straight to their name after a password reset in this tab', async () => {
      sessionStorage.setItem('trak:password-set', account)
      renderApp('/onboarding/parent')
      await userEvent.type(await screen.findByLabelText('Your name', {}, { timeout: 4000 }), 'Maria Synthetic')
      expect(screen.queryByLabelText('New password')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
      await waitFor(() => expect(window.location.pathname).toBe('/parent/home'), { timeout: 4000 })
      expect(passwordSet).toEqual([])
    })

    it('CONTROL a reset for another account still asks this one for a password', async () => {
      sessionStorage.setItem('trak:password-set', 'someone-else')
      renderApp('/onboarding/parent')
      expect(await screen.findByLabelText('New password', {}, { timeout: 4000 })).toBeInTheDocument()
    })

    it('carries on to their name when they type the password they already have', async () => {
      authRefusal('same_password', 'New password should be different from the old password.')
      renderApp('/onboarding/parent')
      await setPassword()
      expect(await screen.findByLabelText('Your name', {}, { timeout: 4000 })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('a too-common password says so, not "check your connection"', async () => {
      authRefusal('weak_password', 'Password is known to be weak and easy to guess, please choose a different one.')
      renderApp('/onboarding/parent')
      await setPassword()
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('That password is too easy to guess (it appears in known leaks). Choose a different one.')
      expect(alert).not.toHaveTextContent(/connection/)
      expect(screen.getByLabelText('New password')).toBeInTheDocument()
    })
  })

  it('CONTROL /onboarding/unknown is still an invalid role', async () => {
    renderApp('/onboarding/unknown')
    expect(await screen.findByText('Invalid role', {}, { timeout: 4000 })).toBeInTheDocument()
  })
})
