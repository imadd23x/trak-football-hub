/**
 * TRAK-99 (J5): the squad told coach.u17 to wait for a parent who had already
 * approved; the child just hadn't signed up yet. The coach now sees which of
 * the two it is. The consent gate is unchanged and still decides "ready".
 */
import { it, expect, describe } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, SUPABASE_URL } from '../../../../tests/msw/supabase'

const COACH = { id: 'coach-1' }
type Reason = 'parent' | 'signup' | 'ready' | 'error'

function setup(players: Record<string, { name: string; required: boolean; reason?: Reason }>) {
  signInAs(COACH)
  const reasonAsked: string[] = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', nationality: 'AE' }]),
    table('squad_players', Object.entries(players).map(([id, p]) => ({ id, coach_user_id: COACH.id, player_name: p.name, position: 'Midfielder' }))),
    table('coach_sessions', [{ id: 'session-1', title: 'vs Synthetic FC', session_date: '2026-09-20' }]),
    table('coach_details', []), table('coach_assessments', []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
      const { p_squad_player_id: id } = await request.json() as { p_squad_player_id: string }
      return HttpResponse.json(players[id].required)
    }),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_wait_reason`, async ({ request }) => {
      const { p_squad_player_id: id } = await request.json() as { p_squad_player_id: string }
      reasonAsked.push(id)
      const reason = players[id].reason
      if (reason === 'error') return HttpResponse.json({ message: 'synthetic failure' }, { status: 500 })
      return HttpResponse.json(reason ?? 'parent')
    }),
  )
  return reasonAsked
}

const row = (name: string) => screen.getByText(name).closest('button') as HTMLElement

describe('Squad chips (TRAK-99)', () => {
  it('tells "waiting for parent" apart from "waiting for player to sign up"', async () => {
    const asked = setup({
      'sq-ready': { name: 'Amal Ready', required: false },
      'sq-parent': { name: 'Bilal Parent', required: true, reason: 'parent' },
      'sq-signup': { name: 'Dana Signup', required: true, reason: 'signup' },
    })
    renderApp('/coach/squad')
    await screen.findByText('Amal Ready')
    expect(await within(row('Dana Signup')).findByText('Waiting for player to sign up')).toBeInTheDocument()
    expect(within(row('Dana Signup')).queryByText('Waiting for parent')).toBeNull()
    expect(within(row('Bilal Parent')).getByText('Waiting for parent')).toBeInTheDocument()
    expect(within(row('Amal Ready')).getByText('Ready to assess')).toBeInTheDocument()
    // The reason is only asked for players the gate refuses.
    expect(asked.sort()).toEqual(['sq-parent', 'sq-signup'])
  })

  it('never guesses a reason: a failed read, or one that disagrees with the gate, is "Not ready to assess"', async () => {
    setup({
      'sq-err': { name: 'Carim Error', required: true, reason: 'error' },
      'sq-race': { name: 'Eli Race', required: true, reason: 'ready' },
    })
    renderApp('/coach/squad')
    await screen.findByText('Carim Error')
    expect(await within(row('Carim Error')).findByText('Not ready to assess')).toBeInTheDocument()
    expect(within(row('Eli Race')).getByText('Not ready to assess')).toBeInTheDocument()
    expect(screen.queryByText('Ready to assess')).toBeNull()
    expect(screen.queryByText('Waiting for parent')).toBeNull()
  })
})

describe('Assessment notice (TRAK-99)', () => {
  async function choose(id: string, name: string) {
    renderApp('/coach/assess')
    const user = userEvent.setup()
    const option = await screen.findByRole('option', { name })
    await user.selectOptions(option.closest('select') as HTMLSelectElement, id)
  }
  const saveButton = () => screen.getByRole('button', { name: /save assessment/i })
  // The consent notice: the status box that holds "You can assess …".
  const findNotice = async () => (await screen.findByText(/You can assess/)).closest('[role="status"]') as HTMLElement

  it('an approved child without an account: says so, and Save stays locked', async () => {
    setup({ 'sq-signup': { name: 'Dana Signup', required: true, reason: 'signup' } })
    await choose('sq-signup', 'Dana Signup')
    const notice = await findNotice()
    await waitFor(() => expect(notice).toHaveTextContent('Waiting for the player to sign up'))
    expect(notice).toHaveTextContent("A parent has approved. You can assess Dana Signup once they've set up their Trak account.")
    expect(notice).not.toHaveTextContent('Waiting for a parent')
    expect(saveButton()).toBeDisabled()
  })

  it('CONTROL no approval: still "Waiting for a parent"', async () => {
    setup({ 'sq-parent': { name: 'Bilal Parent', required: true, reason: 'parent' } })
    await choose('sq-parent', 'Bilal Parent')
    const notice = await findNotice()
    await waitFor(() => expect(notice).toHaveTextContent('Waiting for a parent'))
    expect(notice).toHaveTextContent('You can assess Bilal Parent once a parent has approved their account.')
    expect(saveButton()).toBeDisabled()
  })

  it('a failed reason read still locks Save and names no single cause', async () => {
    setup({ 'sq-err': { name: 'Carim Error', required: true, reason: 'error' } })
    await choose('sq-err', 'Carim Error')
    const notice = await findNotice()
    await waitFor(() => expect(notice).toHaveTextContent('Not ready to assess yet'))
    expect(notice).not.toHaveTextContent(/Waiting for (a parent|the player)/)
    expect(saveButton()).toBeDisabled()
  })
})
