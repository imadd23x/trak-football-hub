/**
 * J5 (MVP Requirements): "The coach's squad marks each player 'Ready to assess'
 * or 'Waiting for parent'." A failed check must never read as ready.
 */
import { it, expect, describe } from 'vitest'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, SUPABASE_URL } from '../../../../tests/msw/supabase'

const COACH = { id: 'coach-1' }

function setup(consent: Record<string, boolean | 'error'>) {
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', nationality: 'AE' }]),
    table('squad_players', [
      { id: 'sq-ready', coach_user_id: COACH.id, player_name: 'Amal Ready', position: 'Midfielder' },
      { id: 'sq-wait', coach_user_id: COACH.id, player_name: 'Bilal Waiting', position: 'Defender' },
      { id: 'sq-err', coach_user_id: COACH.id, player_name: 'Carim Unknown', position: 'Attacker' },
    ]),
    table('coach_assessments', []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
      const { p_squad_player_id: id } = await request.json() as { p_squad_player_id: string }
      const answer = consent[id]
      if (answer === 'error') return HttpResponse.json({ message: 'synthetic failure' }, { status: 500 })
      return HttpResponse.json(answer)
    }),
  )
}

const row = (name: string) => screen.getByText(name).closest('button') as HTMLElement

describe('squad consent status (J5)', () => {
  it('marks each player ready, waiting for a parent, or unknown when the check fails', async () => {
    setup({ 'sq-ready': false, 'sq-wait': true, 'sq-err': 'error' })
    renderApp('/coach/squad')
    await screen.findByText('Amal Ready')
    expect(await within(row('Amal Ready')).findByText('Ready to assess')).toBeInTheDocument()
    expect(within(row('Bilal Waiting')).getByText('Waiting for parent')).toBeInTheDocument()
    // A failed check is not a pass.
    expect(within(row('Carim Unknown')).getByText('Status unknown')).toBeInTheDocument()
    expect(within(row('Carim Unknown')).queryByText('Ready to assess')).toBeNull()
  })
})
