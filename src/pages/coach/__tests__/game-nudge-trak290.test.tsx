/**
 * TRAK-290 (Games 8/8): the morning-after nudge. An evaluation draft's reminder is the first 09:00 after it was saved,
 * on the academy's clock (the database stamps remind_at); the page works it out when it's read. Before then the draft
 * alert says when it will remind; from then it says good morning, and Home's Needs you card for the draft is urgent.
 * In app only. The clock is faked: the draft was saved Wed 14 Oct 2026 at 17:40 in Dubai. Test people are named after
 * footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

// Wed 14 Oct, 18:00 in Dubai, and Thu 15 Oct, 09:30.
const EVENING = new Date('2026-10-14T14:00:00Z')
const MORNING = new Date('2026-10-15T05:30:00Z')
let n = 0
let COACH = { id: 'coach-290-nudge' }
// Kicked off at 15:00 in Dubai; full time was 16:30.
const played = () => ({
  id: 'match-1', coach_user_id: COACH.id, title: 'vs Synthetic Rovers', event_type: 'match', squad: null,
  starts_at: '2026-10-14T11:00:00Z', ends_at: null, event_date: '2026-10-14', start_time: '15:00:00', end_time: null,
  venue: 'Academy Pitch 2', opponent: 'Synthetic Rovers', notes: null, published: true, source: 'manual', competition: 'league',
  meet_time: null, kit: null, kit_snapshot: null, family_note: null, home_away: 'home', status: 'scheduled', cancel_reason: null, series_id: null,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  COACH = { id: `coach-290-nudge-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Didier Deschamps', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([played()])),
    table('coach_sessions', []),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Zinedine Zidane', age_group: 'U16', status: 'active' }]),
    table('session_attendance', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('coach_assessments', []),
    table('notification_settings', []),
    table('training_plans', []),
    table('game_plans', []),
    table('game_plan_players', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    // Saved at 17:40 in Dubai: the reminder is 09:00 the next morning.
    table('game_evaluations', [{ event_id: 'match-1', saved_at: '2026-10-14T13:40:00Z', remind_at: '2026-10-15T05:00:00Z',
      our_score: 1, their_score: 0, goals: [], how_they_scored: '', plan_worked: [], published_at: null }]),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    rpc('feature_on', () => true),
    rpc('coach_squad_player_consent_required', () => false),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear() })

describe('TRAK-290: the morning-after nudge', { timeout: 30_000 }, () => {
  it('the draft alert says when it will remind, then from 09:00 the next morning says good morning', async () => {
    vi.setSystemTime(EVENING)
    renderApp('/coach/matches/match-1?tab=evaluation')
    expect(await screen.findByText('Draft saved 17:40')).toBeInTheDocument()
    expect(screen.getByText('Only you can see it. We’ll remind you tomorrow at 09:00.')).toBeInTheDocument()
    expect(screen.queryByText(/Good morning/)).toBeNull()
    cleanup()

    vi.setSystemTime(MORNING)
    renderApp('/coach/matches/match-1?tab=evaluation')
    expect(await screen.findByText('Draft saved Wed 17:40')).toBeInTheDocument()
    expect(screen.getByText('Good morning. Add anything you remembered overnight, then publish.')).toBeInTheDocument()
  })

  it('Home\'s Needs you card for the draft turns urgent from 09:00 the next morning', async () => {
    vi.setSystemTime(EVENING)
    renderApp('/coach/home')
    let needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    let reason = await within(needs).findByText('Evaluation draft · only you see it')
    expect(within(needs).queryByText('Urgent:')).toBeNull()
    expect(reason.previousElementSibling).toHaveClass('bg-warning')
    cleanup()

    vi.setSystemTime(MORNING)
    renderApp('/coach/home')
    needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    reason = await within(needs).findByText('Evaluation draft · only you see it', { exact: false })
    expect(within(needs).getByText('Urgent:')).toBeInTheDocument()
    expect(reason.previousElementSibling).toHaveClass('bg-danger')
  })
})
