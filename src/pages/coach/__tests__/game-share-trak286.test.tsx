/**
 * TRAK-286 (Games 4/8): the plan's Share step. Share now waits only for the logistics and the face-to-face tick; it
 * saves what's typed, then shares. Once shared, edits wait for "Share the changes with N", which names who changed.
 * The preview shows what each player and their family read. Needs you and Games home follow: "Plan not shared" goes
 * once shared, "Changes not shared · N players" comes while edits wait. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
// Thu 29 Oct 2026, 19:30 in Dubai.
const SHARED_AT = '2026-10-29T15:30:00Z'
let n = 0
let COACH = { id: 'coach-286' }

function game(id: string, opponent: string, days: number) {
  const kickOff = Math.ceil((Date.now() + days * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `vs ${opponent}`, event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent, home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_theme: null, cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const plan = (event_id: string) => ({
  event_id, strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball in midfield.' }],
  created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
})
const row = (id: string, over: Record<string, unknown>) =>
  ({ event_id: 'g1', squad_player_id: id, role: 'bench', slot: null, job: '', note: '', context: [], expectation: 'usual', ...over })
// Theodoros Zagorakis starts at right-back with a job and a note; Angelos Charisteas is left out with a note.
const LINE_UP = [
  row('zagorakis', { role: 'starter', slot: 4, job: 'Stay tight to their winger.', note: 'Second game at right-back. Proud of you.',
    context: ['out_of_position'], expectation: 'stretch' }),
  row('charisteas', { role: 'not_selected', note: 'Not this week. Your chance comes on Tuesday.' }),
]

/** The plan, its line-up, the share log and who changed, as the database answers; Share appends to the log. */
function store({ shared = false, changes = [] as string[], lineUp = LINE_UP } = {}) {
  const shares = shared ? [{ event_id: 'g1', shared_at: SHARED_AT }] : []
  const calls: { fn: string; body: unknown }[] = []
  server.use(
    table('game_plans', [plan('g1')]),
    table('game_plan_players', lineUp),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      calls.push({ fn: 'save plan', body: await request.json() })
      return new HttpResponse(null, { status: 201 })
    }),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      calls.push({ fn: 'save line-up', body: await request.json() })
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json(shares)),
    rpc('game_plan_changes', () => changes.map(squad_player_id => ({ event_id: 'g1', squad_player_id }))),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/share_game_plan`, async ({ request }) => {
      const body = await request.json()
      calls.push({ fn: 'share', body })
      shares.push({ event_id: 'g1', shared_at: SHARED_AT })
      changes.splice(0)
      return HttpResponse.json(3)
    }),
  )
  return calls
}

beforeEach(() => {
  COACH = { id: `coach-286-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9),
      child('basinas', 'Angelos Basinas', 6), child('nikopolidis', 'Antonios Nikopolidis', 1), child('karagounis', 'Giorgos Karagounis', 10),
    ]),
    // Antonios Nikopolidis can't make it; Giorgos Karagounis waits for consent.
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }]),
    table('event_absences', [{ squad_player_id: 'nikopolidis' }]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'karagounis'),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('coach_calendar_events', [game('g1', 'Parkview Athletic', 5)]),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const shareStep = () => renderApp('/coach/games/g1?tab=plan&step=share')

describe('TRAK-286: the Share step', { timeout: 30_000 }, () => {
  it('Share now waits for the face-to-face tick, saves what is typed, then shares', async () => {
    const user = userEvent.setup()
    const calls = store()
    shareStep()
    const block = await screen.findByRole('region', { name: 'Share the plan' })
    // Who can come or is placed reads it; who can't make it and isn't placed doesn't, nor a child waiting for consent.
    expect(within(block).getByText('3 players and their families, in the app only')).toBeInTheDocument()
    expect(within(block).getByText('1 check before you can share')).toBeInTheDocument()
    expect(within(block).getByText('2 of 4')).toBeInTheDocument()
    const checks = within(block).getByRole('list', { name: 'Before you share' })
    expect(within(checks).getByText('1 of 11 placed. You can share before it’s complete.')).toBeInTheDocument()
    expect(within(checks).getByText('1 of 1 starters have one.')).toBeInTheDocument()
    const shareNow = within(block).getByRole('button', { name: 'Share now' })
    expect(shareNow).toBeDisabled()

    await user.click(within(block).getByRole('checkbox', { name: 'I’ve talked selection through with the players, face to face' }))
    expect(within(block).getByText('Ready to share')).toBeInTheDocument()
    await user.click(shareNow)

    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'share']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1', p_talked: true })
    const shared = await screen.findByRole('region', { name: 'Shared' })
    expect(within(shared).getByText('Shared Thu 19:30')).toBeInTheDocument()
    expect(within(shared).getByText(/Edits stay with you until you share them\./)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Share the plan' })).toBeNull()
  })

  it('edits after sharing wait: the alert names who changed, and Share the changes goes to them without a new tick', async () => {
    const user = userEvent.setup()
    const calls = store({ shared: true, changes: ['charisteas', 'basinas'] })
    shareStep()
    const shared = await screen.findByRole('region', { name: 'Shared' })
    expect(await within(shared).findByText('Changes not shared')).toBeInTheDocument()
    expect(within(shared).getByText(/Angelos Charisteas and Angelos Basinas\. Only they and their families get the update\./)).toBeInTheDocument()
    expect(screen.getAllByText('Changes not shared').length).toBeGreaterThanOrEqual(2) // the header's badge too

    await user.click(within(shared).getByRole('button', { name: 'Share the changes with 2' }))
    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'share']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1', p_talked: false })
    // Nothing left to share: the header says so (the alert's exit animation never finishes in jsdom).
    expect(await screen.findByText('Plan shared')).toBeInTheDocument()
  })

  it('a refusal says why, and keeps everything typed', async () => {
    const user = userEvent.setup()
    store()
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/share_game_plan`, () =>
      HttpResponse.json({ code: 'P0001', message: 'This match has kicked off, so its plan can\'t be shared' }, { status: 400 })))
    shareStep()
    const block = await screen.findByRole('region', { name: 'Share the plan' })
    await user.click(within(block).getByRole('checkbox', { name: /talked selection through/ }))
    await user.click(within(block).getByRole('button', { name: 'Share now' }))
    expect(await within(block).findByRole('alert')).toHaveTextContent('This match has kicked off, so its plan can\'t be shared')
    expect(within(block).getByRole('checkbox', { name: /talked selection through/ })).toBeChecked()
  })

  it('the preview shows what the player and the parent read: the note is the player\'s alone', async () => {
    const user = userEvent.setup()
    store()
    shareStep()
    const preview = await screen.findByRole('region', { name: 'Preview' })
    const section = () => within(preview).getByRole('region', { name: 'Game plan' })
    expect(within(section()).getByText('1 · Win the second ball')).toBeInTheDocument()
    expect(within(section()).getByText('First to every loose ball in midfield.')).toBeInTheDocument()
    expect(within(section()).getByText('Your job')).toBeInTheDocument()
    expect(within(section()).getByText('Stay tight to their winger.')).toBeInTheDocument()
    expect(within(section()).getByRole('heading', { name: 'From Coach Otto Rehhagel · just for you' })).toBeInTheDocument()
    expect(within(section()).getByText('Second game at right-back. Proud of you.')).toBeInTheDocument()

    await user.click(within(preview).getByRole('button', { name: 'As the parent' }))
    expect(within(section()).getByText('Theodoros’s job')).toBeInTheDocument()
    expect(within(section()).getByText('Coach Otto Rehhagel’s note is just for Theodoros.')).toBeInTheDocument()
    expect(within(section()).queryByText('Second game at right-back. Proud of you.')).toBeNull()
    expect(within(section()).queryByText('1 · Win the second ball')).toBeNull()

    // Expectation, context, how strong they are and scouting are never in it.
    expect(preview).not.toHaveTextContent(/Stretch|Out of position|Stronger|Their 9 is quick/)

    await user.click(within(preview).getByRole('combobox', { name: 'Player' }))
    await user.click(await screen.findByRole('option', { name: 'Angelos Charisteas · not selected' }))
    expect(within(section()).getByText('Not in the squad this week')).toBeInTheDocument()
    expect(within(section()).getByText('Coach Otto Rehhagel’s note is just for Angelos.')).toBeInTheDocument()
    await user.click(within(preview).getByRole('button', { name: 'As the player' }))
    expect(within(section()).getByText('Not this week. Your chance comes on Tuesday.')).toBeInTheDocument()
    expect(within(section()).getByText('1 · Win the second ball')).toBeInTheDocument()
    // Who can't make it and isn't placed reads nothing, so isn't in the preview.
    await user.click(within(preview).getByRole('combobox', { name: 'Player' }))
    expect(screen.queryByRole('option', { name: /Antonios Nikopolidis/ })).toBeNull()
    expect(screen.getByRole('option', { name: 'Angelos Basinas · bench' })).toBeInTheDocument()
  })

  it('a starter whose family says they can\'t make it is flagged in Everyone\'s job, and still reads the plan', async () => {
    const user = userEvent.setup()
    store({ lineUp: [...LINE_UP, row('nikopolidis', { role: 'starter', slot: 1, job: 'Command the box on crosses.' })] })
    renderApp('/coach/games/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    const jobs = await screen.findByRole('region', { name: 'Everyone’s job' })
    const keeper = within(jobs).getByRole('button', { name: /Antonios Nikopolidis/ }).closest('li')!
    expect(within(keeper).getByText('Can’t make it')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: Share' }))
    expect(await screen.findByText('4 players and their families, in the app only')).toBeInTheDocument()
  })
})

describe('TRAK-286: Needs you and Games home follow the share', { timeout: 30_000 }, () => {
  function games(changes: Record<string, string[]>) {
    server.use(
      table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3), game('g2', 'Riverside Rovers', 4),
        game('g3', 'Harbour Town', 5), game('g4', 'Northgate United', 6)]),
      // g1 and g2 are shared; g3 is a draft; g4 has no plan.
      table('game_plans', [plan('g1'), plan('g2'), plan('g3')]),
      table('game_plan_players', []),
      table('game_shares', [{ event_id: 'g1', shared_at: SHARED_AT }, { event_id: 'g2', shared_at: SHARED_AT }]),
      rpc('game_plan_changes', ({ p_event_ids }) => (p_event_ids as string[])
        .flatMap(event_id => (changes[event_id] ?? []).map(squad_player_id => ({ event_id, squad_player_id })))),
    )
  }

  it('Needs you: changes not shared for a shared plan with edits, nothing for one without, and the draft\'s next step', async () => {
    games({ g1: ['charisteas', 'basinas'] })
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    const card = (title: string) => within(needs).getByText(title).closest('li')!
    await within(needs).findByText('vs Parkview Athletic')
    expect(within(card('vs Parkview Athletic')).getByText('Changes not shared · 2 players')).toBeInTheDocument()
    expect(within(card('vs Parkview Athletic')).getByRole('link', { name: 'Share the changes' }))
      .toHaveAttribute('href', '/coach/games/g1?tab=plan&step=share')
    expect(within(needs).queryByText('vs Riverside Rovers')).toBeNull()
    expect(within(card('vs Harbour Town')).getByText('Plan not shared')).toBeInTheDocument()
    expect(within(card('vs Harbour Town')).getByRole('link', { name: 'Share the plan' })).toHaveAttribute('href', '/coach/games/g3?tab=plan&step=share')
    expect(within(card('vs Northgate United')).getByRole('link', { name: 'Write the plan' })).toHaveAttribute('href', '/coach/games/g4?tab=plan')
  })

  it('Games home: a shared plan leaves Open drafts; the next game offers Share the changes', async () => {
    const user = userEvent.setup()
    games({ g1: ['charisteas'] })
    renderApp('/coach/games')
    const drafts = await screen.findByRole('region', { name: 'Open drafts' })
    expect(within(drafts).getAllByRole('listitem').map(item => item.textContent)).toEqual([expect.stringContaining('vs Harbour Town')])
    const next = screen.getByRole('region', { name: 'Next game' })
    expect(await within(next).findByText('Changes not shared')).toBeInTheDocument()
    const strip = screen.getByRole('region', { name: 'Your games' })
    expect(within(within(strip).getByRole('link', { name: /Riverside Rovers/ })).getByText('Plan shared')).toBeInTheDocument()
    await user.click(within(next).getByRole('button', { name: 'Share the changes' }))
    expect(window.location.pathname + window.location.search).toBe('/coach/games/g1?tab=plan&step=share')
  })
})
