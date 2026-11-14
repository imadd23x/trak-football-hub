/**
 * TRAK-134 (J8.11), live run 3 (16 Oct): Tarek, as a 16-year-old player who had
 * said "Can't make it", got "Changed" for a match moved from Sat 17 to Sun 18
 * Oct, opened it, and nothing said what had changed. The event page now says
 * what moved since this device last saw it ("Moved: Sat 14 Nov → Sun 15 Nov",
 * then the time and the venue) on that visit, whatever the attendance; once
 * opened, it's seen. Someone who never saw the old version is told nothing.
 */
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'

// These checks are about something else; the phone sits in the academy's zone (Dubai), as Trak's families' do.
// Event times follow the phone's clock (Imad, 23 Oct), so CI's UTC clock would move every time.
const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

let PLAYER = { id: 'player-134' }
const BEFORE = {
  id: 'ev-1', coach_user_id: 'coach-1', published: true, event_type: 'match', title: 'League',
  event_date: '2026-11-14', start_time: '10:00:00', starts_at: '2026-11-14T06:00:00Z',
  venue: 'Rivals Park', opponent: 'Panathinaikos U16', meet_time: null, kit: 'White', home_away: 'away',
  status: 'scheduled', cancel_reason: null, sequence: 0,
}
const AFTER = { ...BEFORE, event_date: '2026-11-15', start_time: '11:00:00', starts_at: '2026-11-15T07:00:00Z',
  venue: 'Municipal Ground', sequence: 1 }

function setup(event: Record<string, unknown>) {
  server.use(
    // TRAK-286: no shared game plan.
    table('game_for_family', []),
    table('game_for_player', []),
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Synthetic Player' }]),
    table('matches', []), table('player_details', []), table('coach_assessments', []), table('recognition_awards', []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('family_training_history', () => []),
    rpcRows('child_events', [event]),
    // 16 at a consent-age-15 academy, and has told the coach they can't make it.
    rpc('my_consent_status', () => ({ required: false, age: 16, consent_age: 15, threshold: 18, own_choice: true })),
    http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () => HttpResponse.json([{ reason: 'family' }])),
  )
}

/** The player's Sessions list shows the event, as this device last saw it. */
async function seeInSessions(event: Record<string, unknown>) {
  setup(event)
  renderApp('/player/matches')
  await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('link', { name: /Panathinaikos/ })
  cleanup()
}

let n = 0
beforeEach(() => { PLAYER = { id: `player-134-${++n}` }; signInAs(PLAYER) })
afterEach(() => cleanup())

describe('TRAK-134: a changed event says what changed', () => {
  it('tells a player who said Can\'t make it what moved, once', async () => {
    await seeInSessions(BEFORE)
    setup(AFTER)
    renderApp('/player/event/ev-1')
    const changed = await screen.findByRole('status', { name: 'What changed' })
    expect(changed).toHaveTextContent('Moved: Sat 14 Nov → Sun 15 Nov')
    expect(changed).toHaveTextContent('Time: 10:00 → 11:00')
    expect(changed).toHaveTextContent('Venue: Rivals Park → Municipal Ground')
    // Their absence still shows: the change line is for everyone.
    expect(await screen.findByText(/can't make it/i)).toBeInTheDocument()

    // Opened, so it's seen: the next visit says nothing.
    cleanup()
    setup(AFTER)
    renderApp('/player/event/ev-1')
    expect(await screen.findByRole('heading', { name: /Panathinaikos/ })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'What changed' })).toBeNull()
  })

  it('says only what changed: a new time alone is just the time', async () => {
    await seeInSessions(BEFORE)
    setup({ ...BEFORE, start_time: '11:00:00', starts_at: '2026-11-14T07:00:00Z', sequence: 1 })
    renderApp('/player/event/ev-1')
    const changed = await screen.findByRole('status', { name: 'What changed' })
    expect(changed).toHaveTextContent('Time: 10:00 → 11:00')
    expect(changed).not.toHaveTextContent('Moved')
    expect(changed).not.toHaveTextContent('Venue')
  })

  it('also when this device only saw it on Home, through the bell', async () => {
    setup(BEFORE)
    renderApp('/player/home')
    await screen.findByRole('button', { name: /Alerts/i }, { timeout: 5000 })
    await new Promise(resolve => setTimeout(resolve, 200))
    cleanup()
    setup(AFTER)
    renderApp('/player/event/ev-1')
    expect(await screen.findByRole('status', { name: 'What changed' })).toHaveTextContent('Moved: Sat 14 Nov → Sun 15 Nov')
  })

  it('tells nobody who never saw the old version', async () => {
    setup(AFTER)
    renderApp('/player/event/ev-1')
    expect(await screen.findByRole('heading', { name: /Panathinaikos/ })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'What changed' })).toBeNull()
  })
})
