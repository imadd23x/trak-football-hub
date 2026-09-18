import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../msw/server'
import { SUPABASE_URL, table } from '../msw/supabase'
import { signInAs } from '../support/session'
import PlayerHome from '@/pages/player/PlayerHome'

const auth = vi.hoisted(() => ({
  user: { id: 'review-child' },
  profile: { user_id: 'review-child', role: 'player', full_name: 'Synthetic Child' },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/player/PlayerParentInviteCard', () => ({ PlayerParentInviteCard: () => null }))

const publishedText = 'A deliberately published coach message'
let published = true
let sharedReads = 0
let finishedReads = 0

beforeEach(() => {
  published = true; sharedReads = 0; finishedReads = 0
  auth.user = { id: 'review-child' }
  signInAs(auth.user)
  server.use(
    http.post(`${SUPABASE_URL}/rest/v1/rpc/my_consent_status`, () => HttpResponse.json({ required: false })),
    table('matches', []), table('player_details', []),
    table('squad_players', [{ id: 'review-squad', coach_user_id: 'review-coach' }]),
    table('coach_assessments', [{ id: 'review-assessment', coach_user_id: 'review-coach',
      created_at: '2026-09-18T09:00:00Z', work_rate: 6, tactical: 6, attitude: 6,
      technical: 6, physical: 6, coachability: 6 }]),
    table('profiles', [{ full_name: 'Synthetic Coach' }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, ({ request }) => {
      const url = new URL(request.url)
      expect(url.searchParams.get('assessment_id')).toBe('eq.review-assessment')
      expect(url.searchParams.get('published_at')).toBe('not.is.null')
      sharedReads++
      return HttpResponse.json(published ? [{ body: publishedText }] : [])
    }),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => {
      finishedReads++
      return HttpResponse.json([])
    }),
  )
})

it('CONTROL: renders the explicitly published shared text on the player home route', async () => {
  render(<MemoryRouter><PlayerHome /></MemoryRouter>)
  expect(await screen.findByText(`"${publishedText}"`)).toBeVisible()
  expect(sharedReads).toBe(1)
})

it('CONTROL: a fresh player home does not show an unpublished row', async () => {
  published = false
  render(<MemoryRouter><PlayerHome /></MemoryRouter>)
  await waitFor(() => expect(finishedReads).toBe(1))
  expect(screen.queryByText(`"${publishedText}"`)).not.toBeInTheDocument()
})

it('clears previously displayed feedback when a subsequent read finds it retracted', async () => {
  const { rerender } = render(<MemoryRouter><PlayerHome /></MemoryRouter>)
  expect(await screen.findByText(`"${publishedText}"`)).toBeVisible()
  await waitFor(() => expect(finishedReads).toBe(1))
  published = false
  // Auth refresh supplies a fresh object for the same user and reruns the real
  // effect. A completed no-row response must replace the earlier visible value.
  auth.user = { id: 'review-child' }
  rerender(<MemoryRouter><PlayerHome /></MemoryRouter>)
  await waitFor(() => expect(finishedReads).toBe(2))
  expect(sharedReads).toBe(2)
  expect(screen.queryByText(`"${publishedText}"`)).not.toBeInTheDocument()
})
