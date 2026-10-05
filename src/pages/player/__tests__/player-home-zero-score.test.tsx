/**
 * TRAK-110 (J6, run 4, 4 Oct): a coach set Attitude and Coachability to 0 for
 * R4 Child B. The child's home showed both as "Mixed" (the bars used
 * `score || 5`, and 0 is falsy). The guardian and coach saw them correctly.
 * The six score columns are NOT NULL, so a 0 is a real score.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-home-zero' }
const ASSESSMENT = { id: 'assessment-zero', squad_player_id: 'squad-1', coach_user_id: 'coach-1', created_at: '2026-10-04T16:30:46Z',
  work_rate: 7, tactical: 9, attitude: 0, technical: 10, physical: 10, coachability: 0, coach_rating: 6 }

beforeEach(() => {
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'R4 Child B' }]),
    table('matches', []), table('player_details', []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]),
    table('coach_assessments', [ASSESSMENT]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => HttpResponse.json(null)),
    table('coach_calendar_events', []), table('recognition_awards', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => cleanup())

const row = async (label: string) => (await screen.findByText(label)).parentElement as HTMLElement
const barWidth = (r: HTMLElement) => (r.querySelector('[style*="width"]') as HTMLElement).style.width

describe('TRAK-110: player home category bars', () => {
  it('shows a 0 as Difficult with an empty bar, not as Mixed', async () => {
    renderApp('/player/home')
    for (const label of ['Attitude', 'Coachability']) {
      const r = await row(label)
      expect(within(r).getByText('Difficult')).toBeInTheDocument()
      expect(within(r).queryByText('Mixed')).toBeNull()
      expect(barWidth(r)).toBe('0%')
    }
  })

  it('still shows a 10 as Exceptional with a full bar', async () => {
    renderApp('/player/home')
    const r = await row('Technical')
    expect(within(r).getByText('Exceptional')).toBeInTheDocument()
    expect(barWidth(r)).toBe('100%')
  })
})
