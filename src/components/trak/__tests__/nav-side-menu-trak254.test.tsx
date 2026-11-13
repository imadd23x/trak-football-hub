/**
 * TRAK-254 gave a coach on a laptop a side menu inside NavBar. TRAK-259 (Imad,
 * 22 Oct) moved every coach's nav into the coach's frame (CoachFrame), so NavBar
 * renders nothing for a coach; players and parents keep today's bottom bar on
 * every screen. The frame's own tests are coach-frame-trak259.test.tsx.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NavBar } from '../NavBar'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
}

afterEach(() => { cleanup(); window.matchMedia = realMatchMedia })

const tabs = () => screen.getAllByRole('tab').map(tab => tab.textContent)

describe('NavBar', () => {
  it('renders nothing for a coach, on a phone or a laptop (the frame has their nav)', () => {
    for (const laptop of [false, true]) {
      screenIs(laptop)
      const { container } = render(<MemoryRouter initialEntries={["/coach/home"]}><NavBar role="coach" activeTab="/coach/home" onNavigate={vi.fn()} /></MemoryRouter>)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  // TRAK-440 (Imad, 11-12 Nov): the coach's glass tab bar. Player: Home, Matches, Trainings, Profile (Card leaves the
  // bar for Profile). Parent: Home, Events, Profile. A page under a tab keeps that tab marked.
  it("is the coach's glass tab bar for a player and a parent, with the new tabs", async () => {
    const onNavigate = vi.fn()
    render(<MemoryRouter initialEntries={["/player/matches"]}><NavBar role="player" activeTab="/player/matches" onNavigate={onNavigate} /></MemoryRouter>)
    expect(screen.getByRole('tablist', { name: 'Player' })).toBeInTheDocument()
    expect(tabs()).toEqual(['Home', 'Matches', 'Trainings', 'Profile'])
    expect(screen.getByRole('tab', { name: 'Matches' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Trainings' }))
    expect(onNavigate).toHaveBeenCalledWith('/player/trainings')
    cleanup()
    const back = vi.fn()
    render(<MemoryRouter initialEntries={["/parent/matches/event-1"]}><NavBar role="parent" activeTab="/parent/matches/event-1" onNavigate={back} /></MemoryRouter>)
    expect(screen.getByRole('tablist', { name: 'Parent' })).toBeInTheDocument()
    expect(tabs()).toEqual(['Home', 'Events', 'Profile'])
    expect(screen.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true')
    // From a page under Events, its marked tab goes back to Events; on Events itself it stays put.
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    expect(back).toHaveBeenCalledWith('/parent/matches')
    cleanup()
    const stay = vi.fn()
    render(<MemoryRouter initialEntries={["/parent/matches"]}><NavBar role="parent" activeTab="/parent/matches" onNavigate={stay} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    expect(stay).not.toHaveBeenCalled()
  })

  it("keeps a player's and a parent's bar on a laptop", () => {
    screenIs(true)
    render(<MemoryRouter initialEntries={["/player/home"]}><NavBar role="player" activeTab="/player/home" onNavigate={vi.fn()} /></MemoryRouter>)
    expect(tabs()).toEqual(['Home', 'Matches', 'Trainings', 'Profile'])
    cleanup()
    render(<MemoryRouter initialEntries={["/parent/home"]}><NavBar role="parent" activeTab="/parent/home" onNavigate={vi.fn()} /></MemoryRouter>)
    expect(tabs()).toEqual(['Home', 'Events', 'Profile'])
    expect(screen.queryByText('TRAK')).toBeNull()
  })
})
