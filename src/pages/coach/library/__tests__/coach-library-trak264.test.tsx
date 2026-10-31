import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../../tests/support/render-app'
import { signInAs } from '../../../../../tests/support/session'
import { server } from '../../../../../tests/msw/server'
import { table, rpc } from '../../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'
import { SESSIONS } from '@/lib/library/library'

/**
 * TRAK-264 (Kostas, 22 Oct): the coach's Trainings tab becomes the Library.
 * Its first page is the Spotify mockups' Search screen (a search box, three
 * chips, a tile per library, Play It Right). A tile opens that library with the
 * squad's age group on; a session opens its own page (on a laptop, a panel
 * beside the table); programmes are albums of six weeks; search finds sessions.
 */

const COACH = { id: 'coach-library' }
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
}

beforeEach(() => {
  screenIs(false)
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC' }]),
    table('coach_calendar_events', []),
    table('coach_sessions', []),
    // Two squads, U14 and U16: both are the catalogue's 12–16.
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U14', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Theodoros Zagorakis', age_group: 'U16', status: 'active' },
    ]),
    table('session_attendance', []),
    table('event_absences', []),
    // TRAK-294: Training off, so the nav's tab is still Library.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training'),
  )
})
afterEach(() => { window.matchMedia = realMatchMedia })

const link = (name: string | RegExp) => screen.getByRole('link', { name })

describe('TRAK-264: the coach\'s Library', { timeout: 20_000 }, () => {
  it('opens on the Search screen of the mockups: search, chips, a tile per library, Play It Right', async () => {
    renderApp('/coach/trainings')
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    const bar = await screen.findByRole('tablist', { name: 'Coach' })
    expect(within(bar).getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true')

    expect(link(/Search drills/)).toHaveAttribute('href', '/coach/trainings/search')
    expect(link('Drills')).toHaveAttribute('href', '/coach/trainings/search?show=drills')
    expect(link('Programmes')).toHaveAttribute('href', '/coach/trainings/programmes')
    expect(link('Play It Right')).toHaveAttribute('href', '/coach/trainings/play-it-right')

    const tiles = within(screen.getByRole('heading', { name: 'Browse drills' }).nextElementSibling as HTMLElement).getAllByRole('link')
    expect(tiles.map(t => [t.textContent, t.getAttribute('href')])).toEqual([
      ['Technical82 sessions', '/coach/trainings/technical'],
      ['Defending53 sessions', '/coach/trainings/defending'],
      ['Attacking22 sessions', '/coach/trainings/attacking'],
      ['Goalkeeping16 sessions', '/coach/trainings/goalkeeping'],
      ['Physical and movement15 sessions', '/coach/trainings/physical'],
      ['Transition5 sessions', '/coach/trainings/transition'],
      ['Psychological and social3 sessions', '/coach/trainings/psychological'],
    ])
    expect(link(/Play It Right\s*Match moments from the code of conduct/)).toHaveAttribute('href', '/coach/trainings/play-it-right')
    // The old catalogue page is no longer framed for a coach.
    expect(screen.queryByTitle('Coaching Session Catalogue')).toBeNull()
  })

  it('a tile opens its library, on the squad\'s age group until the coach clears it', async () => {
    renderApp('/coach/trainings')
    await userEvent.click(await screen.findByRole('link', { name: /^Defending/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Defending' })).toBeInTheDocument()
    expect(screen.getByText('53 sessions · 3 topics')).toBeInTheDocument()

    const age = await screen.findByRole('button', { name: 'Ages 12–16, tap to clear' })
    expect(age).toHaveAttribute('aria-pressed', 'true')
    const tabs = screen.getByRole('tablist', { name: 'Topics' })
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Pressing and covering 12')
    expect(screen.getByText('Ages 12–16: 2 programmes, 10 sessions')).toBeInTheDocument()
    expect(link(/^Press and cover to defend/)).toHaveAttribute('href', '/coach/trainings/programme/session-programme-press-and-cover-to-defend')
    expect(link(/^Read and react/)).toHaveAttribute('href', '/coach/trainings/session/pressing-and-covering-session-read-and-react')

    await userEvent.click(age)
    expect(await screen.findByText('3 programmes, 20 sessions')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Age group' })).toHaveValue('')

    await userEvent.click(within(tabs).getByRole('tab', { name: /Marking and intercepting/ }))
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent(/^Marking and intercepting/)
  })

  it('a session\'s page: its picture, what players learn, the kit, its links and its programme\'s weeks', async () => {
    renderApp('/coach/trainings/session/pressing-and-covering-session-read-and-react')
    expect(await screen.findByRole('heading', { level: 1, name: 'Read and react' })).toBeInTheDocument()
    expect(screen.getByText('Pressing and covering session')).toBeInTheDocument()
    expect(screen.getByText('Ages 12–16 · 14 players · 44×30-yard pitch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About this session' }).nextElementSibling).toHaveTextContent(/press and cover effectively to win the ball back/)

    const learn = screen.getByRole('heading', { name: 'Players will learn to' }).nextElementSibling as HTMLElement
    expect(within(learn).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'understand how to win the ball back', 'keep the ball once they’ve won it', 'learn how to move into a counter-attack',
    ])
    const kit = screen.getByRole('heading', { name: "You'll need" }).nextElementSibling as HTMLElement
    expect(within(kit).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      '44×30-yard pitch', '14 players', 'Mini-goals', 'Flat cones', 'Spots or flat markers', 'Bibs',
    ])
    expect(screen.getByText('From England Football Learning, 23 Feb 2026. © The FA')).toBeInTheDocument()

    expect(link(/^Press and cover to defend\s*This is week 1 of 6/)).toHaveAttribute('href', '/coach/trainings/programme/session-programme-press-and-cover-to-defend')
    expect(screen.getByText('This one').closest('li')).toHaveTextContent('1Read and reactThis one')
    expect(link(/Pressing for glory/)).toHaveAttribute('href', '/coach/trainings/session/pressing-and-covering-session-pressing-for-glory')
  })

  it('a programme is six weeks, each opening its session', async () => {
    renderApp('/coach/trainings/programme/session-programme-press-and-cover-to-defend')
    expect(await screen.findByRole('heading', { level: 1, name: 'Press and cover to defend' })).toBeInTheDocument()
    expect(screen.getByText('Six-week programme')).toBeInTheDocument()
    const weeks = screen.getByRole('heading', { name: 'The six weeks' }).nextElementSibling as HTMLElement
    expect(within(weeks).getAllByRole('link').map(a => a.textContent)).toEqual([
      '1Read and react', '2Pressing for glory', '3Cover and recover', '4Pressing duels', '5Defending in small numbers', '6Games week',
    ])
  })

  it('the Programmes chip lists the squad\'s age group first, then every age, the rest on request', async () => {
    renderApp('/coach/trainings/programmes')
    expect(await screen.findByRole('heading', { name: 'For ages 12–16 (U14 and U16)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'For every age' })).toBeInTheDocument()
    expect(link('Programmes, tap to clear')).toHaveAttribute('href', '/coach/trainings')
    await userEvent.click(screen.getByRole('button', { name: '4 more for other ages' }))
    expect(screen.getByRole('heading', { name: 'For other ages' })).toBeInTheDocument()
    expect(link(/^Moving with the ball and turning to attack/)).toBeInTheDocument()
  })

  it('search finds sessions as the coach types, a top result first', async () => {
    renderApp('/coach/trainings/search')
    const box = await screen.findByRole('searchbox', { name: 'Search the Library' })
    expect(box).toHaveFocus()
    await userEvent.type(box, 'press cover')
    expect(await screen.findByRole('heading', { name: 'Top result' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Programmes' }))
    expect(screen.queryByRole('heading', { name: 'Sessions' })).toBeNull()
    await userEvent.clear(box)
    await userEvent.type(box, 'zzzz')
    expect(await screen.findByText('No sessions match “zzzz”.')).toHaveAttribute('role', 'status')
  })

  it('Play It Right opens inside the Library (TRAK-268), with a way back', async () => {
    renderApp('/coach/trainings/play-it-right')
    expect(await screen.findByRole('heading', { level: 1, name: 'Play It Right' })).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
  })

  it('on a laptop: a session opens wide beside the list, the way Squad opens a player', async () => {
    screenIs(true)
    renderApp('/coach/trainings/defending')
    const sessions = await screen.findByRole('list', { name: 'Sessions' })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No session open')).toBeInTheDocument()
    expect(screen.getByText('Pick a session to see it here.')).toBeInTheDocument()

    await userEvent.click(within(sessions).getByRole('button', { name: /Read and react/ }))
    const open = await screen.findByRole('article', { name: 'Read and react' })
    expect(within(open).getByRole('heading', { level: 2, name: 'Read and react' })).toBeInTheDocument()
    expect(within(open).getByRole('heading', { name: 'About this session' })).toBeInTheDocument()
    expect(within(open).getByRole('heading', { name: 'Players will learn to' })).toBeInTheDocument()
    expect(within(sessions).getByRole('button', { name: /Read and react/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('No session open')).toBeNull()
    // The list and the open session are the same card: the session sits beside the list, not at the page's edge.
    expect(open.closest('[style*="grid-template-columns"]')).toBe(sessions.closest('[style*="grid-template-columns"]'))

    await userEvent.click(within(sessions).getByRole('button', { name: /Pressing for glory/ }))
    expect(await screen.findByRole('article', { name: 'Pressing for glory' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('article', { name: 'Pressing for glory' })).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull())
    expect(screen.getByText('No session open')).toBeInTheDocument()
  })

  it('a drill with no aims or kit list still says what it is about and its skills', async () => {
    const bare = SESSIONS.find(s => s.title === 'Dribbling session: dare to dribble')!
    expect(bare.objectives).toEqual([])
    expect(bare.setup).toEqual([])
    renderApp(`/coach/trainings/session/${bare.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Dare to dribble' })).toBeInTheDocument()
    expect(screen.getByText('Ages 5 and up · 1–4 a side')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About this session' }).nextElementSibling).toHaveTextContent(bare.summary)
    const skills = screen.getByRole('heading', { name: 'Skills' }).nextElementSibling as HTMLElement
    expect(within(skills).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Moving with the ball'])
  })

  it('a new page opens at its top, and Back returns to the same library, topic and place', async () => {
    const scrolls = vi.spyOn(Element.prototype, 'scrollTo')
    renderApp('/coach/trainings')
    await userEvent.click(await screen.findByRole('link', { name: /^Defending/ }))
    await screen.findByRole('heading', { level: 1, name: 'Defending' })
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Topics' })).getByRole('tab', { name: /Marking and intercepting/ }))
    scrolls.mockClear()
    const first = within(screen.getByRole('heading', { name: 'Sessions' }).parentElement!).getAllByRole('link')[0]
    const name = first.querySelector('span span')!.textContent!
    await userEvent.click(first)
    expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument()
    expect(scrolls).toHaveBeenCalledWith(0, 0)

    scrolls.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Defending' })).toBeInTheDocument()
    expect(within(screen.getByRole('tablist', { name: 'Topics' })).getByRole('tab', { selected: true })).toHaveTextContent(/^Marking and intercepting/)
    // Back leaves the place in the list to the browser: no jump to the top.
    expect(scrolls).not.toHaveBeenCalled()
    scrolls.mockRestore()
  })

  it('never sends the coach to another website: every link stays in Trak (Kostas, 22 Oct)', async () => {
    const pages: [string, string][] = [
      ['/coach/trainings', 'Library'],
      ['/coach/trainings/defending', 'Defending'],
      ['/coach/trainings/session/pressing-and-covering-session-read-and-react', 'Read and react'],
      ['/coach/trainings/programme/session-programme-press-and-cover-to-defend', 'Press and cover to defend'],
      ['/coach/trainings/programmes', 'Library'],
    ]
    for (const [path, heading] of pages) {
      const { unmount } = renderApp(path)
      await screen.findByRole('heading', { level: 1, name: heading })
      for (const a of screen.getAllByRole('link')) {
        expect(a.getAttribute('href'), `${path}: ${a.textContent}`).toMatch(/^\//)
        expect(a).not.toHaveAttribute('target')
      }
      unmount()
    }
  })

  it('an unknown library or session goes back to the Library', async () => {
    renderApp('/coach/trainings/nope')
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/trainings')
  })
})
