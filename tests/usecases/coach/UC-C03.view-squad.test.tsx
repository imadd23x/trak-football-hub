import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, tableError } from '../../msw/supabase'

const COACH = { id: 'coach-1' }

function signedInCoach() {
  signInAs(COACH)
  server.use(
    table('coach_assessments', []),
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', nationality: 'GR' },
    ]),
  )
}

useCase('UC-C03', () => {
  it('lists every player in the coach squad', async () => {
    signedInCoach()
    server.use(
      table('squad_players', [
        { id: 's1', coach_user_id: COACH.id, player_name: 'Nikos Papadopoulos', position: 'Midfielder', shirt_number: 8 },
        { id: 's2', coach_user_id: COACH.id, player_name: 'Giorgos Andreou', position: 'Defender', shirt_number: 4 },
      ]),
    )

    renderApp('/coach/squad')

    expect(await screen.findByText('Nikos Papadopoulos')).toBeInTheDocument()
    expect(screen.getByText('Giorgos Andreou')).toBeInTheDocument()
  })

  it('shows an explicit empty message for a coach with no players', async () => {
    signedInCoach()
    server.use(table('squad_players', []))

    // CoachSquadPage renders the empty-squad message from its initial
    // `players = []` state, before the fetch resolves — so a plain
    // `findByText` here would pass immediately without ever observing the
    // mocked response, and would keep passing even if the fetch replaced
    // that state with real rows. Wait for the mocked response to land first
    // so this genuinely exercises the post-fetch render, same as the
    // settle-signal technique below.
    let squadResponseLanded = false
    function onResponseMocked({ request }: { request: Request }) {
      if (request.url.includes('/squad_players')) {
        squadResponseLanded = true
      }
    }
    server.events.on('response:mocked', onResponseMocked)

    try {
      renderApp('/coach/squad')

      await waitFor(() => expect(squadResponseLanded).toBe(true))

      // Academy admission replaces the old Add Player prompt. Preserve the
      // same explicit-empty-state clause with the approved J1 wording.
      expect(await screen.findByText(/your squad is being prepared/i)).toBeInTheDocument()
    } finally {
      server.events.removeListener('response:mocked', onResponseMocked)
    }
  })

  // This is the assertion the audit's "false empty state" defect fails.
  // A permission-denied read currently renders identically to an empty squad.
  it('distinguishes a failed load from an empty squad', async () => {
    signedInCoach()
    server.use(
      tableError('squad_players', 401, { code: '42501', message: 'permission denied for table squad_players' }),
    )

    // `findByText(...).catch(() => null)` is the wrong tool here: findByText
    // polls FOR PRESENCE and only settles "not found" by rejecting after its
    // full timeout, and swallowing that rejection with .catch() would also
    // hide a genuinely broken query. What this assertion needs is a signal
    // that the load has settled that is independent of the very text it is
    // checking for, so it can query for absence synchronously afterward.
    // The mocked squad_players response landing is that independent signal.
    let squadResponseLanded = false
    function onResponseMocked({ request }: { request: Request }) {
      if (request.url.includes('/squad_players')) {
        squadResponseLanded = true
      }
    }
    server.events.on('response:mocked', onResponseMocked)

    try {
      renderApp('/coach/squad')

      await waitFor(() => expect(squadResponseLanded).toBe(true))

      // A refused read must show its error, never the academy-managed empty
      // state. Keep both assertions after the actual response settles.
      expect(await screen.findByText("Couldn't load your squad")).toBeInTheDocument()
      const emptyMessage = screen.queryByText(/your squad is being prepared/i)
      expect(
        emptyMessage,
        'A failed load must not render the empty-squad message. ' +
        'See UC-C03 and UC-X02 in docs/use-cases/registry.yaml.',
      ).toBeNull()
    } finally {
      server.events.removeListener('response:mocked', onResponseMocked)
    }
  })
})
