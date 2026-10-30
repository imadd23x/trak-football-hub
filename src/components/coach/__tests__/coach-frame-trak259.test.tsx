import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'
import { BARLESS, placeOf } from '@/lib/coach-places'

/**
 * TRAK-259 (Imad, 22 Oct): the coach's frame. Phone: a glass tab bar (Home,
 * Squad, Library) with the "+" at its right; on Home the avatar (top left)
 * opens the side menu, and the calendar sits beside the bell. Laptop: the
 * sidebar (the club, Home, Calendar, Squad, Library, Settings, the coach) and
 * "+ Create" at the top right. Feedback and Profile left the nav, not the app.
 * TRAK-305: a coach with two squads picks All or one at the top: in the top bar on
 * a laptop, at the top of the page on a phone; the sidebar has no squad rows.
 */

const COACH = { id: 'coach-frame' }
const LOGO = 'data:image/jpeg;base64,/9j/synthetic'
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  // jsdom lays nothing out, so every width reads 0 and the sidebar folds to its rail (under 760 px) whenever it measures.
  // A laptop's frame is wide; on CI the fold landed before the squad rows were tapped (#439).
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(laptop ? 1440 : 390)
}

beforeEach(() => {
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    // Imad, 24 Oct: the academy has a logo; the coach's identity is cached across these tests, so every one sees it.
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: LOGO }]),
    table('coach_calendar_events', []),
    table('coach_sessions', []),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U14', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Theodoros Zagorakis', age_group: 'U16', status: 'active' },
    ]),
    table('session_attendance', []),
    table('event_absences', []),
    // Events on; Games (TRAK-283) off unless a test switches it on.
    rpc('feature_on', ({ p_feature }) => p_feature === 'events'),
    // TRAK-286: no game plan, shared or not.
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { window.matchMedia = realMatchMedia; vi.restoreAllMocks() })

describe('TRAK-259: the coach\'s frame', { timeout: 20_000 }, () => {
  it('on a phone: Home, Squad and Library in the glass tab bar, with the "+" beside them', async () => {
    screenIs(false)
    renderApp('/coach/home')
    const tabs = await screen.findByRole('tablist', { name: 'Coach' })
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Home', 'Squad', 'Library'])
    expect(within(tabs).getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    const nav = tabs.closest('nav')!
    expect(within(nav).getByRole('button', { name: 'Quick add' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Feedback|Profile|Calendar|Schedule/ })).toBeNull()

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Library' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/trainings'))
  })

  it('on a phone: Home\'s avatar opens the side menu; the calendar sits beside the bell', async () => {
    screenIs(false)
    renderApp('/coach/home')
    const header = (await screen.findByRole('button', { name: 'Open menu' })).closest('header')!
    expect(within(header).getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/coach/schedule') // TRAK-255
    expect(within(header).getByRole('button', { name: /^Alerts/ })).toBeInTheDocument()

    await userEvent.click(within(header).getByRole('button', { name: 'Open menu' }))
    const menu = await screen.findByRole('dialog', { name: 'Menu' })
    expect(await within(menu).findByText('Rehearsal FC')).toBeInTheDocument()
    for (const row of ['Home', 'Schedule', 'Squad', 'Library', 'Settings']) {
      expect(within(menu).getByRole('button', { name: new RegExp(`^${row}`) })).toBeInTheDocument()
    }
    expect(within(menu).queryByRole('button', { name: 'U16' })).toBeNull()
    expect(within(menu).getByText('Otto Rehhagel')).toBeInTheDocument()
    expect(within(menu).getByText('Head Coach')).toBeInTheDocument()

    await userEvent.click(within(menu).getByRole('button', { name: 'Settings' }))
    await waitFor(() => expect(window.location.pathname).toBe('/settings'))
  })

  it('on a laptop: the sidebar, and "+ Create" at the top right', async () => {
    screenIs(true)
    renderApp('/coach/home')
    const sidebar = await screen.findByRole('navigation', { name: 'Rehearsal FC' })
    for (const row of ['Home', 'Schedule', 'Squad', 'Library', 'Settings']) {
      expect(within(sidebar).getByRole('button', { name: new RegExp(`^${row}`) })).toBeInTheDocument()
    }
    expect(within(sidebar).queryByRole('button', { name: /Feedback|Profile/ })).toBeNull()
    expect(within(sidebar).getByRole('button', { name: /^Home/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('tablist', { name: 'Coach' })).toBeNull()

    // TRAK-305: the age groups sit in the top bar, not the sidebar; the pick holds from page to page.
    expect(within(sidebar).queryByRole('button', { name: 'U16' })).toBeNull()
    const ages = () => screen.getByRole('group', { name: 'Age group' })
    await waitFor(() => expect(within(ages()).getAllByRole('button').map(b => b.textContent)).toEqual(['All', 'U14', 'U16']), { timeout: 5000 })
    expect(within(ages()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(ages()).getByRole('button', { name: 'U16' }))
    // The sidebar is looked up again: while a page's code loads, the frame can be rebuilt (CI, four times on #439).
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Rehearsal FC' })).getByRole('button', { name: /^Squad/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad'))
    await waitFor(() => expect(within(ages()).getByRole('button', { name: 'U16' })).toHaveAttribute('aria-pressed', 'true'), { timeout: 5000 })
  })

  it("Imad, 24 Oct: the academy's logo in the sidebar; the coach stays initials (G7)", async () => {
    screenIs(true)
    renderApp('/coach/home')
    await screen.findByRole('navigation', { name: 'Rehearsal FC' })
    await waitFor(() => expect(document.querySelector(`img[src="${LOGO}"]`)).not.toBeNull(), { timeout: 5000 })
    // The only picture on the page: no person's photo.
    expect(document.querySelectorAll('img')).toHaveLength(1)
  })

  it('Feedback and Profile still open by their address', async () => {
    screenIs(false)
    renderApp('/coach/feedback')
    expect(await screen.findByRole('tablist', { name: 'Coach' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/feedback')
  })

  it('keeps the phone bar off pages that had none: their own actions sit at the bottom', async () => {
    for (const path of ['/settings', '/coach/manual', '/coach/player/sp-1', '/coach/sessions/add', '/coach/sessions/quick', '/coach/sessions/abc'])
      expect(BARLESS.test(path)).toBe(true)
    for (const path of ['/coach/home', '/coach/sessions', '/coach/sessions/list', '/coach/assess', '/coach/squad', '/coach/trainings'])
      expect(BARLESS.test(path)).toBe(false)
    screenIs(false)
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Coach' })).toBeNull()
  })

  it("TRAK-283: Games joins the nav only where the academy's switch is on", async () => {
    // Off: no Games on a phone or a laptop.
    screenIs(false)
    renderApp('/coach/home')
    const offTabs = await screen.findByRole('tablist', { name: 'Coach' })
    expect(within(offTabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Home', 'Squad', 'Library'])
    cleanup()
    screenIs(true)
    renderApp('/coach/home')
    const offSidebar = await screen.findByRole('navigation', { name: 'Rehearsal FC' })
    expect(within(offSidebar).getByRole('button', { name: /^Library/ })).toBeInTheDocument()
    expect(within(offSidebar).queryByRole('button', { name: /^Matches/ })).toBeNull()
    cleanup()
    vi.restoreAllMocks()

    // On: the phone's bar is Home · Squad · Games · Library, and Games opens Games home. The app keeps a switch's
    // answer for 30 s, so the academy whose switch is on is another coach's.
    signInAs({ id: 'coach-frame-games' })
    // TRAK-294: Training stays off here, so Library keeps its place (training-home-trak294 covers Training on).
    server.use(rpc('feature_on', ({ p_feature }) => p_feature !== 'training'))
    screenIs(false)
    renderApp('/coach/home')
    const tabs = await screen.findByRole('tablist', { name: 'Coach' })
    await waitFor(() => expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Home', 'Squad', 'Matches', 'Library']))
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Matches' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/matches'))
    await waitFor(() => expect(within(screen.getByRole('tablist', { name: 'Coach' })).getByRole('tab', { name: 'Matches' })).toHaveAttribute('aria-selected', 'true'))
    cleanup()

    // The sidebar: Home · Schedule · Squad · Games · Library.
    screenIs(true)
    renderApp('/coach/home')
    const sidebar = await screen.findByRole('navigation', { name: 'Rehearsal FC' })
    const games = await within(sidebar).findByRole('button', { name: /^Matches/ })
    const order = within(sidebar).getAllByRole('button').map(button => button.textContent ?? '')
    const rows = ['Home', 'Schedule', 'Squad', 'Matches', 'Library'].map(row => order.findIndex(text => text.startsWith(row)))
    expect(rows.every(index => index >= 0)).toBe(true)
    expect(rows).toEqual([...rows].sort((a, b) => a - b))
    await userEvent.click(games)
    await waitFor(() => expect(window.location.pathname).toBe('/coach/matches'))
  })

  it('TRAK-306 (Kostas, 28 Oct): a cone for Training, Imad’s pitch for Games, on a phone and a laptop', async () => {
    // The nav's icons: lucide's cone, or Imad's pitch (drawn on a 128 grid).
    const icon = (item: HTMLElement) => {
      const svg = item.querySelector('svg')
      return svg?.classList.contains('lucide-traffic-cone') ? 'cone' : svg?.getAttribute('viewBox') === '0 0 128 128' ? 'pitch' : 'other'
    }
    signInAs({ id: 'coach-frame-icons' })
    server.use(rpc('feature_on', () => true))
    screenIs(false)
    renderApp('/coach/home')
    const tabs = await screen.findByRole('tablist', { name: 'Coach' })
    await waitFor(() => expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Home', 'Squad', 'Matches', 'Training']))
    expect(icon(within(tabs).getByRole('tab', { name: 'Training' }))).toBe('cone')
    expect(icon(within(tabs).getByRole('tab', { name: 'Matches' }))).toBe('pitch')
    cleanup()

    screenIs(true)
    renderApp('/coach/home')
    const sidebar = await screen.findByRole('navigation', { name: 'Rehearsal FC' })
    expect(icon(await within(sidebar).findByRole('button', { name: /^Training/ }))).toBe('cone')
    expect(icon(within(sidebar).getByRole('button', { name: /^Matches/ }))).toBe('pitch')
  })

  it('TRAK-306: with Training off, Library takes its place with the cone, so the nav never shows the pitch twice', async () => {
    signInAs({ id: 'coach-frame-icons-library' })
    server.use(rpc('feature_on', ({ p_feature }) => p_feature !== 'training'))
    screenIs(false)
    renderApp('/coach/home')
    const tabs = await screen.findByRole('tablist', { name: 'Coach' })
    await waitFor(() => expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Home', 'Squad', 'Matches', 'Library']))
    expect(within(tabs).getByRole('tab', { name: 'Library' }).querySelector('svg')).toHaveClass('lucide-traffic-cone')
    expect(within(tabs).getByRole('tab', { name: 'Matches' }).querySelector('svg')).toHaveAttribute('viewBox', '0 0 128 128')
  })

  it('knows which row a page belongs to', () => {
    expect(placeOf('/coach/matches')).toEqual({ screen: 'games', title: 'Matches' }) // TRAK-283
    expect(placeOf('/coach/matches/ev-1')).toEqual({ screen: 'games', title: 'Matches' })
    expect(placeOf('/coach/training')).toEqual({ screen: 'training', title: 'Training' }) // TRAK-294
    expect(placeOf('/coach/training/drills')).toEqual({ screen: 'training', title: 'Training' })
    expect(placeOf('/coach/trainings/defending')).toEqual({ screen: 'library', title: 'Library' })
    expect(placeOf('/coach/player/abc')).toEqual({ screen: 'squad', title: 'Player' })
    expect(placeOf('/coach/sessions/list')).toEqual({ screen: 'home', title: 'Log' })
    expect(placeOf('/coach/schedule')).toEqual({ screen: 'calendar', title: 'Schedule' }) // TRAK-255
    expect(placeOf('/coach/homework')).toEqual({ screen: null, title: 'Trak' })
  })
})
