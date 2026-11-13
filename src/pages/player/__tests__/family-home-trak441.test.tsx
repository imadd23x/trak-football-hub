/**
 * TRAK-441 slice 2 (Imad, 12–13 Nov), behind the academy's family_look switch: the player's Home in the coach's look.
 * A phone: avatar, name, calendar and bell on top, then the week, For you (one card per new thing from the coach, each
 * opening the match page at it) and the season. A laptop: no header; the bell sits in the side menu's top bar. With
 * the switch off, today's Home. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { rpc, rpcRows, table } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

let n = 0
let PLAYER = { id: 'family-home-player' }
let switchOn = true
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(laptop ? 1440 : 390)
}
const soon = new Date(Date.now() + 2 * 86_400_000)
const MATCH = { id: 'parkview', event_type: 'match', title: 'League', opponent: 'Parkview Athletic U16', home_away: 'home',
  event_date: soon.toISOString().slice(0, 10), start_time: '11:00:00', status: 'scheduled', sequence: 1 }

beforeEach(() => {
  localStorage.clear()
  switchOn = true
  PLAYER = { id: `family-home-player-${++n}` }
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ user_id: PLAYER.id, role: 'player', full_name: 'Giourkas Seitaridis' }]),
    table('player_details', [{ position: 'Defender', current_club: 'Rehearsal FC', age_group: 'U16' }]),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]), table('coach_assessments', []),
    table('coach_shared_feedback', []),
    table('game_for_family', [{ event_id: 'parkview', shared_at: new Date(Date.now() - 3_600_000).toISOString(), changed_at: null, role: 'starter', coach_name: 'Otto Rehhagel' }]),
    table('game_for_player', []), table('game_review_for_family', []), table('matches', [{ id: 'm1' }, { id: 'm2' }]),
    rpcRows('child_events', [MATCH]), rpcRows('season_plan_for_player', []), rpcRows('family_academy', [{ name: 'Rehearsal FC', logo_url: null }]), rpcRows('child_training_attendance', [{ attended: 5, total: 6 }]),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('family_feature_on', ({ p_feature }) => switchOn && p_feature === 'family_look'),
  )
})
afterEach(() => { cleanup(); window.matchMedia = realMatchMedia; vi.restoreAllMocks(); delete document.documentElement.dataset.layout })

describe('TRAK-441: the player Home in the coach\'s look', () => {
  it('a phone: For you has a card for the shared plan, and it opens the match page at the plan', async () => {
    screenIs(false)
    renderApp('/player/home')
    const forYou = await screen.findByRole('region', { name: /^For you/ }, { timeout: 5000 })
    expect(within(forYou).getByText('vs Parkview Athletic U16')).toBeInTheDocument()
    expect(within(forYou).getByText('Your game plan is in')).toBeInTheDocument()
    // The coach's Home top: the bell is on the page; the details line is not said a second time.
    expect(screen.getByRole('button', { name: /^Alerts/ })).toBeInTheDocument()
    expect(screen.queryByText('Rehearsal FC · U16')).toBeNull()
    // Slice 2.5b: Season so far, counts only.
    const soFar = await screen.findByRole('region', { name: 'Season so far' })
    expect(within(soFar).getByText('Matches').nextElementSibling).toHaveTextContent('2')
    expect(within(soFar).getByText('Training').nextElementSibling).toHaveTextContent('5/6')
    await userEvent.click(within(forYou).getByRole('button', { name: 'Open game plan' }))
    await waitFor(() => expect(window.location.pathname + window.location.hash).toBe('/player/event/parkview#game-plan'))
  })

  it('with the switch off: today\'s Home, no For you', async () => {
    switchOn = false
    screenIs(false)
    renderApp('/player/home')
    expect(await screen.findByText('Rehearsal FC · U16', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^For you/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Season so far' })).toBeNull()
  })

  it('slice 2.5: the latest evaluation as the coach\'s bars, marked New; its note stays on its own page', async () => {
    server.use(
      table('coach_assessments', [{ id: 'eval-1', coach_user_id: 'coach-1', created_at: '2026-11-08T10:00:00Z', coach_rating: 7.5,
        work_rate: 8, tactical: 7, attitude: 8, technical: 7, physical: 6, coachability: 9, evaluation_id: null }]),
      table('coach_shared_feedback', [{ body: 'Keep pressing high.', published_at: '2026-11-08T10:00:00Z' }]),
    )
    screenIs(false)
    renderApp('/player/home')
    const card = await screen.findByRole('region', { name: 'Latest evaluation' }, { timeout: 5000 })
    expect(within(card).getByText('New')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Open evaluation/ })).toHaveAttribute('href', '/player/feedback/eval-1')
    expect(screen.queryByText('Keep pressing high.')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Latest coach assessment' })).toBeNull()
  })

  // Slice 2.6b (Imad, 13 Nov): a player who reports for themselves gets the parent's red Can't make it; one under the
  // academy's consent age still can't report, so has none.
  for (const [who, age, shown] of [['at the consent age', 16, 1], ['under it', 13, 0]] as const) {
    it(`the week's red Can't make it, for a player ${who}`, async () => {
      server.use(
        rpcRows('child_events', [{ ...MATCH, id: 'today', event_date: new Date().toLocaleDateString('en-CA'), start_time: '23:30:00' }]),
        rpc('my_consent_status', () => ({ required: false, age, consent_age: 15, threshold: 18, own_choice: age >= 15 })),
        table('event_absences', []),
      )
      screenIs(false)
      renderApp('/player/home')
      await screen.findByRole('button', { name: 'Details' }, { timeout: 5000 })
      expect(screen.queryAllByRole('button', { name: "Can't make it" })).toHaveLength(shown)
    })
  }

  it('a laptop: the bell is in the top bar, beside the side menu, and the page has no header of its own', async () => {
    screenIs(true)
    renderApp('/player/home')
    await screen.findByRole('navigation', { name: 'Trak' }, { timeout: 5000 })
    const bell = await screen.findByRole('button', { name: /^Alerts/ })
    // The page's own header (with its calendar link) is gone; the bell sits in the frame, outside the page's main.
    expect(screen.queryByRole('link', { name: /calendar/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Alerts/ })).toHaveLength(1)
    expect(bell.closest('main')).toBeNull()
    expect(await screen.findByRole('region', { name: /^For you/ })).toBeInTheDocument()
  }, 15_000)
})
