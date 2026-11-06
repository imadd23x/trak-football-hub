/**
 * TRAK-362 (Season plan 14/18, spec TRAK-348): match results inside Home's open Season plan card. One row per published
 * match evaluation for the squad this season, newest first, with the date, the opponent and the score, said as Matches
 * home's Previous matches says it. Drafts, cancelled matches, another squad's and last season's never show. Each row
 * starts folded and opens, by keyboard or touch, to how each instruction went; "No instructions" when there were none.
 * The latest three show, and Show all lists the rest. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'
import { instructionsWent, matchResult } from '@/lib/games/results'

let n = 0
let COACH = { id: 'coach-362' }
type Match = { id: string; day: string; opponent: string; squad?: string | null; status?: string }
let matches: Match[] = []
let evaluations: Record<string, unknown>[] = []
let plans: Record<string, unknown>[] = []

const param = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null
/** `event_id=eq.x` or `event_id=in.(x,y)`: the ids asked for, or null for all. */
const ids = (url: URL) => { const raw = url.searchParams.get('event_id'); return raw ? raw.replace(/^(eq\.|in\.\()|\)$/g, '').split(',').map(id => id.replace(/"/g, '')) : null }
const event = (m: Match) => ({
  id: m.id, coach_user_id: COACH.id, event_type: 'match', squad: m.squad === undefined ? 'U16' : m.squad, title: `v ${m.opponent}`,
  published: true, status: m.status ?? 'scheduled', starts_at: `${m.day}T15:00:00Z`, ends_at: `${m.day}T16:30:00Z`, event_date: m.day,
  start_time: '15:00', opponent: m.opponent, home_away: 'home', venue: 'Synthetic Park', competition: 'league',
})
const published = (id: string, our: number, their: number, plan_worked: string[] = []) =>
  ({ event_id: id, saved_at: '2026-11-02T10:00:00Z', published_at: '2026-11-02T10:00:00Z', our_score: our, their_score: their, plan_worked })

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-362-${++n}` }
  // The card starts open, so the results are in view.
  localStorage.setItem(`trak.season-plan-card.${COACH.id}.U16`, 'open')
  matches = [
    { id: 'm-oct', day: '2026-10-10', opponent: 'Synthetic Rovers' },
    { id: 'm-nov', day: '2026-11-01', opponent: 'Synthetic United' },
    { id: 'm-draft', day: '2026-11-03', opponent: 'Synthetic Draft' },
    { id: 'm-cancelled', day: '2026-10-20', opponent: 'Synthetic Cancelled', status: 'cancelled' },
    { id: 'm-u14', day: '2026-10-24', opponent: 'Synthetic Juniors', squad: 'U14' },
    { id: 'm-last-season', day: '2026-05-02', opponent: 'Synthetic Old' },
  ]
  evaluations = [
    published('m-oct', 1, 1, []),
    published('m-nov', 2, 1, ['worked', 'didnt']),
    { ...published('m-draft', 0, 3), published_at: null },
    published('m-cancelled', 4, 0), published('m-u14', 5, 0), published('m-last-season', 0, 2),
  ]
  plans = [{ event_id: 'm-nov', saved_at: '2026-10-30T10:00:00Z', goals: [{ title: 'Press as one', looks_like: '' }, { title: 'Win the second ball', looks_like: '' }] }]
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'pat', coach_user_id: COACH.id, player_name: 'Pat Synthetic', age_group: 'U16', status: 'active', shirt_number: 4,
      position: 'Defender', created_at: '2026-10-01T08:00:00Z', linked_player_id: 'child-pat' }]),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    table('season_plans', [{ id: 'plan-16', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-11-01T10:00:00Z',
      positions_known: 'yes', watch_rule: 't2', last_shared_at: '2026-11-01T10:00:00Z', unshared_parts: [], unshared_players: [] }]),
    table('season_objectives', []),
    table('player_objectives', []),
    table('player_watches', []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json(matches.map(event))),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluations`, ({ request }) => {
      const asked = ids(new URL(request.url))
      return HttpResponse.json(evaluations.filter(e => !asked || asked.includes(e.event_id as string)))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const asked = ids(new URL(request.url))
      return HttpResponse.json(plans.filter(p => !asked || asked.includes(p.event_id as string)))
    }),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('notification_settings', []),
    table('training_notes', []),
    table('game_evaluation_players', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const user = () => userEvent.setup()
const results = async () => {
  const card = await screen.findByRole('region', { name: 'U16 season plan' })
  const heading = await within(card).findByRole('heading', { name: 'Results' })
  return heading.parentElement!
}
const rowButtons = (scope: HTMLElement) => within(scope).getAllByRole('button').filter(b => b.hasAttribute('aria-expanded'))

describe('TRAK-362 results in the Season plan card', () => {
  it('shows only the squad’s published matches this season, newest first, with the score said as Matches home says it', async () => {
    renderApp('/coach/home')
    const list = await results()
    const rows = rowButtons(list)
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/^vs Synthetic United.*Won 2–1$/),
      expect.stringMatching(/^vs Synthetic Rovers.*Drew 1–1$/),
    ])
    for (const gone of ['Synthetic Draft', 'Synthetic Cancelled', 'Synthetic Juniors', 'Synthetic Old']) expect(within(list).queryByText(new RegExp(gone))).toBeNull()
    rows.forEach(r => expect(r).toHaveAttribute('aria-expanded', 'false'))
  }, 30_000)

  it('opens a row by keyboard and by touch to how each instruction went, or "No instructions"', async () => {
    renderApp('/coach/home')
    const list = await results()
    const [united, rovers] = rowButtons(list)
    united.focus()
    await user().keyboard('{Enter}')
    expect(united).toHaveAttribute('aria-expanded', 'true')
    const went = await within(list).findByText('Press as one')
    expect(went.closest('li')).toHaveTextContent('Press as oneWorked')
    expect(within(list).getByText('Win the second ball').closest('li')).toHaveTextContent('Win the second ballDidn’t')

    await user().pointer({ keys: '[TouchA]', target: rovers })
    expect(rovers).toHaveAttribute('aria-expanded', 'true')
    expect(united).toHaveAttribute('aria-expanded', 'false')
    expect(await within(list).findByText('No instructions')).toBeInTheDocument()
  }, 30_000)

  it('shows the latest three, and Show all lists the rest', async () => {
    matches = Array.from({ length: 5 }, (_, i) => ({ id: `m-${i}`, day: `2026-10-0${i + 1}`, opponent: `Synthetic ${i + 1}` }))
    evaluations = matches.map((m, i) => published(m.id, i, 0))
    renderApp('/coach/home')
    const list = await results()
    expect(rowButtons(list).map(r => r.textContent?.match(/Synthetic \d/)?.[0])).toEqual(['Synthetic 5', 'Synthetic 4', 'Synthetic 3'])
    await user().click(within(list).getByRole('button', { name: 'Show all 5' }))
    expect(rowButtons(list)).toHaveLength(5)
  }, 30_000)

  it('says when there is no published match yet', async () => {
    evaluations = []
    renderApp('/coach/home')
    const list = await results()
    expect(within(list).getByText('No published match yet this season.')).toBeInTheDocument()
  }, 30_000)
})

describe('TRAK-362 how a result is said', () => {
  it('says won, drew or lost with the score, or Published before one is in', () => {
    expect(matchResult(2, 1)).toEqual({ label: 'Won 2–1', tone: 'success' })
    expect(matchResult(0, 0)).toEqual({ label: 'Drew 0–0', tone: 'neutral' })
    expect(matchResult(1, 3)).toEqual({ label: 'Lost 1–3', tone: 'danger' })
    expect(matchResult(null, 2)).toEqual({ label: 'Published', tone: 'neutral' })
  })
  it('pairs each instruction with its answer, in order, and skips empty ones', () => {
    expect(instructionsWent([{ title: 'Press as one' }, { title: ' ' }, { title: 'Stay compact' }], ['partly', null, 'worked']))
      .toEqual([{ title: 'Press as one', went: 'Partly', seasonObjectiveId: null }, { title: 'Stay compact', went: 'Worked', seasonObjectiveId: null }])
    expect(instructionsWent(null, null)).toEqual([])
  })
})
