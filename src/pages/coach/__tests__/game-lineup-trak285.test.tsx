/**
 * TRAK-285 (Games 3/8): plan step 2, line-up and jobs. "Can't make it" players can't be placed; a slot holds one player
 * and a player one slot; bench and not selected come back after a reload; the progress counts starters with a job. A
 * child waiting for consent is nowhere. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-285' }

function game() {
  const kickOff = Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_theme: null, cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number, age_group = 'U16') =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group, status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })

/** The plan and its line-up as the database keeps them, written by the app's upserts. */
function store() {
  const plans = new Map<string, Record<string, unknown>>()
  const lineUp = new Map<string, Record<string, unknown>>()
  const saves: Record<string, unknown>[][] = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, () => HttpResponse.json([...plans.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      plans.set(body.event_id as string, { ...body, created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z' })
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => HttpResponse.json([...lineUp.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      const rows = await request.json() as Record<string, unknown>[]
      saves.push(rows)
      for (const row of rows) lineUp.set(row.squad_player_id as string, row)
      return new HttpResponse(null, { status: 201 })
    }),
  )
  return { saves }
}

beforeEach(() => {
  COACH = { id: `coach-285-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9),
      child('karagounis', 'Giorgos Karagounis', 10), child('nikopolidis', 'Antonios Nikopolidis', 1),
      child('basinas', 'Angelos Basinas', 6), child('katsouranis', 'Kostas Katsouranis', 8, 'U14'),
    ]),
    // Zagorakis is confirmed; Nikopolidis's family said he can't make it; Karagounis waits for consent.
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }]),
    table('event_absences', [{ squad_player_id: 'nikopolidis' }]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'karagounis'),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('coach_calendar_events', [game()]),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

async function openLineUp(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/coach/games/g1?tab=plan')
  await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
  return screen.findByRole('heading', { name: '4-4-2' })
}
const slot = (number: number) => screen.getByRole('button', { name: new RegExp(`slot ${number}(,|$)`, 'i') })
async function pick(user: ReturnType<typeof userEvent.setup>, slotNumber: number, name: RegExp) {
  await user.click(slot(slotNumber))
  await user.click(screen.getByRole('combobox', { name: 'Who plays here?' }))
  await user.click(await screen.findByRole('option', { name }))
}
const jobs = () => screen.getByRole('region', { name: 'Everyone’s job' })

describe('TRAK-285: plan step 2, line-up and jobs', { timeout: 30_000 }, () => {
  it('lists who can come, Confirmed first; "Can\'t make it" can\'t be placed, and a child waiting for consent is nowhere', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await user.click(slot(1))
    await user.click(screen.getByRole('combobox', { name: 'Who plays here?' }))
    const options = await screen.findAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'Theodoros Zagorakis', 'Angelos Basinas · not confirmed', 'Angelos Charisteas · not confirmed', "Antonios Nikopolidis · can't make it",
    ])
    expect(options[3]).toHaveAttribute('aria-disabled', 'true')
    await user.click(options[3])
    expect(slot(1)).toHaveAccessibleName('Slot 1, empty')
    expect(screen.queryByText(/Karagounis/)).toBeNull()
    expect(screen.queryByText(/Katsouranis/)).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Can’t make it' })).getByText('Antonios Nikopolidis')).toBeInTheDocument()
  })

  it('a slot holds one player and a player one slot', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 1, /^Theodoros Zagorakis/)
    expect(slot(1)).toHaveAccessibleName('Theodoros Zagorakis, slot 1')

    // A filled slot opens its player's sheet: nobody can be dropped on top of them.
    await user.click(slot(1))
    expect(screen.queryByRole('combobox', { name: 'Who plays here?' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Theodoros Zagorakis' })).toBeInTheDocument()

    // Picking a player already on the pitch for another slot moves them.
    await pick(user, 2, /^Theodoros Zagorakis · on the pitch/)
    expect(slot(1)).toHaveAccessibleName('Slot 1, empty')
    expect(slot(2)).toHaveAccessibleName('Theodoros Zagorakis, slot 2')

    await user.click(screen.getByRole('button', { name: 'Take off the pitch' }))
    expect(slot(2)).toHaveAccessibleName('Slot 2, empty')
    expect(within(jobs()).getByRole('button', { name: /Theodoros Zagorakis/ })).toHaveTextContent('Bench')
  })

  it('bench and not selected come back after a reload; a player left out keeps only a note', async () => {
    const user = userEvent.setup()
    const { saves } = store()
    await openLineUp(user)
    await user.click(within(jobs()).getByRole('button', { name: /Angelos Charisteas/ }))
    await user.click(screen.getByRole('radio', { name: 'Not selected' }))
    expect(screen.queryByLabelText(/^Job/)).toBeNull()
    await user.type(screen.getByLabelText('Note to Angelos · only Angelos, not the family'), 'Not this week. Your chance comes Tuesday.')
    await user.click(within(jobs()).getByRole('button', { name: /Angelos Basinas/ }))
    await user.type(screen.getByLabelText('Job · Angelos and family see it'), 'Be ready to come on at half-time.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves.at(-1)).toEqual([
      { event_id: 'g1', squad_player_id: 'charisteas', role: 'not_selected', slot: null, job: '', note: 'Not this week. Your chance comes Tuesday.', context: [], expectation: 'usual' },
      { event_id: 'g1', squad_player_id: 'basinas', role: 'bench', slot: null, job: 'Be ready to come on at half-time.', note: '', context: [], expectation: 'usual' },
    ])

    cleanup()
    await openLineUp(user)
    const leftOut = screen.getByRole('region', { name: 'Not selected' })
    await user.click(within(leftOut).getByRole('button', { name: /Angelos Charisteas/ }))
    expect(screen.getByRole('radio', { name: 'Not selected' })).toBeChecked()
    expect(screen.getByLabelText('Note to Angelos · only Angelos, not the family')).toHaveValue('Not this week. Your chance comes Tuesday.')
    expect(within(jobs()).getByRole('button', { name: /Angelos Basinas/ }).closest('li')).toHaveTextContent('Be ready to come on at half-time.')
  })

  it('counts the starters with a job', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 1, /^Theodoros Zagorakis/)
    await user.type(screen.getByLabelText('Job · Theodoros and family see it'), 'Command the box on crosses.')
    await pick(user, 2, /^Angelos Basinas/)
    const progress = screen.getByRole('progressbar', { name: '1 of 11 starters have a job' })
    expect(progress).toHaveAttribute('aria-valuenow', '1')
    expect(progress).toHaveAttribute('aria-valuemax', '11')
  })
})
