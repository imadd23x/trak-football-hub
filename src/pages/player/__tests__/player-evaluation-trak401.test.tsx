/**
 * TRAK-401 (Season plan 18/18 build 6/8): the player's evaluation page shows the band and the six ratings, the Progress
 * of each objective ("4 Oct: Not yet, then 1 Nov: On track") and the coach's note, which is the player's alone. A session
 * assessment is unchanged and makes no progress request. A failed progress read is said, not hidden.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'
import PlayerFeedback from '../PlayerFeedback'

vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))
const auth = vi.hoisted(() => ({ user: { id: '40100000-0000-4000-8000-000000000001' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))

const assessmentId = '40100000-0000-4000-8000-000000000002'
const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const SCORES = { work_rate: 9, tactical: 7, attitude: 8, technical: 6, physical: 4, coachability: 9 }
const OBJECTIVES = [
  { id: 'o1', title: 'Holds the line together', status: 'on_track', history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'on_track' }] },
  { id: 'o2', title: 'Talks to the keeper at every corner', status: 'some_progress', history: [{ due_on: '2026-11-01', status: 'some_progress' }] },
]

let evaluationId: string | null
let note: { body: string } | null
let progressReply: () => Response
let progressCalls: number

function renderAt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/player/feedback/${assessmentId}`]}>
        <Routes><Route path="/player/feedback/:assessmentId" element={<PlayerFeedback />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubEnv('DEV', false)
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: 'synthetic-player-token' } as never }, error: null,
  })
  evaluationId = 'eval-1'
  note = { body: 'Strong month. Keep talking at corners.' }
  progressCalls = 0
  progressReply = () => HttpResponse.json([{ assessment_id: assessmentId, due_on: '2026-11-01', objectives: OBJECTIVES }])
  server.use(
    http.get(endpoint('coach_shared_feedback'), () => HttpResponse.json(note ?? [])),
    http.get(endpoint('coach_assessments'), () => HttpResponse.json({ ...SCORES, evaluation_id: evaluationId })),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/evaluation_progress`, () => { progressCalls += 1; return progressReply() }),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe("TRAK-401: the player's evaluation", () => {
  it('shows the bands, the Progress with its history, and the coach note for the player only', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Evaluation' })).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Your bands' })).toBeInTheDocument()
    const progress = await screen.findByRole('region', { name: 'Progress' })
    expect(within(progress).getByText('Holds the line together')).toBeInTheDocument()
    expect(within(progress).getByText('4 Oct: Not yet, then 1 Nov: On track')).toBeInTheDocument()
    expect(within(progress).getByText('On track')).toBeInTheDocument()
    expect(within(progress).getByText('Some progress')).toBeInTheDocument()
    // One word at the first evaluation: no history line.
    expect(within(progress).queryByText(/then/)).toHaveTextContent('4 Oct: Not yet, then 1 Nov: On track')
    const noteBlock = screen.getByRole('region', { name: 'From your coach' })
    expect(noteBlock).toHaveTextContent('From your coach, only you see this')
    expect(noteBlock).toHaveTextContent('Strong month. Keep talking at corners.')
  })

  it('does not say the coach is still writing when an evaluation has no note', async () => {
    note = null
    renderAt()
    expect(await screen.findByRole('region', { name: 'Progress' })).toBeInTheDocument()
    expect(screen.queryByText(/still writing/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'From your coach' })).toBeNull()
  })

  it('says so when the progress could not load, with a way to retry', async () => {
    progressReply = () => HttpResponse.json({ message: 'boom' }, { status: 500 })
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your progress")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'From your coach' })).toBeInTheDocument()
  })

  it('leaves a session assessment as it was and asks for no progress', async () => {
    evaluationId = null
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Coach feedback' })).toBeInTheDocument()
    expect(await screen.findByText('Strong month. Keep talking at corners.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Progress' })).toBeNull()
    expect(progressCalls).toBe(0)
  })
})
