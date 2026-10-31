import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expectSquadPicked, pickSquad, squadsOffered } from '../../../../tests/support/squad-switcher'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

/**
 * TRAK-197 (Kostas's 16 Oct list, items 9 + 10) and TRAK-196 (item 8): coach
 * Home is one quiet line, the week and two quick actions. TRAK-211 moved the
 * Player overview to its own coach tab, Feedback and assessment: every player,
 * most urgent first. With two squads both follow the squad picked (Imad, 18 Oct).
 */
const NOW = new Date('2026-11-30T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
const JOINED = '2026-10-20T08:00:00Z'
let coach = 0
let COACH = { id: 'coach-197-0' }

const player = (id: string, name: string, age_group = 'U16') =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group, status: 'active', created_at: JOINED })
// Four Monday trainings, newest first; t1's event had a "Can't make it".
const TRAININGS = ['2026-11-23', '2026-11-16', '2026-11-09', '2026-11-02']
  .map((session_date, i) => ({ id: `t${i + 1}`, coach_user_id: COACH.id, session_type: 'training', session_date, event_id: i === 0 ? 'e1' : null, squad: null }))

type Row = Record<string, unknown>
function home(over: { players: ReturnType<typeof player>[]; assessments?: Row[]; present?: [string, string][]; absences?: Row[]; details?: Row; settings?: Row[] }) {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Angelos Basinas', invite_code: 'ABCD' }]),
    table('coach_details', [over.details ?? { user_id: COACH.id, coach_role: 'Head Coach', team: 'U16s', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Synthetic Athens' }]),
    table('squad_players', over.players),
    table('coach_assessments', over.assessments ?? []),
    table('coach_sessions', TRAININGS.map(t => ({ ...t, coach_user_id: COACH.id }))),
    table('session_attendance', (over.present ?? []).map(([session_id, squad_player_id]) => ({ session_id, squad_player_id }))),
    table('event_absences', over.absences ?? []),
    table('coach_calendar_events', []),
    table('notification_settings', over.settings ?? []),
    rpc('coach_squad_player_consent_required', () => false),
    // TRAK-304: with Training or Games on, Today takes Squad shape's place; these tests are Home without them.
    rpc('feature_on', ({ p_feature }) => p_feature === 'events'),
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
}
// Everyone in `ids` came to every training, so each register counts as taken.
const cameToAll = (...ids: string[]) => TRAININGS.flatMap(t => ids.map(id => [t.id, id] as [string, string]))
const overview = () => screen.getByRole('region', { name: 'Feedback and assessment' })
// The first look waits for the lazy tab to load.
const region = () => screen.findByRole('region', { name: 'Feedback and assessment' }, { timeout: 5000 })
// Each row is a button (it opens the player); its name starts "Open <name>'s profile".
const rows = () => within(overview()).getAllByRole('button', { name: /^Open .*'s profile/ })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // A fresh coach each test: the app's query cache outlives a test and would keep the last one's squads.
  COACH = { id: `coach-197-${++coach}` }
  signInAs(COACH)
})
afterEach(() => { vi.useRealTimers(); cleanup(); forgetScreens(); localStorage.clear() })

describe('Home under the header (Imad, 23 Oct: no role and academy line)', () => {
  it('has no role or academy line, no greeting, no chips and no season card', async () => {
    home({ players: [player('a', 'Ade Okafor')], assessments: [{ squad_player_id: 'a', created_at: daysAgo(1) }], present: cameToAll('a') })
    renderApp('/coach/home')
    expect(await screen.findByRole('region', { name: 'Squad shape' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText(/Head Coach|Synthetic Athens/)).toBeNull()
    expect(screen.queryByText(/^Good (morning|afternoon|evening)/)).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
    for (const gone of ['THIS SEASON', 'Players in squad', 'Squad bands', 'RECENT ASSESSMENTS', 'Squad Overview', 'Coach Assistant']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })
})

describe('TRAK-211: the Feedback and assessment tab', { timeout: 20_000 }, () => {
  it('lists the most urgent first, says each level in words, and why', async () => {
    home({
      players: [player('ok', 'Olly Steady'), player('warn', 'Wes Late'), player('urg', 'Uma Away')],
      assessments: ['ok', 'warn', 'urg'].map(id => ({ squad_player_id: id, created_at: daysAgo(2) })),
      // Uma missed t1–t3; Wes missed only the last; Olly came to all.
      present: [...cameToAll('ok'), ['t2', 'warn'], ['t3', 'warn'], ['t4', 'warn'], ['t4', 'urg']],
    })
    renderApp('/coach/feedback')
    await region()
    await waitFor(() => expect(rows()).toHaveLength(3), { timeout: 5000 })
    expect(rows().map(r => within(r).getByText(/^(Urgent|Warning|On track)$/).textContent)).toEqual(['Urgent', 'Warning', 'On track'])
    expect(within(rows()[0]).getByText('Uma Away')).toBeInTheDocument()
    expect(within(rows()[0]).getByText('Missed 3 of the last 4 trainings')).toBeInTheDocument()
    expect(within(rows()[1]).getByText('Missed the last training')).toBeInTheDocument()
    expect(within(rows()[2]).getByText('Assessed 2 days ago')).toBeInTheDocument()
  })

  it("shows the Can't make it reason to the coach", async () => {
    home({
      players: [player('a', 'Ade Okafor')],
      assessments: [{ squad_player_id: 'a', created_at: daysAgo(2) }],
      present: [['t1', 'x'], ['t2', 'a'], ['t3', 'a'], ['t4', 'a']],
      absences: [{ event_id: 'e1', squad_player_id: 'a', reason: 'Ill' }],
    })
    renderApp('/coach/feedback')
    expect(await within(await region()).findByText("Missed the last training (Can't make it: Ill)")).toBeInTheDocument()
  })

  it('lists every player, not just the first 5', async () => {
    const players = Array.from({ length: 8 }, (_, i) => player(`p${i}`, `Player ${i}`))
    // Nobody assessed for 5 weeks: all 8 are Urgent.
    home({ players, assessments: players.map(p => ({ squad_player_id: p.id, created_at: daysAgo(35) })), present: cameToAll(...players.map(p => p.id)) })
    renderApp('/coach/feedback')
    await region()
    await waitFor(() => expect(rows()).toHaveLength(8), { timeout: 5000 })
    expect(within(rows()[0]).getByText('No assessment for 5 weeks')).toBeInTheDocument()
    expect(within(overview()).queryByRole('link')).toBeNull()
  })

  // TRAK-259 (Imad, 22 Oct): Feedback left the coach's nav; the page still opens.
  it('opens by its address, and its heading says Feedback and assessment', async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a') })
    renderApp('/coach/feedback')
    expect(await screen.findByRole('heading', { level: 1, name: 'Feedback and assessment' }, { timeout: 5000 })).toBeInTheDocument()
    expect(await within(await region()).findByText('Ade Okafor')).toBeInTheDocument()
  })

  it('a row opens that player', async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a') })
    renderApp('/coach/feedback')
    await userEvent.click(await screen.findByRole('button', { name: "Open Ade Okafor's profile: Urgent" }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/player/a'))
  })

  it('with two squads, shows only the squad picked, and switches with it', async () => {
    home({
      players: [player('u14', 'Ade Okafor', 'U14'), player('u16', 'Bo Lind', 'U16')],
      present: cameToAll('u14', 'u16'),
    })
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    localStorage.setItem(`trak:coach-squad-all:${COACH.id}`, '0')
    renderApp('/coach/feedback')
    expect(await within(await region()).findByText('Bo Lind')).toBeInTheDocument()
    expect(within(overview()).queryByText('Ade Okafor')).toBeNull()

    // The new squad's reads held: the old squad's rows must not stand in for it.
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_assessments`, async () => { await held; return HttpResponse.json([]) }))
    await pickSquad('U14')
    expect(within(overview()).queryByText('Bo Lind')).toBeNull()
    expect(within(overview()).getByRole('status')).toHaveTextContent('Loading your players…')
    release()
    expect(await within(overview()).findByText('Ade Okafor')).toBeInTheDocument()
    expect(within(overview()).queryByText('Bo Lind')).toBeNull()
  })

  it("a training only the other squad had doesn't count against this squad", async () => {
    home({
      players: [player('u16', 'Bo Lind', 'U16')],
      assessments: [{ squad_player_id: 'u16', created_at: daysAgo(1) }],
      present: cameToAll('u16'),
    })
    // A newer U14 training Bo wasn't on: not his squad's, so not missed.
    server.use(table('coach_sessions', [
      { id: 't0', coach_user_id: COACH.id, session_type: 'training', session_date: '2026-11-27', event_id: null, squad: 'U14' },
      ...TRAININGS.map(t => ({ ...t, coach_user_id: COACH.id })),
    ]), table('squad_players', [player('u14', 'Ade Okafor', 'U14'), player('u16', 'Bo Lind', 'U16')]),
    table('session_attendance', [['t0', 'u14'], ...cameToAll('u16')].map(([session_id, squad_player_id]) => ({ session_id, squad_player_id }))))
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    localStorage.setItem(`trak:coach-squad-all:${COACH.id}`, '0')
    renderApp('/coach/feedback')
    expect(await within(await region()).findByText('Assessed 1 day ago')).toBeInTheDocument()
  })
})

// TRAK-262 (Imad, 22 Oct): the two quick-action cards left Home (the "+" has both); Needs you, Squad shape and the
// squad pills came. The full player overview stays the Feedback tab's.
describe('TRAK-262: coach Home', () => {
  it('has no Assess a player or Log a match card: the "+" covers both', async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a') })
    renderApp('/coach/home')
    expect(await screen.findByRole('heading', { name: 'Squad shape' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assess a player' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log a match or training' })).toBeNull()
    expect(screen.queryByRole('region', { name: /Player overview|Feedback and assessment/ })).toBeNull()
  })

  it('Needs you has a card for a player never assessed after 3 weeks, which opens Assess for them', async () => {
    home({ players: [player('a', 'Ade Okafor'), player('b', 'Bo Lind')], present: cameToAll('a', 'b'),
      assessments: [{ squad_player_id: 'b', coach_user_id: COACH.id, created_at: daysAgo(1), published_at: daysAgo(1), coach_rating: 7,
        work_rate: 7, technical: 7, physical: 7, coachability: 7, attitude: 7, tactical: 7 }] })
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    const card = await within(needs).findByRole('button', { name: /Ade Okafor/ })
    expect(card).toHaveTextContent('Never assessed, 5 weeks in the squad')
    expect(within(needs).queryByRole('button', { name: /Bo Lind/ })).toBeNull()
    await userEvent.click(card)
    await waitFor(() => expect(window.location.pathname).toBe('/coach/assess'))
  })

  it('Needs you leaves Home when the coach turns it off in Settings', async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a'), settings: [{ user_id: COACH.id, event_reminders: true, needs_you: false, cant_make_it_alerts: true }] })
    renderApp('/coach/home')
    expect(await screen.findByText(/No assessments this month or last/, {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: /Needs you/ })).toBeNull())
    expect(screen.queryByRole('button', { name: /Ade Okafor/ })).toBeNull()
  })

  it('Imad, 24 Oct: an event waiting for its register or match log is in Needs you too, with its next step', async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a') })
    const event = (id: string, event_type: string, title: string, event_date: string, opponent: string | null = null) => ({
      id, coach_user_id: COACH.id, event_type, title, opponent, event_date, start_time: '17:00:00', end_time: '18:30:00',
      starts_at: `${event_date}T13:00:00Z`, published: true, status: 'scheduled', squad: null, sequence: 1,
    })
    server.use(table('coach_calendar_events', [event('ev-tr', 'training', 'Tactical', '2026-11-29'), event('ev-m', 'match', 'League', '2026-11-28', 'Rovers')]))
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    expect(await within(needs).findByText('Started, no register yet', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(within(needs).getByRole('button', { name: 'Take register' })).toBeInTheDocument()
    expect(within(needs).getByText('Played, not logged yet')).toBeInTheDocument()
    expect(within(needs).getByRole('button', { name: 'Log it' })).toBeInTheDocument()
    expect(within(needs).getByText('Match vs Rovers')).toBeInTheDocument()
  })

  it("a draft families can't see yet has its own card, which opens the player", async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a'),
      assessments: [{ squad_player_id: 'a', coach_user_id: COACH.id, created_at: daysAgo(1), published_at: null, coach_rating: 7,
        work_rate: 7, technical: 7, physical: 7, coachability: 7, attitude: 7, tactical: 7 }] })
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    const card = await within(needs).findByRole('button', { name: /Finish draft/ })
    await userEvent.click(card)
    await waitFor(() => expect(window.location.pathname).toBe('/coach/player/a'))
  })

  it('Squad shape says so when nothing was assessed this month or last', async () => {
    home({ players: [player('a', 'Ade Okafor')], present: cameToAll('a') })
    renderApp('/coach/home')
    expect(await screen.findByText(/No assessments this month or last/, {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('Squad shape names only the squad, with no band chips (Imad, 23 Oct)', async () => {
    const rating = { work_rate: 8, technical: 8, physical: 8, coachability: 8, attitude: 8, tactical: 8 }
    home({ players: [player('a', 'Ade Okafor'), player('b', 'Bo Lind')], present: cameToAll('a', 'b'), assessments: [
      { squad_player_id: 'a', coach_user_id: COACH.id, created_at: daysAgo(2), published_at: daysAgo(2), coach_rating: 8.2, ...rating },
      { squad_player_id: 'b', coach_user_id: COACH.id, created_at: daysAgo(3), published_at: daysAgo(3), coach_rating: 8.4, ...rating },
    ] })
    renderApp('/coach/home')
    const shape = await screen.findByRole('region', { name: 'Squad shape' }, { timeout: 5000 })
    expect(await within(shape).findByText('U16')).toBeInTheDocument()
    expect(within(shape).queryByText(/this month against last/)).toBeNull()
    expect(within(shape).queryByRole('list', { name: 'Players per band' })).toBeNull()
    expect(within(shape).queryByText('Standout')).toBeNull()
  })

  it('opens on All, every squad; a squad tapped shows only it and is remembered (TRAK-305)', async () => {
    home({ players: [player('u14', 'Ade Okafor', 'U14'), player('u16', 'Bo Lind', 'U16')], present: cameToAll('u14', 'u16') })
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    expect(await within(needs).findByRole('button', { name: /Ade Okafor/ })).toBeInTheDocument()
    expect(within(needs).getByRole('button', { name: /Bo Lind/ })).toBeInTheDocument()
    await expectSquadPicked('All')
    expect(within(screen.getByRole('region', { name: 'Squad shape' })).getByText('All squads')).toBeInTheDocument()
    await pickSquad('U16')
    await waitFor(() => expect(within(needs).queryByRole('button', { name: /Ade Okafor/ })).toBeNull())
    expect(localStorage.getItem(`trak:coach-squad:${COACH.id}`)).toBe('U16')
    expect(localStorage.getItem(`trak:coach-squad-all:${COACH.id}`)).toBe('0')
  })

  it('Squad shape names the squad picked in the header', async () => {
    home({ players: [player('u14', 'Ade Okafor', 'U14'), player('u16', 'Bo Lind', 'U16')], present: cameToAll('u14', 'u16') })
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    renderApp('/coach/home')
    const shape = await screen.findByRole('region', { name: 'Squad shape' }, { timeout: 5000 })
    expect(await within(shape).findByText('All squads')).toBeInTheDocument()
    await pickSquad('U14')
    expect(await within(shape).findByText('U14')).toBeInTheDocument()
  })
})
