/**
 * TRAK-387 (Drill Library 3/11, parent TRAK-384): Training › Drills is the new Library, from the 8 Nov mockup. Find a
 * drill, My drills and All drills, the three kinds of practice, a practice page, All drills with its filters, and a
 * drill's page. Every picture is fitted to the coach's squad. No coach-made drills. Test people are named after
 * footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { LIBRARY } from '@/lib/training/library'

let n = 0
let COACH = { id: 'coach-387' }
const player = (i: number, age_group = 'U14') => ({ id: `sp-${i}`, coach_user_id: COACH.id, player_name: `Player ${i}`, age_group, status: 'active' })

/** The coach's roster: `count` players in one squad. */
function roster(count: number) {
  server.use(table('squad_players', Array.from({ length: count }, (_, i) => player(i + 1))))
}

beforeEach(() => {
  COACH = { id: `coach-387-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Pep Guardiola', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([])),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_plans', []),
    table('training_notes', []),
    table('training_plan_drafts', []),
    table('coach_drill_bookmarks', []),
    table('coach_drills', []),
    rpc('feature_on', () => true),
  )
  roster(12)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const cardNames = (list: HTMLElement) => within(list).getAllByRole('link').map(link => link.querySelector('span > span')?.textContent)

describe('TRAK-387: the Library home', { timeout: 20_000 }, () => {
  it('Find a drill, My drills and All drills, the three kinds; no coach-made drills', async () => {
    renderApp('/coach/training/drills')
    expect(await screen.findByRole('heading', { name: 'Find a drill' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search drills' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /My drills.*Nothing added yet/ })).toHaveAttribute('href', '/coach/training/drills/mine')
    expect(screen.getByRole('link', { name: new RegExp(`All drills.*${LIBRARY.length} in all`) })).toHaveAttribute('href', '/coach/training/drills/all')
    const kinds = within(screen.getByRole('region', { name: 'What kind of practice?' }))
    expect(kinds.getByRole('link', { name: /^Technical/ })).toHaveAttribute('href', '/coach/training/drills/kind/technical')
    expect(kinds.getByRole('link', { name: /^Skill/ })).toHaveAttribute('href', '/coach/training/drills/kind/skill')
    expect(kinds.getByRole('link', { name: /^Game related/ })).toHaveAttribute('href', '/coach/training/drills/kind/game')
    // Kostas, 8 Nov: no coach-made drills for the pilot.
    expect(screen.queryByRole('button', { name: /New drill/ })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: 'Search my drills' })).toBeNull()
    // TRAK-394: Change any practice joins Individual work and Goalkeeping; the old FA Library's tiles left.
    expect(kinds.getByRole('link', { name: 'Change any practice' })).toHaveAttribute('href', '/coach/training/drills/change')
    expect(screen.queryByRole('region', { name: 'From the Library' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Play It Right|Programmes/ })).toBeNull()
    // Kostas, 9 Nov: Steve checks the wording after the pilot, so no page says it's unchecked.
    expect(screen.queryByText(/coaching lead|not yet checked/)).toBeNull()
  })

  it('typing shows results as picture cards in place of everything else, with the name it was found by', async () => {
    const user = userEvent.setup()
    renderApp('/coach/training/drills')
    await user.type(await screen.findByRole('searchbox', { name: 'Search drills' }), 'piggy in the middle')
    const found = await screen.findByRole('list', { name: 'Drills found' })
    expect(cardNames(found)).toEqual(LIBRARY.filter(d => d.type === 'Rondos').map(d => d.name))
    expect(within(found).getAllByText('Also called piggy in the middle').length).toBeGreaterThan(0)
    expect(screen.getByText('6 drills found. Each picture is set for 12 players.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'What kind of practice?' })).toBeNull()
    expect(window.location.search).toBe('?q=piggy+in+the+middle')

    await user.clear(screen.getByRole('searchbox', { name: 'Search drills' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search drills' }), 'zzzz')
    expect(await screen.findByText(/No drills match/)).toBeInTheDocument()
  })

  it('every picture is fitted to the squad picked, kept to 8–20 players', async () => {
    roster(15)
    renderApp('/coach/training/drills/kind/skill')
    expect(await screen.findByText(/Each picture is set for 15 players\./)).toBeInTheDocument()
    expect(screen.getAllByText('15 players, 6v2 and 5v2 · 11x11 m each').length).toBeGreaterThan(0)
  })

  it('a big squad is drawn for 20, the most a picture holds', async () => {
    roster(30)
    renderApp('/coach/training/drills/kind/skill')
    expect(await screen.findByText(/Each picture is set for 20 players\./)).toBeInTheDocument()
  })

  it('Sessions and Drills switch the view', async () => {
    const user = userEvent.setup()
    renderApp('/coach/training')
    await screen.findByText('No training coming up')
    await user.click(screen.getByRole('button', { name: 'Drills' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/drills'))
    expect(await screen.findByRole('heading', { name: 'Find a drill' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training'))
  })
})

describe('TRAK-387: the Library’s pages', { timeout: 20_000 }, () => {
  it('a practice page: its drill types simple to complex, then one type at a time; Back keeps the type', async () => {
    const user = userEvent.setup()
    renderApp('/coach/training/drills/kind/skill')
    expect(await screen.findByRole('heading', { name: 'Skill practices', level: 1 })).toBeInTheDocument()
    const types = ['Rondos', 'Attack in turns', 'Win it and get out', 'Possession', 'Whole squad']
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(types))
    await user.click(screen.getByRole('button', { name: 'Possession' }))
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Possession']))
    expect(window.location.search).toBe('?type=Possession')
    await user.click(screen.getByRole('link', { name: /^Keep it with spare players/ }))
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/coach\/training\/drills\/d\/lib-/))
    window.history.back()
    await waitFor(() => expect(window.location.search).toBe('?type=Possession'))
    expect(await screen.findByRole('heading', { name: 'Possession', level: 2 })).toBeInTheDocument()
  })

  it('Game related says 11 v 11 has no sample yet', async () => {
    renderApp('/coach/training/drills/kind/game')
    expect(await screen.findByText('Needs 22 players and a full pitch. None yet.')).toBeInTheDocument()
  })

  it('All drills: grouped Get ready → Technical → Skill → Game related, with filters and its own search', async () => {
    const user = userEvent.setup()
    renderApp('/coach/training/drills/all')
    expect(await screen.findByRole('heading', { name: 'All drills', level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Get ready', 'Technical practices', 'Skill practices', 'Game related practices']))
    await user.click(screen.getByRole('button', { name: 'Goalkeeping' }))
    expect(await screen.findByRole('heading', { name: 'Goalkeeping', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^${LIBRARY.filter(d => d.focus === 'goalkeeping').length} drills\\.`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search drills' }), 'posession')
    const found = await screen.findByRole('list', { name: 'Drills found' })
    expect(cardNames(found)[0]).toBe('Keep it with spare players')
  })

  it('My drills says how to add one while it’s empty (TRAK-390 adds bookmarks)', async () => {
    renderApp('/coach/training/drills/mine')
    expect(await screen.findByRole('heading', { name: 'My drills', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Nothing in My drills yet')).toBeInTheDocument() // TRAK-432: Arc's empty state
    expect(screen.getByText(/^Open a drill and choose Add to My drills/)).toBeInTheDocument()
  })

  it('a drill’s page: the picture with a description, its key, the five details, why, how and what to watch for (TRAK-389 adds more)', async () => {
    const keep = LIBRARY.find(d => d.name === 'Keep the ball')!
    renderApp(`/coach/training/drills/d/${keep.id}`)
    expect(await screen.findByRole('heading', { name: 'Keep the ball', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /^Keep the ball set-up\. Area shape and size: 13x13 m\. Numbers: 12 players, 9v3\./ })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Key' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Attackers', 'Defenders'])
    expect(screen.getByText('Area shape and size').nextSibling).toHaveTextContent('13x13 m')
    expect(screen.getByRole('heading', { name: 'Why this works' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Watch for' })).toBeInTheDocument()
  })

  it('an old or unknown drill goes back to the Library', async () => {
    renderApp('/coach/training/drills/d/r1')
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/drills'))
  })
})
