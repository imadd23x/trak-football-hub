import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { rpc, table } from '../../../../tests/msw/supabase'

/**
 * TRAK-418 (11 Nov review; Kostas, 12 Nov: option A). Settings › How Trak works opened a page written for players,
 * and an out-of-date coach manual sat behind the old Profile. A coach now has a page of their own, true to what Trak
 * does today; players and parents keep theirs. A part for Matches, Training or the season plan shows only where the
 * academy has it on.
 */
function coach(id: string, on: (feature: string) => boolean) {
  signInAs({ id })
  server.use(
    table('profiles', [{ id: 'p', user_id: id, role: 'coach', full_name: 'Coach Synthetic', invite_code: null }]),
    table('coach_details', [{ user_id: id, coach_role: 'Head Coach', team: 'U15s', current_club: null, organization_id: null }]),
    table('organizations', []), table('notification_settings', []), table('squad_players', []), table('coach_sessions', []),
    rpc('feature_on', ({ p_feature }) => on(String(p_feature))),
  )
}

afterEach(cleanup)

describe("TRAK-418: a coach's own How Trak works", () => {
  it('Settings opens it, and it is written for a coach, not a player', async () => {
    coach('coach-418-a', () => true)
    renderApp('/settings')
    await userEvent.click(await screen.findByRole('link', { name: 'Read how Trak works' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/how-trak-works'))
    expect(await screen.findByRole('heading', { level: 1, name: 'How Trak works' })).toBeInTheDocument()
    // Kostas, 12 Nov: in the order a coach meets Trak, then the four core jobs. The switches answer after the page opens.
    // The stage's number is a badge read as part of the order, not the name.
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['1Before the season', '2Every week', 'Good to know'])
    for (const stage of ['Before the season', 'Every week']) expect(screen.getByRole('heading', { level: 2, name: stage })).toBeInTheDocument()
    for (const job of ['Scheduling', 'Assessing', 'Planning training', 'Preparing for matches'])
      expect(await screen.findByRole('heading', { level: 3, name: job })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Scheduling', 'Assessing', 'Planning training', 'Preparing for matches'])
    expect(screen.getByText(/^Season plan: set the squad's objectives/)).toBeInTheDocument()
    // The players' page talked about a rating engine and self-rating; none of that here.
    expect(screen.queryByText(/self-rat|Performance Band|6\.5/i)).toBeNull()
  }, 20_000)

  it('shows Scheduling, Training, Matches and the season plan only where the academy has them on', async () => {
    coach('coach-418-b', () => false)
    renderApp('/coach/how-trak-works')
    expect(await screen.findByRole('heading', { level: 2, name: 'Every week' })).toBeInTheDocument()
    // The switches answer after the page opens; give them the time to.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Assessing'])
    expect(screen.queryByText(/^Season plan:/)).toBeNull()
    expect(screen.queryByText(/evaluation is due/)).toBeNull()
  }, 20_000)

  it("the players' page sends a coach to their own", async () => {
    coach('coach-418-c', () => true)
    renderApp('/how-it-works')
    await waitFor(() => expect(window.location.pathname).toBe('/coach/how-trak-works'))
  }, 20_000)
})
