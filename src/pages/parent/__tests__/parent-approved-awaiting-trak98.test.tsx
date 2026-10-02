/**
 * TRAK-98 (G6), through the real App, AuthProvider, family context and SDK with
 * MSW behind them. In the 1 Oct TRAK-24 run Guardian A approved two siblings;
 * Sibling Two never signed up, so Home showed only Sibling One plus "No child
 * linked yet / Open the parent invite", and Profile had no way to withdraw
 * Sibling Two. A guardian must see every child they approved and be able to
 * withdraw one who has no account yet (withdraw_roster_consent).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, rpc, table } from '../../../../tests/msw/supabase'

const LINKED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SAM = '98d00000-0000-0000-0000-000000000070'
const TIA = '98d00000-0000-0000-0000-000000000071'
let sequence = 0
let linked: string[]
let approved: { roster_child_id: string; first_name: string; approved_at: string }[]
let approvedFails: boolean
let withdrawals: unknown[]
let withdrawAnswer: () => Record<string, unknown> | number

beforeEach(() => {
  const account = `approved-awaiting-parent-${++sequence}`
  signInAs({ id: account })
  linked = []
  approvedFails = false
  withdrawals = []
  approved = [
    { roster_child_id: SAM, first_name: 'Sam', approved_at: '2026-10-01T12:55:44Z' },
    { roster_child_id: TIA, first_name: 'Tia', approved_at: '2026-10-01T12:56:57Z' },
  ]
  withdrawAnswer = () => {
    approved = approved.filter(child => child.roster_child_id !== (withdrawals.at(-1) as { p_roster_child_id: string }).p_roster_child_id)
    return 1
  }
  const profiles = [
    { id: 'p', user_id: account, role: 'parent', full_name: 'Guardian A' },
    { id: 'c', user_id: LINKED, role: 'player', full_name: 'Linked Synthetic' },
  ]
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(profiles.filter(row => filter.includes(row.user_id)))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/player_parent_links`, () => HttpResponse.json(linked.map(id => ({ player_user_id: id })))),
    rpc('get_my_approved_children_awaiting_signup', () => approvedFails
      ? { status: 503, body: { message: 'Synthetic unavailable', code: 'XX000', details: null, hint: null } }
      : approved),
    rpc('withdraw_roster_consent', args => { withdrawals.push(args); return withdrawAnswer() }),
    rpc('get_children_awaiting_consent', () => []),
    rpc('get_roster_children_awaiting_consent', () => []),
    rpc('get_my_child_logins', () => []),
    rpc('get_my_child_credentials', () => []),
    rpc('family_training_history', () => []),
    table('matches', []),
    table('parental_consents', []),
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => cleanup())

describe('a guardian sees and can withdraw children they approved who have not signed up (TRAK-98)', () => {
  it('Home lists both approved siblings as waiting to sign up, with no parent-invite wording', async () => {
    renderApp('/parent/home')
    const section = await screen.findByRole('region', { name: 'Approved, waiting to sign up' }, { timeout: 4000 })
    expect(within(section).getByText('Approved. Waiting for Sam to sign up.')).toBeInTheDocument()
    expect(within(section).getByText('Approved. Waiting for Tia to sign up.')).toBeInTheDocument()
    expect(screen.queryByText(/Open the parent invite/)).toBeNull()
    expect(screen.queryByText('No child linked yet')).toBeNull()
  })

  it('Home shows a signed-up child and an approved one still waiting, side by side', async () => {
    linked = [LINKED]
    approved = approved.filter(child => child.roster_child_id === TIA)
    renderApp('/parent/home')
    expect(await screen.findByText('Approved. Waiting for Tia to sign up.', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Linked Synthetic' })).toBeInTheDocument()
  })

  it('says so when the list cannot be read, instead of showing nothing', async () => {
    approvedFails = true
    renderApp('/parent/home')
    expect(await screen.findByText("Couldn't check the children you've approved.", {}, { timeout: 4000 })).toBeInTheDocument()
  })

  it('Profile withdraws an approved child who has no account, with one tap and a confirm', async () => {
    renderApp('/parent/profile')
    const section = await screen.findByRole('region', { name: 'Consent for Tia' }, { timeout: 4000 })
    await userEvent.click(within(section).getByRole('button', { name: 'Withdraw consent for Tia' }))
    expect(withdrawals).toEqual([])
    await userEvent.click(within(section).getByRole('button', { name: 'Confirm withdrawal for Tia' }))
    await waitFor(() => expect(withdrawals).toEqual([{ p_roster_child_id: TIA }]))
    expect(await screen.findByText('Your consent for Tia has been withdrawn.')).toBeInTheDocument()
    // Sam's approval is untouched.
    expect(screen.getByRole('region', { name: 'Consent for Sam' })).toBeInTheDocument()
  })

  it('never reports a withdrawal it could not confirm', async () => {
    withdrawAnswer = () => ({ status: 503, body: { message: 'Synthetic unavailable', code: 'XX000', details: null, hint: null } })
    renderApp('/parent/profile')
    const section = await screen.findByRole('region', { name: 'Consent for Sam' }, { timeout: 4000 })
    await userEvent.click(within(section).getByRole('button', { name: 'Withdraw consent for Sam' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Confirm withdrawal for Sam' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent("Couldn't confirm whether your consent was withdrawn")
    expect(screen.queryByText('Your consent for Sam has been withdrawn.')).toBeNull()
  })

  it('CONTROL no approved children waiting: no section, and still no parent-invite wording', async () => {
    approved = []
    renderApp('/parent/home')
    expect(await screen.findByText('No child has signed up yet', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Approved, waiting to sign up' })).toBeNull()
    expect(screen.queryByText(/Open the parent invite/)).toBeNull()
  })
})
