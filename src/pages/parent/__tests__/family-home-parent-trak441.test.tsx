/**
 * TRAK-441 slice 2.6 (Imad, 13 Nov), behind the academy's family_look switch: the parent's Home in the coach's look, as
 * the player's. The coach's week, For you, the child's season, Latest evaluation (bands, opening the parent's page) and
 * Season so far; "Recorded matches" with its rating and the swipe cards are gone. With the switch off, today's Home.
 * Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { rpc, rpcRows, table, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

let n = 0
let PARENT = { id: 'parent-441' }
const CHILD = 'child-giourkas-441'
let switchOn = true
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(laptop ? 1440 : 390)
}

beforeEach(() => {
  localStorage.clear()
  switchOn = true
  PARENT = { id: `parent-441-${++n}` }
  signInAs(PARENT)
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const asked = new URL(request.url).searchParams.get('user_id') ?? ''
      if (asked.includes(PARENT.id)) return HttpResponse.json({ id: 'p', user_id: PARENT.id, role: 'parent', full_name: 'Eleni Seitaridi', nationality: null })
      return HttpResponse.json([{ user_id: CHILD, full_name: 'Giourkas Seitaridis' }])
    }),
    table('player_parent_links', [{ player_user_id: CHILD }]),
    table('player_details', [{ position: 'Defender', current_club: 'Rehearsal FC', age_group: 'U16' }]),
    table('parental_consents', []), table('squad_players', [{ id: 'sq-441', coach_user_id: 'coach-441' }]), table('recognition_awards', []),
    table('coach_assessments', [{ id: 'eval-441', session_id: null, created_at: '2026-11-08T10:00:00Z', coach_user_id: 'coach-441',
      coach_rating: 7.5, work_rate: 8, tactical: 7, attitude: 8, technical: 7, physical: 6, coachability: 9 }]),
    table('matches', [{ id: 'm1', team_score: 2, opponent_score: 1, computed_rating: 7.2, match_date: '2026-11-01', created_at: '2026-11-01T12:00:00Z' }]),
    table('game_for_family', []), table('game_review_for_family', []),
    rpcRows('child_events', []), rpcRows('family_training_history', []), rpcRows('get_children_awaiting_consent', []),
    rpcRows('get_roster_children_awaiting_consent', []), rpcRows('get_my_child_logins', []), rpcRows('get_my_approved_children_awaiting_signup', []),
    rpcRows('season_plan_for_player', []), rpcRows('family_academy', [{ name: 'Rehearsal FC', logo_url: null }]),
    rpcRows('child_training_attendance', [{ attended: 5, total: 6 }]),
    rpc('guardian_consent_applies', () => true),
    rpc('family_feature_on', ({ p_feature }) => switchOn && p_feature === 'family_look'),
  )
})
afterEach(() => { cleanup(); window.matchMedia = realMatchMedia; vi.restoreAllMocks(); delete document.documentElement.dataset.layout })

describe("TRAK-441: the parent Home in the coach's look", () => {
  it('a phone: the coach\'s week, Latest evaluation opening the parent\'s page, Season so far; no rating', async () => {
    screenIs(false)
    renderApp('/parent/home')
    const latest = await screen.findByRole('region', { name: 'Latest evaluation' }, { timeout: 5000 })
    expect(within(latest).getByRole('link', { name: /Open evaluation/ })).toHaveAttribute('href', '/parent/assessment/eval-441')
    expect(within(latest).getByText('New')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This week', level: 2 })).toBeInTheDocument()
    const soFar = await screen.findByRole('region', { name: 'Season so far' })
    expect(within(soFar).getByText('Matches').nextElementSibling).toHaveTextContent('1')
    expect(within(soFar).getByText('Training').nextElementSibling).toHaveTextContent('5/6')
    // Gone: the rating summary and the swipe cards (TRAK-435), and the details line under the header.
    expect(screen.queryByRole('region', { name: 'Recorded matches summary' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Latest coach assessment' })).toBeNull()
    expect(screen.queryByText('Defender · Rehearsal FC · U16')).toBeNull()
    expect(screen.getByRole('button', { name: /^Alerts/ })).toBeInTheDocument()
  })

  it("with the switch off: today's Home", async () => {
    switchOn = false
    screenIs(false)
    renderApp('/parent/home')
    expect(await screen.findByRole('region', { name: 'Recorded matches summary' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Season so far' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Latest evaluation' })).toBeNull()
  })

  it("the week's chosen event has a red Can't make it beside Details: a reason, Tell the coach, and the week says so", async () => {
    screenIs(false)
    const today = new Date().toLocaleDateString('en-CA')
    let absent: { event_id: string }[] = []
    const sent: unknown[] = []
    server.use(
      rpcRows('child_events', [{ id: 'ev-441', event_type: 'match', title: 'League', opponent: 'Rivals FC', event_date: today,
        start_time: '23:30:00', status: 'scheduled', sequence: 0, updated_at: '2026-11-01T00:00:00Z' }]),
      http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () => HttpResponse.json(absent)),
      rpc('report_cant_make_it', body => { sent.push(body); absent = [{ event_id: 'ev-441' }]; return null }),
    )
    renderApp('/parent/home')
    await userEvent.click(await screen.findByRole('button', { name: "Can't make it" }, { timeout: 5000 }))
    const sheet = await screen.findByRole('dialog', { name: "Can't make it" })
    expect(within(sheet).getAllByRole('radio').map(radio => radio.closest('label')?.textContent)).toEqual(['School', 'Family', 'Travel', 'Other'])
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Family' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Tell the coach' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "Can't make it" })).toBeNull())
    expect(sent).toEqual([{ p_event_id: 'ev-441', p_child: CHILD, p_reason: 'family' }])
    // Reported: the line says so and the red button is gone; Undo stays in Details.
    expect(await screen.findByRole('button', { name: /^Match vs Rivals FC, 23:30, Can't make it/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Can't make it" })).toBeNull()
  }, 15_000)

  it('a laptop: the bell is in the top bar, outside the page, and there is one', async () => {
    screenIs(true)
    renderApp('/parent/home')
    await screen.findByRole('navigation', { name: 'Trak' }, { timeout: 5000 })
    await screen.findByRole('region', { name: 'Latest evaluation' })
    const bells = screen.getAllByRole('button', { name: /^Alerts/ })
    expect(bells).toHaveLength(1)
    expect(bells[0].closest('main')).toBeNull()
  }, 15_000)
})
