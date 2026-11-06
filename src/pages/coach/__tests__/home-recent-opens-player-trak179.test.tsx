import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

/**
 * TRAK-179, live run 3 (16 Oct): on coach Home, a Recent assessments row
 * opened the assessment editor. It opens the player's profile, as Squad →
 * Open profile does; the assessment is one tap further, in their history.
 */
const COACH = { id: 'coach-179' }

afterEach(() => cleanup())

function serve() {
    server.use(
      // TRAK-355: who the coach is watching; no one.
      table('player_watches', []),
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
      table('coach_details', [{ user_id: COACH.id, team: 'U16s', coach_role: 'Head Coach' }]),
      table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', created_at: '2026-09-01T00:00:00Z' }]),
      table('coach_assessments', [{ id: 'a-1', coach_user_id: COACH.id, squad_player_id: 'sp-1', coach_rating: 7,
        created_at: '2026-10-15T10:00:00Z', appearance: 'training', squad_players: { player_name: 'Ade Okafor' } }]),
      table('coach_sessions', []),
      // TRAK-353: the player's Can also play and roles; none.
      table('squad_player_also_plays', []), table('squad_player_roles', []),
      // TRAK-354: the player's objectives; none.
      table('player_objectives', []),
      table('session_attendance', []),
      table('coach_calendar_events', []),
      rpc('feature_on', () => true),
      rpc('coach_squad_player_consent_required', () => false),
    )
}

describe('TRAK-179: a player in the overview opens the player (TRAK-211: on Feedback and assessment)', () => {
  it("goes to the player's profile, not the assessment editor", async () => {
    signInAs(COACH)
    serve()
    renderApp('/coach/feedback')
    await userEvent.click(await screen.findByRole('button', { name: /^Open Ade Okafor's profile/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/sp-1'))
  }, 20_000)

  // TRAK-200 (Imad, 18 Oct): the way back from that profile is where it was opened, not Squad. TRAK-334: it's the
  // trail's first crumb, in place of Back.
  it("the profile's trail ends at Feedback, where it was opened, and goes back there", async () => {
    signInAs(COACH)
    serve()
    renderApp('/coach/feedback')
    await userEvent.click(await screen.findByRole('button', { name: /^Open Ade Okafor's profile/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/sp-1'))
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb trail' })
    // Feedback, opened from a link and outside the nav, sits under Home.
    expect(within(trail).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Home', 'Feedback', 'Ade Okafor'])
    // TRAK-351 (Tarek, 3 Nov): the player's own page also has a Back button, beside the trail TRAK-334 gave it.
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    await userEvent.click(within(trail).getByRole('link', { name: 'Feedback' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/feedback'))
  }, 20_000)

  it('a profile opened with nothing behind it starts its trail at Squad', async () => {
    signInAs(COACH)
    serve()
    renderApp('/coach/squad/player/sp-1')
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb trail' })
    expect(within(trail).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Squad', 'Ade Okafor'])
    await userEvent.click(within(trail).getByRole('link', { name: 'Squad' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad'))
  }, 20_000)
})
