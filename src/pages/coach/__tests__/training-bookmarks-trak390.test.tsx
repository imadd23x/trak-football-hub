/**
 * TRAK-390 (Drill Library 5/11, parent TRAK-384): bookmarks. A bookmark in every card's corner and Add to My drills on
 * a drill's page; tap again to take it out; a short message each time; My drills on the Library home counts them and
 * its page shows them grouped by kind. Saved in the coach's own rows. Test people are named after footballers.
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
let COACH = { id: 'coach-390' }
const drill = (name: string) => LIBRARY.find(d => d.name === name)!

/** The coach's bookmarks, as the database keeps them; every write kept for the test to read. */
function bookmarksTable(start: string[], { failWrites = false } = {}) {
  let rows = start.map((d, i) => ({ drill: d, created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }))
  const writes: { method: string; url: URL; body: unknown }[] = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_drill_bookmarks`, () => HttpResponse.json([...rows].reverse())),
    http.post(`${SUPABASE_URL}/rest/v1/coach_drill_bookmarks`, async ({ request }) => {
      const body = await request.json() as { drill: string }
      writes.push({ method: 'POST', url: new URL(request.url), body })
      if (failWrites) return HttpResponse.json({ message: 'unavailable' }, { status: 500 })
      rows = [...rows, { drill: body.drill, created_at: new Date().toISOString() }]
      return new HttpResponse(null, { status: 201 })
    }),
    http.delete(`${SUPABASE_URL}/rest/v1/coach_drill_bookmarks`, ({ request }) => {
      const url = new URL(request.url)
      writes.push({ method: 'DELETE', url, body: null })
      if (failWrites) return HttpResponse.json({ message: 'unavailable' }, { status: 500 })
      rows = rows.filter(r => `eq.${r.drill}` !== url.searchParams.get('drill'))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return writes
}

beforeEach(() => {
  COACH = { id: `coach-390-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Zinedine Zidane', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', Array.from({ length: 12 }, (_, i) => ({ id: `sp-${i}`, coach_user_id: COACH.id, player_name: `Player ${i}`, age_group: 'U14', status: 'active' }))),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([])),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_plans', []),
    table('training_notes', []),
    table('training_plan_drafts', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

describe('TRAK-390: bookmarks', { timeout: 20_000 }, () => {
  it('a card’s bookmark adds the drill to My drills and takes it out again, with a message each time', async () => {
    const user = userEvent.setup()
    const writes = bookmarksTable([])
    renderApp('/coach/training/drills/kind/skill')
    const mark = await screen.findByRole('button', { name: 'Add to My drills: Keep the ball' })
    expect(mark).toHaveAttribute('aria-pressed', 'false')
    await user.click(mark)
    expect(await screen.findByRole('button', { name: 'In My drills: Keep the ball' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Added to My drills')).toBeInTheDocument()
    expect(writes[0]).toMatchObject({ method: 'POST', body: { drill: drill('Keep the ball').id } })

    await user.click(screen.getByRole('button', { name: 'In My drills: Keep the ball' }))
    expect(await screen.findByRole('button', { name: 'Add to My drills: Keep the ball' })).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText('Removed from My drills')).toBeInTheDocument()
    // Only the coach's own row, by the drill's Library id.
    expect(writes[1].method).toBe('DELETE')
    expect(writes[1].url.searchParams.get('coach_user_id')).toBe(`eq.${COACH.id}`)
    expect(writes[1].url.searchParams.get('drill')).toBe(`eq.${drill('Keep the ball').id}`)
  })

  it('the drill page’s Add to My drills reads In My drills once added', async () => {
    const user = userEvent.setup()
    bookmarksTable([])
    renderApp(`/coach/training/drills/d/${drill('Four corners').id}`)
    const add = await screen.findByRole('button', { name: 'Add to My drills' })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    expect(await screen.findByRole('button', { name: 'In My drills' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('My drills on the home counts them; its page shows them grouped by kind', async () => {
    bookmarksTable([drill('Go wide first').id, drill('Keep the ball').id, drill('Moving warm-up').id, 'lib-gone-since'])
    renderApp('/coach/training/drills')
    // A drill no longer in the Library isn't counted.
    expect(await screen.findByRole('link', { name: /My drills.*3 drills/ })).toBeInTheDocument()
    cleanup()
    renderApp('/coach/training/drills/mine')
    await screen.findByRole('heading', { name: 'My drills', level: 1 })
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Get ready', 'Skill practices', 'Game related practices']))
    const lists = screen.getAllByRole('list').filter(l => l.closest('section'))
    expect(lists.map(l => within(l).getAllByRole('link').map(a => a.querySelector('span > span')?.textContent)))
      .toEqual([['Moving warm-up'], ['Keep the ball'], ['Go wide first']])
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(3)
  })

  it('a failed save puts the bookmark back and says so', async () => {
    const user = userEvent.setup()
    bookmarksTable([], { failWrites: true })
    renderApp('/coach/training/drills/kind/skill')
    await user.click(await screen.findByRole('button', { name: 'Add to My drills: Keep the ball' }))
    expect(await screen.findByText('Couldn’t save. Check your connection and try again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to My drills: Keep the ball' })).toHaveAttribute('aria-pressed', 'false'))
  })
})
