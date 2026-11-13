/**
 * TRAK-402 (Season plan 18/18 build 7/8): a family reads an evaluation's band, the six ratings and the Progress of each
 * objective, with one quiet line where the note would be. The coach's note is never requested. A session assessment is
 * unchanged and makes no progress request. A failed progress read is said, with a way to retry.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentHome from '../ParentHome'
import ParentAssessment from '../ParentAssessment'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'parent-402', email: 'parent@synthetic.test.invalid' },
  profile: { full_name: 'Synthetic Parent', role: 'parent' },
  signOut: vi.fn(), refreshProfile: vi.fn(),
}) }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const OBJECTIVES = [
  { id: 'o1', title: 'Holds the line together', status: 'on_track', history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'on_track' }] },
  { id: 'o2', title: 'Talks to the keeper at every corner', status: 'some_progress', history: [{ due_on: '2026-11-01', status: 'some_progress' }] },
]
const row = (id: string, evaluation: boolean) => ({
  id, squad_player_id: 'Alex-squad', session_id: evaluation ? null : `${id}-session`, evaluation_id: evaluation ? 'eval-1' : null,
  coach_user_id: 'coach-1', created_at: '2026-11-01T10:00:00Z', coach_rating: 8,
  work_rate: 9, tactical: 7, attitude: 8, technical: 6, physical: 4, coachability: 9,
})

let rows: ReturnType<typeof row>[]
let progressReply: () => Response
let progressBodies: { p_assessments: string[]; p_child?: string }[]
let noteReads: number
const clients: QueryClient[] = []

beforeEach(() => {
  rows = [row('eval-assessment', true)]
  progressBodies = []; noteReads = 0
  progressReply = () => HttpResponse.json([{ assessment_id: 'eval-assessment', due_on: '2026-11-01', objectives: OBJECTIVES }])
  server.use(
    http.get(endpoint('game_for_family'), () => HttpResponse.json([])),
    http.get(endpoint('game_for_player'), () => HttpResponse.json([])),
    http.get(endpoint('game_review_for_family'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/season_plan_for_player'), () => HttpResponse.json([])),
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])),
    http.get(endpoint('profiles'), () => HttpResponse.json([{ user_id: 'Alex', full_name: 'Alex' }])),
    http.get(endpoint('squad_players'), () => HttpResponse.json([{ id: 'Alex-squad' }])),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')
      const found = rows.filter(r => !id || id === `eq.${r.id}`)
      return HttpResponse.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? (found[0] ?? null) : found)
    }),
    http.get(endpoint('coach_shared_feedback'), () => { noteReads++; return HttpResponse.json([{ body: 'PRIVATE NOTE' }]) }),
    http.get(endpoint('player_details'), () => HttpResponse.json([])),
    http.get(endpoint('matches'), () => HttpResponse.json([])),
    http.get(endpoint('recognition_awards'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_roster_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/child_events'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/evaluation_progress'), async ({ request }) => {
      progressBodies.push(await request.json() as { p_assessments: string[]; p_child?: string })
      return progressReply()
    }),
  )
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <ParentChildrenProvider><Routes>
      <Route path="/parent/home" element={<ParentHome />} />
      <Route path="/parent/assessment/:id" element={<ParentAssessment />} />
    </Routes></ParentChildrenProvider>
  </MemoryRouter></QueryClientProvider>)
}

describe("TRAK-402: the family's evaluation", () => {
  it('shows the bands and the Progress with its history, and one line where the note would be', async () => {
    renderAt('/parent/assessment/eval-assessment')
    expect(await screen.findByRole('heading', { name: 'Evaluation' })).toBeInTheDocument()
    const progress = await screen.findByRole('region', { name: 'Progress' })
    expect(within(progress).getByText('Holds the line together')).toBeInTheDocument()
    expect(within(progress).getByText('4 Oct: Not yet, then 1 Nov: On track')).toBeInTheDocument()
    expect(screen.getByText("Your coach's note is for Alex. You see the band, the six ratings and the progress.")).toBeInTheDocument()
    // The guardian's read names the child; the note is never requested or shown.
    expect(progressBodies).toEqual([{ p_assessments: ['eval-assessment'], p_child: 'Alex' }])
    expect(noteReads).toBe(0)
    expect(screen.queryByText(/PRIVATE NOTE/)).toBeNull()
  })

  it('keeps the quiet line and shows no Progress for a child with no objectives', async () => {
    progressReply = () => HttpResponse.json([{ assessment_id: 'eval-assessment', due_on: '2026-11-01', objectives: [] }])
    renderAt('/parent/assessment/eval-assessment')
    expect(await screen.findByText(/Your coach's note is for Alex/)).toBeInTheDocument()
    await waitFor(() => expect(progressBodies.length).toBe(1))
    expect(screen.queryByRole('region', { name: 'Progress' })).toBeNull()
  })

  it('says so when the progress could not load, with a way to retry, and still shows the bands', async () => {
    progressReply = () => HttpResponse.json({ message: 'boom' }, { status: 500 })
    renderAt('/parent/assessment/eval-assessment')
    expect(await screen.findByText("Couldn't load the progress.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
    expect(screen.getByText(/Your coach's note is for Alex/)).toBeInTheDocument()
  })

  it('leaves a session assessment as it was and asks for no progress', async () => {
    rows = [row('session-assessment', false)]
    renderAt('/parent/assessment/session-assessment')
    expect(await screen.findByRole('heading', { name: 'Coach assessment' })).toBeInTheDocument()
    await screen.findByText('Not assessed', {}, { timeout: 200 }).catch(() => undefined)
    expect(screen.queryByRole('region', { name: 'Progress' })).toBeNull()
    expect(screen.queryByText(/Your coach's note is for/)).toBeNull()
    expect(progressBodies).toEqual([])
  })

  it("adds one Progress line to the Home card of an evaluation", async () => {
    renderAt('/parent/home')
    expect(await screen.findByText('Progress: 1 on track, 1 some progress')).toBeInTheDocument()
    expect(progressBodies).toEqual([{ p_assessments: ['eval-assessment'], p_child: 'Alex' }])
  })
})
