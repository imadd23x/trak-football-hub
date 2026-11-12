/**
 * TRAK-441 slice 1 (Imad, 12 Nov): on a laptop a player and a parent get the coach's side menu, behind the academy's
 * family_look switch so real families keep today's screens until every slice has landed. A phone keeps the glass tab
 * bar, and an academy with the switch off keeps the bar on a laptop too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

const PLAYER = { id: 'family-frame-player' }
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(laptop ? 1440 : 390)
}
let switchOn = true

beforeEach(() => {
  switchOn = true
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Giourkas Seitaridis' }]),
    table('squad_players', []),
    table('matches', []),
    rpcRows('child_events', []),
    rpc('family_training_history', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('family_feature_on', ({ p_feature }) => switchOn && p_feature === 'family_look'),
  )
})
afterEach(() => { cleanup(); window.matchMedia = realMatchMedia; vi.restoreAllMocks(); delete document.documentElement.dataset.layout })

describe('TRAK-441: the family frame', () => {
  it("on a laptop, with the switch on: the coach's side menu, Profile at its foot, no glass bar", async () => {
    screenIs(true)
    renderApp('/player/matches')
    const menu = await screen.findByRole('navigation', { name: 'Trak' }, { timeout: 5000 })
    for (const row of ['Home', 'Matches', 'Trainings', 'Profile']) {
      expect(within(menu).getByRole('button', { name: new RegExp(`^${row}`) })).toBeInTheDocument()
    }
    expect(within(menu).getByRole('button', { name: /^Matches/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('tablist', { name: 'Player' })).toBeNull()
    // The coach's page widths (src/index.css), as the mockup draws them.
    expect(document.documentElement.dataset.layout).toBe('coach')
    await userEvent.click(within(menu).getByRole('button', { name: /^Profile/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/player/profile'))
  })

  it('a page under a tab keeps that tab marked', async () => {
    screenIs(true)
    renderApp('/player/match/m-1')
    const menu = await screen.findByRole('navigation', { name: 'Trak' }, { timeout: 5000 })
    expect(within(menu).getByRole('button', { name: /^Matches/ })).toHaveAttribute('aria-current', 'page')
  })

  it('on a laptop with the switch off, and on a phone: the glass tab bar, no side menu', async () => {
    // Another player, so the switch is read afresh (its answer is kept between tests).
    const OFF = { id: 'family-frame-player-off' }
    switchOn = false
    signInAs(OFF)
    server.use(table('profiles', [{ id: 'p', user_id: OFF.id, role: 'player', full_name: 'Angelos Charisteas' }]))
    screenIs(true)
    renderApp('/player/matches')
    expect(await screen.findByRole('tablist', { name: 'Player' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Trak' })).toBeNull()
    expect(document.documentElement.dataset.layout).toBeUndefined()
    cleanup()
    switchOn = true
    screenIs(false)
    renderApp('/player/matches')
    expect(await screen.findByRole('tablist', { name: 'Player' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Trak' })).toBeNull()
  }, 15_000)
})
