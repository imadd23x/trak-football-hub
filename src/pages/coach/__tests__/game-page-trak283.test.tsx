/**
 * TRAK-283 (Games 1/8): a game's page. The header says where the game is in its loop. Logistics shows Schedule's
 * Review rows with Shared with families or Draft and Edit in Schedule; a draft publishes in place, as Home's event
 * sheet does. Game plan and Evaluation say what will happen there, and the panel lives in the URL. Only the
 * coach's own match opens. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

// The phone sits in the academy's zone (Dubai), so the page shows no second clock.
const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-283-page' }

/** A Dubai academy's match (UTC+4 all year): its wall clock and its instant. */
function game(kickOff: number, over: Record<string, unknown> = {}) {
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'Match', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: 'Bring water', notes: null, series_id: null, training_theme: null, cancel_reason: null, ...over,
  }
}
const soon = () => Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
/** The events table answers with these rows; every read's address is kept. */
function events(rows: Record<string, unknown>[]) {
  const asked: URL[] = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => { asked.push(new URL(request.url)) }),
    table('coach_calendar_events', rows),
  )
  return asked
}

beforeEach(() => {
  COACH = { id: `coach-283-page-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Fernando Santos', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('game_plans', []),
    table('game_plan_players', []),
    table('event_confirmations', []),
    table('coach_assessments', []),
    rpc('coach_squad_player_consent_required', () => false),
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

const row = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling

describe('TRAK-283: a game\'s page', { timeout: 20_000 }, () => {
  it("shows where the game is and its logistics, as Schedule's Review rows; only the coach's own match is asked for", async () => {
    const asked = events([game(soon())])
    renderApp('/coach/games/g1')
    expect(await screen.findByRole('heading', { level: 1, name: 'vs Parkview Athletic' })).toBeInTheDocument()
    expect(screen.getByText('Plan not written')).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: 'Kick-off in' })).toBeInTheDocument()
    const tabs = screen.getByRole('tablist', { name: 'This game' })
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Logistics', 'Game plan', 'Evaluation'])
    expect(within(tabs).getByRole('tab', { name: 'Logistics' })).toHaveAttribute('aria-selected', 'true')

    expect(screen.getByText('Shared with families')).toBeInTheDocument()
    expect(row('Type')).toHaveTextContent('Match')
    expect(row('Opponent')).toHaveTextContent('Parkview Athletic (Home)')
    expect(row('Note for families')).toHaveTextContent('Bring water')
    expect(screen.getByRole('link', { name: 'Edit in Schedule' })).toHaveAttribute('href', '/coach/schedule?edit=g1')
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()

    const read = asked.find(url => url.searchParams.get('id') === 'eq.g1')!
    expect(read.searchParams.get('coach_user_id')).toBe(`eq.${COACH.id}`)
    expect(read.searchParams.get('event_type')).toBe('eq.match')
  })

  it('Game plan opens its first step (TRAK-284) and Evaluation says what will happen there; the panel is in the URL and the keyboard moves between them', async () => {
    const user = userEvent.setup()
    events([game(soon())])
    renderApp('/coach/games/g1')
    await user.click(await screen.findByRole('tab', { name: 'Game plan' }))
    expect(await screen.findByRole('heading', { name: 'Your goals' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=plan')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Evaluation' })).toHaveFocus()
    // TRAK-288: until full time it says when it opens.
    expect(await screen.findByRole('heading', { name: /^Opens at full time, \d\d:\d\d$/ })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=evaluation')

    cleanup()
    renderApp('/coach/games/g1?tab=plan')
    expect(await screen.findByRole('tab', { name: 'Game plan' })).toHaveAttribute('aria-selected', 'true')
  })

  it("a draft's Publish publishes it here, as Home's event sheet does, and families are emailed the logistics as today", async () => {
    const user = userEvent.setup()
    const kickOff = soon()
    let published = false
    let emails = 0
    const patches: { url: URL; body: unknown }[] = []
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([game(kickOff, { published })])),
      http.patch(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, async ({ request }) => {
        patches.push({ url: new URL(request.url), body: await request.json() })
        published = true
        return HttpResponse.json([{ id: 'g1' }])
      }),
      http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => { emails += 1; return HttpResponse.json({}) }),
    )
    renderApp('/coach/games/g1')
    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Logistics not shared')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Shared with families')).toBeInTheDocument()
    expect(screen.getByText('Plan not written')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toEqual({ published: true })
    expect(patches[0].url.searchParams.get('id')).toBe('eq.g1')
    await waitFor(() => expect(emails).toBe(1))
    expect(window.location.pathname).toBe('/coach/games/g1')
  })

  it('once it has kicked off: locked, the countdown says so until full time (TRAK-287), and no edit', async () => {
    events([game(Date.now() - 30 * MINUTE)])
    renderApp('/coach/games/g1')
    expect(await screen.findByText('Locked at kick-off')).toBeInTheDocument()
    // jsdom never shows a past countdown's label (it can't tell the countdown is on screen); the TRAK-287 test sees it flip.
    expect(screen.getByRole('timer', { name: 'Kick-off in' })).toBeInTheDocument()
    expect(screen.getByText('Shared with families')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit in Schedule' })).toBeNull()
  })

  it('a cancelled match says so; a match that is not the coach\'s own does not open', async () => {
    events([game(soon(), { status: 'cancelled' })])
    renderApp('/coach/games/g1')
    expect(await screen.findByText('This match was cancelled.')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'This game' })).toBeNull()

    cleanup()
    events([])
    renderApp('/coach/games/someone-elses')
    expect(await screen.findByText('This game isn’t in your games.')).toBeInTheDocument()
  })
})
