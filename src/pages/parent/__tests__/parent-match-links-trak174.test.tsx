import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentHome from '../ParentHome'
import ParentMatches from '../ParentMatches'
import ParentAssessment from '../ParentAssessment'
import ParentMatchDetail from '../ParentMatchDetail'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, rpc } from '../../../../tests/msw/supabase'
import userEvent from '@testing-library/user-event'

const auth = vi.hoisted(() => ({ user: { id: 'parent-link' }, profile: { role: 'parent', full_name: 'Synthetic Parent' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ ...auth, signOut: vi.fn(), refreshProfile: vi.fn() }) }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))
const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const clients: QueryClient[] = []
beforeEach(() => {
  server.use(
    // TRAK-286: no shared game plan.
    http.get(endpoint('game_for_family'), () => HttpResponse.json([])),
    http.get(endpoint('game_for_player'), () => HttpResponse.json([])),
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }, { player_user_id: 'Zara' }])),
    http.get(endpoint('profiles'), () => HttpResponse.json([{ user_id: 'Alex', full_name: 'Alex Example' }, { user_id: 'Zara', full_name: 'Zara Example' }])),
    http.get(endpoint('matches'), ({ request }) => {
      const params = new URL(request.url).searchParams
      const child = params.get('user_id')?.slice(3), id = params.get('id')?.slice(3)
      const select = new Set(params.get('select')?.split(',').map(s => s.trim()))
      return HttpResponse.json(['Alex', 'Zara'].flatMap(owner => [true, false].map(linked => ({
        id: `${owner}-${linked ? 'linked' : 'legacy'}`, user_id: owner,
        session_id: linked ? `${owner}-exact-session` : null,
        opponent: `${owner} ${linked ? 'linked' : 'legacy'} match`, created_at: '2026-10-12T10:00:00Z',
        match_date: '2026-10-12', team_score: 1, opponent_score: 0, computed_rating: 8,
        competition: 'League', venue: 'Home', position: 'ST', age_group: 'U19', minutes_played: 90, goals: 0, assists: 0,
      }))).filter(row => (!child || row.user_id === child) && (!id || row.id === id))
        .map(row => Object.fromEntries(Object.entries(row).filter(([key]) => select.has('*') || select.has(key)))))
    }),
    http.get(endpoint('player_details'), () => HttpResponse.json([])),
    http.get(endpoint('squad_players'), ({ request }) => HttpResponse.json([{ id: `roster-${new URL(request.url).searchParams.get('linked_player_id')?.slice(3)}` }])),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const p = new URL(request.url).searchParams
      const child = p.get('squad_player_id')?.includes('Zara') ? 'Zara' : 'Alex'
      const rows = [{ id: `${child}-assessment`, session_id: `${child}-exact-session`, coach_user_id: null,
        created_at: '2026-10-10T10:00:00Z', coach_rating: 7, work_rate: 7, tactical: 7, attitude: 7,
        technical: 7, physical: 7, coachability: 7 }]
      return HttpResponse.json(rows.filter(row => !p.get('session_id') || p.get('session_id') === `eq.${row.session_id}`))
    }),
    http.get(endpoint('recognition_awards'), () => HttpResponse.json([])),
    rpc('family_training_history', () => []), rpc('child_events', () => []),
    rpc('get_children_awaiting_consent', () => []), rpc('get_roster_children_awaiting_consent', () => []),
    rpc('get_my_child_logins', () => []), rpc('get_my_approved_children_awaiting_signup', () => []),
  )
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
describe('TRAK-174 parent match links', () => {
  it('does not show an unselected sibling through a direct match URL', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/parent/match/Zara-linked']}>
      <ParentChildrenProvider><Routes><Route path="/parent/match/:id" element={<ParentMatchDetail />} /></Routes></ParentChildrenProvider>
    </MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('This match is unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('vs Zara linked match')).not.toBeInTheDocument()
  })

  // TRAK-194: parent Home lists no matches, so the Matches tab is where match rows open.
  it('uses an exact session on Matches and preserves legacy match details', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/parent/matches']}>
      <ParentChildrenProvider><Routes>
        <Route path="/parent/home" element={<ParentHome />} />
        <Route path="/parent/matches" element={<ParentMatches />} />
        <Route path="/parent/session/:sessionId/assessment" element={<ParentAssessment />} />
        <Route path="/parent/match/:id" element={<ParentMatchDetail />} />
      </Routes></ParentChildrenProvider>
    </MemoryRouter></QueryClientProvider>)
    expect(await screen.findByRole('link', { name: /Alex linked match/ })).toHaveAttribute('href', '/parent/session/Alex-exact-session/assessment')
    expect(screen.getByRole('link', { name: /Alex legacy match/ })).toHaveAttribute('href', '/parent/match/Alex-legacy')
    await userEvent.click(screen.getByRole('link', { name: /Alex linked match/ }))
    expect(await screen.findByText('Work Rate')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Following'), 'Zara')
    expect(await screen.findByText("Zara Example hasn't been assessed for this session yet.")).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Match details' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Following'), 'Alex')
    await screen.findByText('Work Rate')
    expect(screen.getByRole('link', { name: 'Match details' })).toHaveAttribute('href', '/parent/match/Alex-linked')
    await userEvent.click(screen.getByRole('link', { name: 'Match details' }))
    expect(await screen.findByText('vs Alex linked match')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    await userEvent.click(await screen.findByRole('link', { name: /Alex legacy match/ }))
    expect(await screen.findByText('No assessment link is available for this match.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    await userEvent.selectOptions(screen.getByLabelText('Following'), 'Zara')
    expect(await screen.findByRole('link', { name: /Zara linked match/ })).toHaveAttribute('href', '/parent/session/Zara-exact-session/assessment')
    expect(screen.queryByRole('link', { name: /Alex linked match/ })).not.toBeInTheDocument()
  })
})
