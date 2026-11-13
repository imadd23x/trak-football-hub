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
import { http, HttpResponse } from 'msw'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'
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
    // TRAK-441 slice 2: the child's academy, as family_academy gives it.
    rpcRows('family_academy', [{ name: 'Rehearsal FC', logo_url: null }]),
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
    // The academy's name where the coach's frame has his club's (slice 2).
    expect(await screen.findByText('Rehearsal FC')).toBeInTheDocument()
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

  it("a parent picks the child in the side menu, where the coach picks the squad (slice 2)", async () => {
    const GUARDIAN = { id: 'family-frame-guardian' }, SOKRATIS = 'child-sokratis', KOSTAS = 'child-kostas'
    signInAs(GUARDIAN)
    const asked: string[] = []
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
        if ((new URL(request.url).searchParams.get('user_id') ?? '').includes(GUARDIAN.id))
          return HttpResponse.json({ id: 'g', user_id: GUARDIAN.id, role: 'parent', full_name: 'Eleni Seitaridi' })
        return HttpResponse.json([{ user_id: SOKRATIS, full_name: 'Sokratis Papastathopoulos' }, { user_id: KOSTAS, full_name: 'Kostas Manolas' }])
      }),
      table('player_parent_links', [{ player_user_id: SOKRATIS }, { player_user_id: KOSTAS }]),
      table('player_details', []), table('coach_assessments', []), table('recognition_awards', []), table('parental_consents', []),
      table('game_for_family', []), table('game_review_for_family', []),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/child_events`, async ({ request }) => {
        asked.push(String(((await request.json()) as { p_child?: string }).p_child)); return HttpResponse.json([])
      }),
    )
    screenIs(true)
    renderApp('/parent/matches')
    const menu = await screen.findByRole('navigation', { name: 'Trak' }, { timeout: 5000 })
    expect(menu).toBeInTheDocument()
    // The first child by name is picked first, as on every parent page.
    await userEvent.click(await screen.findByRole('button', { name: /^Child: Kostas Manolas/ }))
    const list = await screen.findByRole('listbox', { name: 'Children' })
    await userEvent.click(within(list).getByRole('option', { name: /Sokratis Papastathopoulos/ }))
    expect(await screen.findByRole('button', { name: /^Child: Sokratis Papastathopoulos/ })).toBeInTheDocument()
    await waitFor(() => expect(asked).toContain(SOKRATIS))
  }, 15_000)

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

  it("a parent's side menu names the academy of the child they follow (slice 2)", async () => {
    const GUARDIAN = { id: 'family-frame-academy-guardian' }, CHILD = 'child-academy-giannis'
    signInAs(GUARDIAN)
    const asked: unknown[] = []
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) =>
        (new URL(request.url).searchParams.get('user_id') ?? '').includes(GUARDIAN.id)
          ? HttpResponse.json({ id: 'g', user_id: GUARDIAN.id, role: 'parent', full_name: 'Eleni Goumas' })
          : HttpResponse.json([{ user_id: CHILD, full_name: 'Giannis Goumas' }])),
      table('player_parent_links', [{ player_user_id: CHILD }]),
      table('player_details', []), table('coach_assessments', []), table('recognition_awards', []), table('parental_consents', []),
      table('game_for_family', []), table('game_review_for_family', []),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/family_academy`, async ({ request }) => {
        asked.push(((await request.json()) as { p_child?: string }).p_child)
        return HttpResponse.json({ name: 'Panathinaikos Academy', logo_url: null })
      }),
    )
    screenIs(true)
    renderApp('/parent/matches')
    expect(await screen.findByText('Panathinaikos Academy', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(asked).toEqual([CHILD])
  }, 15_000)
})
