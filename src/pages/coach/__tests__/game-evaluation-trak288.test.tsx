/**
 * TRAK-288 (Games 6/8): the evaluation as a draft. It opens at full time and not before, on the event's instant, with no
 * reload. Result, Team and Players read against the plan as it locked at kick-off; everyone starts at Yes · Met. Save
 * draft · sleep on it saves every step in one go, never publishes, and the draft reloads on every step. Test people
 * are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, within } from '@testing-library/react'
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
let n = 0
let COACH = { id: 'coach-288' }

/** A match that kicked off `ago` ms before now and lasts 90 minutes, on the academy's clock (Dubai, UTC+4). */
function game(ago: number) {
  const kickOff = Date.now() - ago
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: at.slice(11, 19), end_time: null, meet_time: null, competition: 'league',
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_theme: null, cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const PLAN = {
  event_id: 'g1', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: '', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball.' }, { title: 'Press their 6', looks_like: '' }],
  created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
}
// At kick-off: Zagorakis and Dellas started, Charisteas was on the bench (no row: the bench by default), Karagounis left out.
const LINE_UP = [
  { event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight.', note: '', context: ['out_of_position'], expectation: 'stretch' },
  { event_id: 'g1', squad_player_id: 'dellas', role: 'starter', slot: 2, job: 'Win the header.', note: '', context: [], expectation: 'usual' },
  { event_id: 'g1', squad_player_id: 'karagounis', role: 'not_selected', slot: null, job: '', note: '', context: [], expectation: 'usual' },
]
const SAVED_AT = '2026-10-28T17:40:00Z' // 21:40 in Dubai

type Store = { evaluation: Record<string, unknown> | null; players: Record<string, unknown>[]; notes: Record<string, unknown>[] }
let store: Store
let sent: Record<string, unknown>[]

/** The evaluation tables answer with what the last save wrote, as save_game_evaluation would. */
function backend(ago: number, refuse?: string) {
  server.use(
    table('coach_calendar_events', [game(ago)]),
    table('game_plans', [PLAN]),
    table('game_plan_players', LINE_UP),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluations`, () => HttpResponse.json(store.evaluation ? [store.evaluation] : [])),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluation_players`, () => HttpResponse.json(store.players)),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluation_notes`, () => HttpResponse.json(store.notes)),
    rpc('save_game_evaluation', args => {
      sent.push(args)
      if (refuse) return { status: 400, body: { code: 'P0001', message: refuse } }
      const players = args.p_players as { id: string; played: boolean; did_job?: string; against_expectation?: string; note?: string }[]
      store = {
        evaluation: { our_score: args.p_our_score, their_score: args.p_their_score, goals: args.p_goals, how_they_scored: args.p_how_they_scored,
          plan_worked: args.p_plan_worked, saved_at: SAVED_AT, published_at: null },
        players: players.map(p => ({ squad_player_id: p.id, played: p.played, did_job: p.did_job ?? 'yes', against_expectation: p.against_expectation ?? 'met' })),
        notes: players.filter(p => p.note).map(p => ({ squad_player_id: p.id, note: p.note })),
      }
      return SAVED_AT
    }),
  )
}

beforeEach(() => {
  COACH = { id: `coach-288-${++n}` }
  store = { evaluation: null, players: [], notes: [] }
  sent = []
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('dellas', 'Traianos Dellas', 5),
      child('charisteas', 'Angelos Charisteas', 9), child('karagounis', 'Giorgos Karagounis', 10)]),
    table('event_confirmations', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('training_plans', []),
    table('game_shares', [{ event_id: 'g1', shared_at: '2026-10-27T15:30:00Z' }]),
    rpc('game_plan_changes', () => []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear() })

const next = (label: string) => userEvent.click(screen.getByRole('button', { name: label }))
/** A player's card. jsdom ignores `inert`, so a closed card's fields are still found: ask inside the open one. */
const cardOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('article') as HTMLElement

describe('TRAK-288: the evaluation draft', { timeout: 30_000 }, () => {
  it('opens at full time and not before, with the page left open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    backend(89 * MINUTE) // full time in a minute
    renderApp('/coach/games/g1?tab=evaluation')
    expect(await screen.findByRole('heading', { name: /^Opens at full time, \d\d:\d\d$/ })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Our score' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save draft/ })).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })

    expect(await screen.findByRole('spinbutton', { name: 'Our score' })).toBeInTheDocument()
    expect(screen.getByText('Full time')).toBeInTheDocument()
  })

  it('lists who played from the plan as it locked: starters ticked, the bench unticked, nobody left out', async () => {
    backend(120 * MINUTE)
    renderApp('/coach/games/g1?tab=evaluation')
    const played = await screen.findByRole('region', { name: 'Who played' })
    expect(within(within(played).getByRole('group', { name: 'Started' })).getAllByRole('checkbox').map(box => box.getAttribute('aria-checked')))
      .toEqual(['true', 'true'])
    expect(within(played).getByRole('checkbox', { name: 'Traianos Dellas' })).toBeChecked()
    expect(within(within(played).getByRole('group', { name: 'Came on' })).getByRole('checkbox', { name: 'Angelos Charisteas' })).not.toBeChecked()
    expect(within(played).queryByRole('checkbox', { name: 'Giorgos Karagounis' })).toBeNull()
  })

  it('everyone who played starts at Yes · Met, beside the context and expectation from the plan', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/games/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    await next('Next: Team')
    await next('Next: Players')
    const card = screen.getByRole('button', { name: /^Theodoros Zagorakis/ })
    expect(card).toHaveTextContent('Did the job · Met')
    expect(card).toHaveTextContent('Out of position')
    expect(card).toHaveTextContent('Expected: Stretch')
    expect(screen.getByRole('button', { name: /^Traianos Dellas/ })).toHaveTextContent('Expected: Usual')
    // Charisteas didn't come on, so there's no card for him.
    expect(screen.queryByRole('button', { name: /^Angelos Charisteas/ })).toBeNull()
    await user.click(card)
    const open = cardOf('Theodoros Zagorakis')
    expect(within(within(open).getByRole('group', { name: 'Did the job' })).getByRole('radio', { name: 'Yes' })).toBeChecked()
    expect(within(within(open).getByRole('group', { name: 'Against expectation' })).getByRole('radio', { name: 'Met' })).toBeChecked()
  })

  it('saves every step in one draft that only the coach sees, and it reloads on every step', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/games/g1?tab=evaluation')
    // Result: 2–1, Zagorakis scored the first, Dellas didn't play, Charisteas came on.
    await user.click(await screen.findByRole('button', { name: 'Increase Our score' }))
    await user.click(screen.getByRole('button', { name: 'Increase Our score' }))
    await user.click(screen.getByRole('button', { name: 'Increase Their score' }))
    const goals = screen.getAllByRole('group', { name: /^Goal \d$/ })
    expect(goals).toHaveLength(2)
    await user.click(within(goals[0]).getByRole('combobox', { name: 'Scored by' }))
    await user.click(await screen.findByRole('option', { name: 'Theodoros Zagorakis' }))
    await user.click(screen.getByRole('checkbox', { name: 'Traianos Dellas' }))
    await user.click(screen.getByRole('checkbox', { name: 'Angelos Charisteas' }))
    await user.type(screen.getByRole('textbox', { name: 'How their goals came' }), 'A corner at the back post.')
    // Team: the first goal worked.
    await next('Next: Team')
    await user.click(within(screen.getByRole('group', { name: 'Win the second ball' })).getByRole('radio', { name: 'Worked' }))
    expect(screen.getByRole('group', { name: 'Press their 6' })).toBeInTheDocument()
    // Players: Zagorakis did part of the job, above what was expected, with a note.
    await next('Next: Players')
    expect(screen.queryByRole('button', { name: /^Traianos Dellas/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Theodoros Zagorakis/ }))
    const open = cardOf('Theodoros Zagorakis')
    await user.click(within(within(open).getByRole('group', { name: 'Did the job' })).getByRole('radio', { name: 'Partly' }))
    await user.click(within(within(open).getByRole('group', { name: 'Against expectation' })).getByRole('radio', { name: 'Above' }))
    await user.type(within(open).getByRole('textbox', { name: 'Note to Theodoros · only Theodoros, not the family' }), 'Brave all game.')
    expect(screen.getByRole('button', { name: /^Theodoros Zagorakis/ })).toHaveTextContent('Did part of the job · Above')

    await user.click(screen.getByRole('button', { name: 'Save draft · sleep on it' }))
    expect(await screen.findByText('Draft saved 21:40')).toBeInTheDocument()
    expect(screen.getByText('Only you can see it.')).toBeInTheDocument()
    expect(screen.getByText('Evaluation draft')).toBeInTheDocument()
    expect(sent).toEqual([{
      p_event_id: 'g1', p_our_score: 2, p_their_score: 1, p_how_they_scored: 'A corner at the back post.', p_plan_worked: ['worked', null],
      p_goals: [{ scorer: 'zagorakis', assist: null }, { scorer: null, assist: null }],
      p_players: [
        { id: 'dellas', played: false },
        { id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above', note: 'Brave all game.' },
        { id: 'charisteas', played: true, did_job: 'yes', against_expectation: 'met', note: '' },
      ],
    }])

    // A reload shows the draft on every step.
    cleanup()
    renderApp('/coach/games/g1?tab=evaluation')
    expect(await screen.findByText('Draft saved 21:40')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Our score' })).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByRole('spinbutton', { name: 'Their score' })).toHaveAttribute('aria-valuenow', '1')
    expect(within(screen.getAllByRole('group', { name: /^Goal \d$/ })[0]).getByRole('combobox', { name: 'Scored by' })).toHaveTextContent('Theodoros Zagorakis')
    expect(screen.getByRole('checkbox', { name: 'Traianos Dellas' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Angelos Charisteas' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'How their goals came' })).toHaveValue('A corner at the back post.')
    await next('Next: Team')
    expect(within(screen.getByRole('group', { name: 'Win the second ball' })).getByRole('radio', { name: 'Worked' })).toBeChecked()
    await next('Next: Players')
    expect(screen.getByRole('button', { name: /^Theodoros Zagorakis/ })).toHaveTextContent('Did part of the job · Above')
    expect(screen.getByRole('button', { name: /^Angelos Charisteas/ })).toHaveTextContent('Did the job · Met')
    await user.click(screen.getByRole('button', { name: /^Theodoros Zagorakis/ }))
    expect(screen.getByRole('textbox', { name: 'Note to Theodoros · only Theodoros, not the family' })).toHaveValue('Brave all game.')
  })

  it('a refused save keeps everything entered and says why', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE, 'This evaluation is published, so it can’t change')
    renderApp('/coach/games/g1?tab=evaluation')
    await user.click(await screen.findByRole('button', { name: 'Increase Our score' }))
    await user.click(screen.getByRole('button', { name: 'Save draft · sleep on it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This evaluation is published, so it can’t change')
    expect(screen.getByRole('spinbutton', { name: 'Our score' })).toHaveAttribute('aria-valuenow', '1')
  })
})
