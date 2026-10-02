import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto } from '../../msw/supabase'

const COACH = { id: 'coach-1' }

function signedInCoach(squad: Record<string, unknown>[] = []) {
  signInAs(COACH)
  server.use(
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', nationality: 'GR' },
    ]),
    table('squad_players', squad),
    table('coach_assessments', []),
  )
}

/*
 * UC-C02 v2 (J1): the academy roster decides the squad. Trak loads it by hand
 * (concierge), so a coach has no add-player path. v1 asserted the opposite —
 * that a coach could add a player — and was rewritten, not weakened, when the
 * founders adopted academy admission on 23 Sep (Q-2026-09-23-01, TRAK-19).
 *
 * Pending until TRAK-47 removes /coach/squad/add and its entry points. The
 * third `then` (backend refusal) is tier 2 and belongs to TRAK-48's SQL suite.
 */
useCase('UC-C02', () => {
  it('offers no way to add a player from the squad screen', async () => {
    signedInCoach([
      { id: 'squad-1', coach_user_id: COACH.id, player_name: 'Nikos Papadopoulos', position: null, shirt_number: null },
    ])

    renderApp('/coach/squad')
    const heading = await screen.findByRole('heading', { name: 'Squad' })
    await screen.findByText('Nikos Papadopoulos')

    // Today the top bar holds an unlabelled "+" that opens /coach/squad/add.
    expect(heading.parentElement?.querySelectorAll('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /add player/i })).toBeNull()
  })

  it('offers no add-player call to action on an empty squad', async () => {
    signedInCoach([])

    renderApp('/coach/squad')
    await screen.findByRole('heading', { name: 'Squad' })

    await waitFor(() => expect(screen.queryByText(/add your first player/i)).toBeNull())
    expect(screen.queryByRole('button', { name: /add player/i })).toBeNull()
  })

  it('shows no add-player form at /coach/squad/add and sends the coach to their squad', async () => {
    signedInCoach([])
    const inserted: unknown[] = []
    server.use(insertInto('squad_players', body => { inserted.push(body); return { id: 'x', ...body } }))

    renderApp('/coach/squad/add')

    expect(await screen.findByRole('heading', { name: 'Squad' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad'))
    expect(screen.queryByRole('button', { name: /save & finish/i })).toBeNull()
    expect(inserted).toHaveLength(0)
  })
})
