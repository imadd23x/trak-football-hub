import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, rpc } from '../../msw/supabase'

const ATHLETE = { id: 'athlete-1' }

/**
 * Scope note. This use case's first two clauses — "the squad row is linked to
 * their account" and "the coach and athlete are genuinely connected in the
 * database" — are assertions about what link_player_to_coach does server-side,
 * and cannot honestly be proven against a mocked PostgREST. Mocking the RPC to
 * return success and calling that "genuinely connected" would assert the thing
 * it is meant to check.
 *
 * What is provable here, and is covered below: the screen exists at all, it
 * sends the code the athlete typed, and it tells them the truth about the
 * outcome. The database half belongs to the U2 run against the live project.
 */
function signedInAthleteWithNoCoach() {
  signInAs(ATHLETE)
  server.use(
    table('profiles', [
      { id: 'p-athlete', user_id: ATHLETE.id, role: 'player', full_name: 'Nikos Papadopoulos', nationality: 'GR' },
    ]),
    table('player_details', []),
    table('matches', []),
    // No squad row: this athlete is not linked to a coach yet.
    table('squad_players', []),
    table('coach_assessments', []),
  )
}

async function codeField() {
  return await screen.findByPlaceholderText(/TRK-/i)
}

useCase('UC-A08', () => {
  it('offers a way to submit a code after signup, not only during it', async () => {
    signedInAthleteWithNoCoach()

    renderApp('/player/profile')

    // The defect this guards: the code field existed only at onboarding step 3,
    // so an athlete who tapped past it could never link.
    expect(await codeField()).toBeInTheDocument()
  })

  it('sends the code the athlete typed', async () => {
    signedInAthleteWithNoCoach()
    let sent: Record<string, unknown> | null = null
    server.use(rpc('link_player_to_coach', (args) => { sent = args; return 'squad-row-1' }))

    renderApp('/player/profile')
    await userEvent.type(await codeField(), 'TRK-AB2K')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent!.p_code).toBe('TRK-AB2K')
  })

  it('rejects an invalid code with a reason, not a generic failure', async () => {
    signedInAthleteWithNoCoach()
    server.use(
      rpc('link_player_to_coach', () => ({
        status: 400,
        // Exactly what the migration raises: RAISE EXCEPTION 'Invalid coach code'
        body: { code: 'P0001', message: 'Invalid coach code' },
      })),
    )

    renderApp('/player/profile')
    await userEvent.type(await codeField(), 'TRK-ZZZZ')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))

    // "rejected with a reason" — the athlete is told the code is wrong.
    expect(await screen.findByText(/wasn't recognised|not recognised/i)).toBeInTheDocument()
  })

  it('does not blame the athlete for a failure that is not their code', async () => {
    signedInAthleteWithNoCoach()
    server.use(
      rpc('link_player_to_coach', () => ({ status: 500, body: { message: 'upstream unavailable' } })),
    )

    renderApp('/player/profile')
    await userEvent.type(await codeField(), 'TRK-AB2K')
    await userEvent.click(screen.getByRole('button', { name: /connect/i }))

    // A server fault must not be reported to a teenager as a typo.
    expect(await screen.findByText(/couldn't connect right now|check your signal/i)).toBeInTheDocument()
    expect(screen.queryByText(/wasn't recognised|not recognised/i)).toBeNull()
  })
})
