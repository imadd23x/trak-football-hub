import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'
import { pickTime } from '../../../../tests/support/arc-pickers'
import { logStep, saveLog } from '../../../../tests/support/log-steps'

// The import is parked for coaches (schedule-import-parked-j86); switched on here, as schedule-import-j86 does.
vi.mock('@/lib/fixture-import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/fixture-import')>()),
  FIXTURE_IMPORT_ENABLED: true,
}))

/**
 * TRAK-176 (Tarek's #356 review): the save paths most pilot events take. With
 * U16 picked, Schedule's Save draft and a fixture import save squad U16. A match
 * logged from its event takes the event's squad, not the one picked on Home.
 * Schedule shows only the picked squad's events and whole-roster ones, so the
 * case that tells them apart is a whole-roster match: it lists every squad and
 * saves no squad, though U16 is picked.
 */
const COACH = { id: 'coach-176-saves' }
const DAY = '2026-10-14'
const NOW = new Date('2026-10-14T14:00:00Z') // 18:00 in Dubai, after the match
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const ROSTER = [
  { id: 'sp-14', coach_user_id: COACH.id, player_name: 'Ade Okafor', position: 'Midfielder', age_group: 'U14', status: 'active', linked_player_id: 'pl-14' },
  { id: 'sp-16', coach_user_id: COACH.id, player_name: 'Bo Lind', position: 'Defender', age_group: 'U16', status: 'active', linked_player_id: 'pl-16' },
]
const ROSTER_MATCH = {
  id: 'match-all', coach_user_id: COACH.id, title: 'vs Synthetic Rovers', event_type: 'match', opponent: 'Synthetic Rovers',
  home_away: 'away', event_date: DAY, start_time: '15:00:00', starts_at: '2026-10-14T11:00:00Z', ends_at: null,
  venue: 'Rovers Park', notes: null, published: true, source: 'manual', meet_time: null, kit: null,
  status: 'scheduled', cancel_reason: null, series_id: null, squad: null,
}

let eventInserts: Record<string, unknown>[]
let sessionInserts: Record<string, unknown>[]

function fixtures(events: Record<string, unknown>[] = []) {
  eventInserts = []
  sessionInserts = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json(events)),
    table('squad_players', ROSTER),
    table('event_absences', []),
    // TRAK-288: Games off, so a match is still logged as today.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games'),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('coach_match_score_clash', () => null),
    rpc('log_match_for_player', () => 'match-row'),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/coach_sessions`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sessionInserts.push(body)
      return HttpResponse.json({ id: 'session-176', ...body }, { status: 201 })
    }),
    http.post(`${SUPABASE_URL}/rest/v1/session_attendance`, () => new HttpResponse(null, { status: 201 })),
    http.post(EVENTS, async ({ request }) => {
      const body = await request.json()
      const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
      eventInserts.push(...rows)
      return HttpResponse.json(rows.map((_, i) => ({ id: `new-${i}` })), { status: 201 })
    }),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  signInAs(COACH)
  localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('TRAK-176: the squad picked is saved on every way an event is made', { timeout: 20_000 }, () => {
  it("Schedule's Save draft saves the squad picked", async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '17:30')
    await saveEventWith(sheet, 'Save draft')
    await waitFor(() => expect(eventInserts).toHaveLength(1))
    expect(eventInserts[0]).toMatchObject({ coach_user_id: COACH.id, published: false, squad: 'U16' })
  })

  it("Imad, 24 Oct: New event names its squad, and saves the one chosen in the form (here every squad)", async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    const squads = within(sheet).getByRole('group', { name: 'Squad' })
    // It starts on the squad picked last.
    expect(within(squads).getByRole('button', { name: 'U16', pressed: true })).toBeInTheDocument()
    await userEvent.click(within(squads).getByRole('button', { name: 'All squads' }))
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '17:30')
    await saveEventWith(sheet, 'Save draft')
    await waitFor(() => expect(eventInserts).toHaveLength(1))
    expect(eventInserts[0]).toMatchObject({ coach_user_id: COACH.id, published: false, squad: null })
  })

  it('a fixture import saves every fixture for the squad picked', async () => {
    fixtures()
    const user = userEvent.setup({ applyAccept: false })
    renderApp('/coach/schedule')
    await user.click(await screen.findByRole('button', { name: 'Import fixtures' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import fixtures' })
    const csv = new File([['Date,Kickoff,Meet time,Opponent,Home or away,Venue,Kit', '2099-11-21,10:00,,Al Wasl FC,Home,Main pitch,'].join('\n')],
      'fixtures.csv', { type: 'text/csv' })
    await user.upload(within(dialog).getByLabelText(/choose a csv file/i), csv)
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 fixture' }))
    await waitFor(() => expect(eventInserts).toHaveLength(1))
    expect(eventInserts[0]).toMatchObject({ source: 'csv', opponent: 'Al Wasl FC', squad: 'U16' })
  })

  it("a whole-roster match logged from its event lists every squad and saves no squad, though U16 is picked", async () => {
    fixtures([ROSTER_MATCH])
    const user = userEvent.setup()
    renderApp('/coach/schedule')
    await user.click(await screen.findByRole('button', { name: 'Log match for vs Synthetic Rovers' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Opponent name')).toHaveValue('Synthetic Rovers'))
    const [us, them] = screen.getAllByPlaceholderText('0')
    await user.type(us, '1')
    await user.type(them, '0')
    await logStep('Squad')
    expect(await screen.findByText('Ade Okafor')).toBeInTheDocument()
    expect(screen.getByText('Bo Lind')).toBeInTheDocument()
    // J4: every player's facts are typed (Log match from an event asks no minutes, TRAK-198).
    // From its event, a player who came may already be marked played.
    for (const name of ['Ade Okafor', 'Bo Lind']) {
      const details = screen.getByRole('button', { name: `Details for ${name}` })
      if (details.getAttribute('aria-expanded') !== 'true') await user.click(details)
      await user.click(screen.getByRole('button', { name: `One fewer goals for ${name}` }))
      await user.click(screen.getByRole('button', { name: `One fewer assists for ${name}` }))
    }
    await saveLog('Save match')
    await waitFor(() => expect(sessionInserts).toHaveLength(1))
    expect(sessionInserts[0]).toMatchObject({ coach_user_id: COACH.id, session_type: 'match', event_id: 'match-all', squad: null })
  })
})
