/**
 * PlayerHome quotes the coach's published words (coach_shared_feedback) and
 * links to this screen. This screen used to read ONLY player_feedback — the
 * T2 AI breakdown a coach approves separately — so a coach who published a
 * note but no AI breakdown produced:
 *
 *   home      "Your coach left feedback: 'Head up earlier when receiving…'"
 *   tap       "Your coach is still writing your feedback."
 *
 * Two screens contradicting each other about the same assessment, one tap
 * apart. These tests pin the tap-through to the same source the card quotes.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'
import PlayerFeedback from '../PlayerFeedback'
import { trackEvent } from '@/lib/telemetry'

vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))
// One object, not one per call: the screen's load effect depends on `user`,
// and a fresh object every render refetches forever and never settles.
const auth = vi.hoisted(() => ({ user: { id: '98000000-0000-4000-8000-000000000001' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))

const assessmentId = '98000000-0000-4000-8000-000000000002'
const COACH_WORDS = 'Head up earlier when receiving. The pass was on twice in the second half.'
const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`

let aiRow: { published_text: string; published_at: string } | null
let sharedReply: { status: number; body: unknown }
let sharedQueries: URLSearchParams[]
let aiReads: number

function renderAt() {
  return render(
    <MemoryRouter initialEntries={[`/player/feedback/${assessmentId}`]}>
      <Routes><Route path="/player/feedback/:assessmentId" element={<PlayerFeedback />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = { id: '98000000-0000-4000-8000-000000000001' }
  // The screen has a DEV-only demo branch that reads the private notes table.
  // Vitest runs with DEV=true, so without this every test here would exercise
  // the demo path and prove nothing about production.
  vi.stubEnv('DEV', false)
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: 'synthetic-player-token' } as never }, error: null,
  })
  aiRow = null
  aiReads = 0
  vi.mocked(trackEvent).mockClear()
  sharedReply = { status: 200, body: { body: COACH_WORDS } }
  sharedQueries = []
  server.use(
    http.get(endpoint('player_feedback'), () => {
      aiReads++
      return aiRow ? HttpResponse.json(aiRow) : HttpResponse.json(null, { status: 406 })
    }),
    http.get(endpoint('coach_shared_feedback'), ({ request }) => {
      sharedQueries.push(new URL(request.url).searchParams)
      return HttpResponse.json(sharedReply.body as never, { status: sharedReply.status })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('PlayerFeedback — the tap-through agrees with the home card', () => {
  it('shows the coach\'s published words when no AI breakdown has been approved', async () => {
    renderAt()
    expect(await screen.findByText(new RegExp(COACH_WORDS.slice(0, 30)))).toBeInTheDocument()
    expect(screen.queryByText(/still writing your feedback/i)).not.toBeInTheDocument()
  })

  it('asks only for published rows of this assessment', async () => {
    renderAt()
    await screen.findByText(new RegExp(COACH_WORDS.slice(0, 30)))
    expect(sharedQueries).toHaveLength(1)
    expect(sharedQueries[0].get('assessment_id')).toBe(`eq.${assessmentId}`)
    expect(sharedQueries[0].get('published_at')).toBe('not.is.null')
  })

  // Control: without this, the first test passes on a screen that shows the
  // coach's words unconditionally — including when nothing is published.
  it('still says "not ready yet" when the coach has published nothing', async () => {
    sharedReply = { status: 406, body: null }
    renderAt()
    expect(await screen.findByText(/still writing your feedback/i)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(COACH_WORDS.slice(0, 30)))).not.toBeInTheDocument()
  })

  // Fail closed, as PlayerHome does: if we cannot confirm the words are still
  // published, neither show them nor claim the coach is still writing.
  it('reports a failure, not "still writing", when the shared read errors', async () => {
    sharedReply = { status: 500, body: { message: 'synthetic failure' } }
    renderAt()
    expect(await screen.findByText(/couldn't load feedback/i)).toBeInTheDocument()
    expect(screen.queryByText(/still writing your feedback/i)).not.toBeInTheDocument()
  })

  it('G7 reads only the coach message even when an old AI publication exists', async () => {
    aiRow = {
      published_text: JSON.stringify({ points: [{ title: 'Scan before receiving', what: 'w', why: 'y', drill: 'd' }], encouragement: 'Keep going.' }),
      published_at: '2026-09-20T10:00:00Z',
    }
    renderAt()
    expect(await screen.findByText(new RegExp(COACH_WORDS.slice(0, 30)))).toBeInTheDocument()
    expect(screen.queryByText('Scan before receiving')).not.toBeInTheDocument()
    expect(aiReads).toBe(0)
  })

  it('retries a failed manual read and records an open only after displaying the message', async () => {
    sharedReply = { status: 500, body: { message: 'synthetic failure' } }
    renderAt()
    await screen.findByText(/couldn't load feedback/i)
    expect(trackEvent).not.toHaveBeenCalled()
    sharedReply = { status: 200, body: { body: COACH_WORDS } }
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(new RegExp(COACH_WORDS.slice(0, 30)))
    await waitFor(() => expect(trackEvent).toHaveBeenCalledWith('feedback_opened', { assessment_id: assessmentId }))
  })

  it('does not count an unpublished message as opened', async () => {
    sharedReply = { status: 406, body: null }
    renderAt()
    await screen.findByText(/still writing your feedback/i)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('uses the same coach-written content in development', async () => {
    vi.stubEnv('DEV', true)
    renderAt()
    expect(await screen.findByText(new RegExp(COACH_WORDS.slice(0, 30)))).toBeInTheDocument()
    expect(aiReads).toBe(0)
  })

  it.each(['withdrawn', 'error'])('clears previously shown words after a same-account refresh returns %s', async result => {
    const view = renderAt()
    await screen.findByText(COACH_WORDS)
    sharedReply = result === 'withdrawn' ? { status: 406, body: null } : { status: 403, body: { message: 'Unavailable' } }
    auth.user = { ...auth.user }
    view.rerender(<MemoryRouter initialEntries={[`/player/feedback/${assessmentId}`]}>
      <Routes><Route path="/player/feedback/:assessmentId" element={<PlayerFeedback />} /></Routes>
    </MemoryRouter>)
    await screen.findByText(result === 'withdrawn' ? /still writing your feedback/i : /couldn't load feedback/i)
    expect(screen.queryByText(COACH_WORDS)).not.toBeInTheDocument()
  })
})
