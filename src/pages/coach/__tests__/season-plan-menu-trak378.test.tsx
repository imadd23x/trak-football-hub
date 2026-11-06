/**
 * TRAK-378 (Imad, 5 Nov; after TRAK-376): on a phone the squad picker lives in the side menu, so Season plan has the
 * avatar that opens it, as every page that follows the squad pick does. Picking a squad there changes the plan shown.
 * On a laptop the sidebar holds the picker and the page has no avatar. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'
import { pickSquad } from '../../../../tests/support/squad-switcher'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

let n = 0
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(laptop ? 1440 : 390)
}

beforeEach(() => {
  const COACH = { id: `coach-378-${++n}` }
  localStorage.clear()
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Synthetic Player One', age_group: 'U14', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Synthetic Player Two', age_group: 'U16', status: 'active' },
    ]),
    rpc('feature_on', () => true),
    rpc('coach_squad_player_consent_required', () => false),
    table('season_plans', []),
    table('season_objectives', []),
    table('coach_calendar_events', []),
    table('coach_sessions', []),
  )
})
afterEach(() => { cleanup(); window.matchMedia = realMatchMedia; vi.restoreAllMocks(); localStorage.clear() })

describe('TRAK-378 Season plan on a phone', () => {
  it('has the avatar that opens the side menu, and a squad picked there changes the plan', async () => {
    screenIs(false)
    renderApp('/coach/season-plan')
    expect(await screen.findByText('Pick one squad in the menu to plan its season.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(await screen.findByRole('dialog', { name: 'Menu' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    // The menu slides away first, its switcher still on screen. A pick made in it then can lose the menu mid-check
    // (#527's gate, twice), so the helper starts once it has gone.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull(), { timeout: 5000 })
    // The shared helper opens the menu from the avatar, picks, and closes it again.
    await pickSquad('U16')
    expect(await screen.findByText('U16 · Not started')).toBeInTheDocument()
  }, 30_000)

  it('on a laptop the sidebar holds the picker and the page has no avatar', async () => {
    screenIs(true)
    renderApp('/coach/season-plan')
    expect(await screen.findByRole('heading', { name: 'Season plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull()
  })
})
