/**
 * TRAK-289 (Games 7/8): once the coach publishes the evaluation, a guardian's event page shows After the game for their
 * child: the job and how it went against what was asked, and that the coach left the child a note, never the note: the
 * page never asks for it. It's the section the coach's Publish step previews as the parent. The event card says
 * Coach's review. Test people are named after footballers.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import { ParentUpcomingEvents } from '@/components/parent/ParentEvents'
import { GameReviewSection } from '@/components/player/GameReviewSection'
import { evaluationToForm, previewReview } from '@/lib/games/evaluation'
import ParentEvent from '../ParentEvent'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'dellas', email: 'dellas@test.invalid' },
    profile: { full_name: 'Traianos Dellas', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10)
const MATCH = {
  id: 'g1', event_type: 'match', title: 'League', opponent: 'Parkview Athletic', home_away: 'home', event_date: today,
  start_time: '00:01:00', starts_at: `${today}T00:01:00+04:00`, meet_time: null, venue: 'Rehearsal Park', kit: null,
  status: 'scheduled', cancel_reason: null, sequence: 0, family_note: null,
}
const NAMES: Record<string, string> = { zagorakis: 'Theodoros Zagorakis', 'coach-1': 'Otto Rehhagel' }
const REVIEW = { event_id: 'g1', session_id: 's1', squad_player_id: 'zagorakis-squad', our_score: 2, their_score: 1, job: 'Stay tight to their winger.',
  did_job: 'partly', expectation: 'stretch', context: ['out_of_position'], against_expectation: 'above', has_note: true, coach_name: 'Otto Rehhagel',
  published_at: `${today}T08:00:00Z` }
let askedForNote: string[]

beforeEach(() => {
  askedForNote = []
  server.use(
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'zagorakis' }])),
    http.get(endpoint('profiles'), ({ request }) => {
      const asked = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(Object.keys(NAMES).filter(id => asked.includes(id)).map(user_id => ({ user_id, full_name: NAMES[user_id] })))
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.replace(/^eq\./, '')
      return HttpResponse.json(child ? [{ id: `${child}-squad`, coach_user_id: 'coach-1' }] : [])
    }),
    http.get(endpoint('event_absences'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/child_events'), ({ request }) =>
      (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(MATCH) : HttpResponse.json([MATCH])),
    http.get(endpoint('game_for_family'), () => HttpResponse.json([])),
    http.get(endpoint('game_review_for_family'), ({ request }) =>
      (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(REVIEW) : HttpResponse.json([REVIEW])),
    http.get(endpoint('game_review_for_player'), ({ request }) => { askedForNote.push(request.url); return HttpResponse.json([]) }),
  )
})
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

function renderParent(element: JSX.Element, path = '/parent/event/g1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <ParentChildrenProvider><Routes><Route path="/parent/event/:id" element={element} /><Route path="/parent/home" element={element} /></Routes></ParentChildrenProvider>
  </MemoryRouter></QueryClientProvider>)
}

describe('TRAK-289: After the game on a guardian\'s event page', () => {
  it('shows the child\'s job and how it went, and that there\'s a note, never the note, as the coach\'s preview does', async () => {
    renderParent(<ParentEvent />)
    const section = await screen.findByRole('region', { name: 'After the game' })
    expect(within(section).getByText('Theodoros’s job')).toBeInTheDocument()
    expect(within(section).getByText('You did part of your job')).toBeInTheDocument()
    expect(within(section).getByText('Went beyond what we asked.')).toBeInTheDocument()
    expect(within(section).getByText('Coach Otto Rehhagel’s note is just for Theodoros.')).toBeInTheDocument()
    expect(askedForNote).toEqual([])
    const page = section.textContent
    cleanup()

    const form = evaluationToForm({ evaluation: { our_score: 2, their_score: 1, goals: [], how_they_scored: '', plan_worked: [] },
      players: [{ squad_player_id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above' }],
      notes: [{ squad_player_id: 'zagorakis', note: 'Brave all game.' }] })
    const plans = { zagorakis: { role: 'starter' as const, slot: 4, job: 'Stay tight to their winger.', note: '', context: ['out_of_position'], expectation: 'stretch' as const } }
    render(<GameReviewSection as="parent" childName="Theodoros" review={previewReview(form, 'zagorakis', plans, 'Otto Rehhagel', 'parent')} />)
    expect(screen.getByRole('region', { name: 'After the game' }).textContent).toBe(page)
  })

  it('the event card says Coach\'s review', async () => {
    renderParent(<ParentUpcomingEvents />, '/parent/home')
    expect(await screen.findByText('Coach’s review')).toBeInTheDocument()
  })
})
