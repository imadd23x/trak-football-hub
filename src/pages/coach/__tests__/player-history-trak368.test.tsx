/**
 * TRAK-368 (Season plan 3/18 follow-up, Tarek 4 Nov): a player's whole assessment history is on their own page.
 * The page shows the latest six; "All N" shows every one in place, each the same card with Edit and Publish, and
 * the address remembers it, so coming back (or a reload) finds the whole list open. The old /coach/player/:id
 * redirects here. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

vi.mock('recharts', async importOriginal => {
  const recharts = await importOriginal<typeof import('recharts')>()
  const { cloneElement } = await import('react')
  return {
    ...recharts,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      <div style={{ width: 800, height: 220 }}>{cloneElement(children, { width: 800, height: 220 } as never)}</div>,
  }
})

let COACH = { id: 'coach-368' }
let n = 0
const scores = { work_rate: 6, tactical: 6, attitude: 7, technical: 6, physical: 7, coachability: 8 }
/** Eight of Bo's assessments, newest first: 1 Oct back to 8 Sep. */
const history = () => Array.from({ length: 8 }, (_, i) => ({
  id: `as-${i + 1}`, coach_user_id: COACH.id, squad_player_id: 'sq-bo',
  created_at: i === 0 ? '2026-10-01T10:00:00Z' : `2026-09-${String(30 - i * 3).padStart(2, '0')}T10:00:00Z`,
  published_at: '2026-10-01T11:00:00Z', appearance: null, ...scores, coach_sessions: { title: `Synthetic session ${i + 1}`, session_date: '2026-09-01' },
}))

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-368-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach' }]),
    table('coach_details', []),
    table('squad_players', [{ id: 'sq-bo', coach_user_id: COACH.id, player_name: 'Bo Synthetic', position: 'Attacker', shirt_number: 9, age_group: 'U16', status: 'active', created_at: '2026-09-01T08:00:00Z' }]),
    table('coach_assessments', history()),
    table('coach_assessment_notes', []),
    table('coach_shared_feedback', []),
    table('coach_sessions', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => false),
    rpc('coach_squad_season', () => []),
    table('squad_player_profiles', []),
    rpcRows('coach_player_birth_dates', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const cards = () => within(screen.getByRole('region', { name: 'Assessments' })).getAllByRole('article')

describe("TRAK-368 a player's whole history on their own page", () => {
  it('shows the latest six, then every assessment in place, and folds back', async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad/player/sq-bo')
    await user.click(await screen.findByRole('button', { name: 'All 8' }))
    await waitFor(() => expect(cards()).toHaveLength(8))
    expect(window.location.search).toBe('?history=all')
    expect(within(cards()[7]).getByRole('button', { name: 'Published more actions' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show the latest 6' }))
    await waitFor(() => expect(cards()).toHaveLength(6))
    expect(window.location.search).toBe('')
  }, 30_000)

  it('opens with the whole list when the address says so, as after coming back or a reload', async () => {
    renderApp('/coach/squad/player/sq-bo?history=all')
    await waitFor(() => expect(cards()).toHaveLength(8))
    expect(screen.getByRole('button', { name: 'Show the latest 6' })).toBeInTheDocument()
  })

  it('sends an old /coach/player/:id link to the player\'s own page', async () => {
    renderApp('/coach/player/sq-bo')
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/sq-bo'))
    expect(await screen.findByRole('region', { name: 'About Bo' })).toBeInTheDocument()
  })
})
