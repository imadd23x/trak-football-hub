import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { rpc, rpcRows, table, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-401: an evaluation's assessment card on the player's Home says how the objectives went, "Progress: 1 on track,
 * 1 some progress". A session assessment's card says nothing, and asks for no progress.
 */
const row = (id: string, day: string, evaluation_id: string | null) => ({ id, squad_player_id: 'squad-1', coach_user_id: 'coach-1',
  created_at: `2026-10-${day}T10:00:00Z`, work_rate: 7, tactical: 6, attitude: 7, technical: 6, physical: 7, coachability: 8, coach_rating: 7, evaluation_id })
let asked: string[][]

beforeEach(() => {
  localStorage.clear()
  asked = []
  signInAs({ id: 'player-progress' })
  server.use(
    table('profiles', [{ user_id: 'player-progress', role: 'player', full_name: 'Synthetic Player' }]),
    table('matches', []), table('player_details', []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]),
    table('coach_assessments', [row('as-eval', '15', 'eval-1'), row('as-session', '08', null)]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => HttpResponse.json([])),
    rpcRows('child_events', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpcRows('season_plan_for_player', []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/evaluation_progress`, async ({ request }) => {
      asked.push(((await request.json()) as { p_assessments: string[] }).p_assessments)
      return HttpResponse.json([{ assessment_id: 'as-eval', due_on: '2026-10-15', objectives: [
        { id: 'o1', title: 'A', status: 'on_track', history: [] }, { id: 'o2', title: 'B', status: 'some_progress', history: [] }] }])
    }),
  )
})
afterEach(cleanup)

describe('TRAK-401: the Progress line on the player Home assessment card', () => {
  it('says how the objectives went on an evaluation assessment only', async () => {
    renderApp('/player/home')
    const section = await screen.findByRole('region', { name: 'Latest coach assessment' })
    const first = within(section).getByRole('group', { name: 'Assessment 1 of 2' })
    expect(await within(first).findByText('Progress: 1 on track, 1 some progress')).toBeInTheDocument()
    expect(within(section).getAllByText(/^Progress:/)).toHaveLength(1)
    expect(asked).toEqual([['as-eval']])
  })

  // Imad's review of #562: the parent's bell announced a note-less evaluation and the player's stayed silent.
  it("rings the player's bell for an evaluation published without a note", async () => {
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_assessments`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.replace('eq.', '')
      const rows = [row('as-eval', '15', 'eval-1'), row('as-session', '08', null)]
      return HttpResponse.json(id ? rows.filter(item => item.id === id) : rows)
    }))
    renderApp('/player/home')
    await screen.findByRole('region', { name: 'Latest coach assessment' })
    await userEvent.click(await screen.findByRole('button', { name: 'Alerts, 1 unread' }))
    const panel = await screen.findByRole('dialog', { name: 'Alerts' })
    await userEvent.click(within(panel).getByRole('button', { name: /New assessment from / }))
    expect(within(panel).getByText('Your ratings to read.')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Open assessment' }))
    expect(await screen.findByRole('heading', { name: 'Evaluation' })).toBeInTheDocument()
  })
})
