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
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'
import PlayerFeedback from '../PlayerFeedback'

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

function renderAt() {
  render(
    <MemoryRouter initialEntries={[`/player/feedback/${assessmentId}`]}>
      <Routes><Route path="/player/feedback/:assessmentId" element={<PlayerFeedback />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // The screen has a DEV-only demo branch that reads the private notes table.
  // Vitest runs with DEV=true, so without this every test here would exercise
  // the demo path and prove nothing about production.
  vi.stubEnv('DEV', false)
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: 'synthetic-player-token' } as never }, error: null,
  })
  aiRow = null
  sharedReply = { status: 200, body: { body: COACH_WORDS } }
  sharedQueries = []
  server.use(
    http.get(endpoint('player_feedback'), () =>
      aiRow ? HttpResponse.json(aiRow) : HttpResponse.json(null, { status: 406 })),
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

  it('prefers the approved AI breakdown when there is one', async () => {
    aiRow = {
      published_text: JSON.stringify({ points: [{ title: 'Scan before receiving', what: 'w', why: 'y', drill: 'd' }], encouragement: 'Keep going.' }),
      published_at: '2026-09-20T10:00:00Z',
    }
    renderAt()
    expect(await screen.findByText('Scan before receiving')).toBeInTheDocument()
  })
})
