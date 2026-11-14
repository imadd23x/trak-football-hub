/**
 * TRAK-171, live run 3 (16 Oct, Tarek): "New coach assessment" in the player's
 * bell opened this screen, which showed only the coach's message. The bands
 * were on Home alone, so it looked as if they hadn't loaded. The screen now
 * shows that assessment's six bands under the message, as Home does.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'
import PlayerFeedback from '../PlayerFeedback'
import { wasOpened } from '@/lib/games/news'

vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))
const auth = vi.hoisted(() => ({ user: { id: '98171000-0000-4000-8000-000000000001' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))

const assessmentId = '98171000-0000-4000-8000-000000000002'
const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const SCORES = { work_rate: 9, tactical: 7, attitude: 8, technical: 6, physical: 4, coachability: 9 }

let assessmentReply: { status: number; body: unknown }

function renderAt() {
  return render(
    <MemoryRouter initialEntries={[`/player/feedback/${assessmentId}`]}>
      <Routes><Route path="/player/feedback/:assessmentId" element={<PlayerFeedback />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubEnv('DEV', false)
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: 'synthetic-player-token' } as never }, error: null,
  })
  assessmentReply = { status: 200, body: SCORES }
  server.use(
    http.get(endpoint('coach_shared_feedback'), () => HttpResponse.json({ body: 'Keep working on your weak foot.' })),
    http.get(endpoint('coach_assessments'), () => HttpResponse.json(assessmentReply.body as never, { status: assessmentReply.status })),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('TRAK-171: the assessment screen shows its bands', () => {
  it('shows the message and the six bands of that assessment', async () => {
    renderAt()
    expect(await screen.findByText('Keep working on your weak foot.')).toBeInTheDocument()
    const bands = await screen.findByRole('list', { name: 'Your bands' })
    for (const label of ['Work Rate', 'Tactical', 'Attitude', 'Technical', 'Physical', 'Coachability']) {
      expect(bands).toHaveTextContent(label)
    }
  })

  it('says so when the bands could not load, with a way to retry', async () => {
    assessmentReply = { status: 500, body: { message: 'boom' } }
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load feedback")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe("TRAK-441: Home's Latest evaluation stops saying New once this page shows it", () => {
  const opened = () => wasOpened(auth.user.id, auth.user.id, 'evaluation', assessmentId, '2026-01-01T00:00:00Z')

  it('marks it opened when the evaluation shows', async () => {
    localStorage.clear()
    renderAt()
    await screen.findByRole('list', { name: 'Your bands' })
    // The mark is written in an effect after the bands commit; a slow CI runner can check first.
    await waitFor(() => expect(opened()).toBe(true))
  })

  it('not when it could not load', async () => {
    localStorage.clear()
    assessmentReply = { status: 500, body: { message: 'boom' } }
    renderAt()
    await screen.findByRole('alert')
    expect(opened()).toBe(false)
  })
})
