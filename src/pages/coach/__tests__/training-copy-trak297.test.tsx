/**
 * TRAK-297 (Training 4/5, spec TRAK-293): Copy a past session. TRAK-339 (Training redo 1/5): it is "Use a past plan"
 * on the Next training card (no more "How do you want to plan it?"). The list holds the coach's planned sessions, newest first, with their practices, and
 * searches by name or drill. Copy opens Write my own filled in; nothing saves until Save the plan. Nothing new is
 * stored: a past session is its plan. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

let n = 0
let COACH = { id: 'coach-297' }
function training(id: string, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', ...over,
  }
}
const practice = (position: number, name: string, over: Record<string, unknown> = {}) => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, ...over,
})

/** The coach's trainings and plans. Reads answer `eq.` and `in.(…)` filters as PostgREST does; save_training_plan keeps
 *  each call's arguments. */
function database(events: Record<string, unknown>[], start: Record<string, Record<string, unknown>[]> = {}) {
  const plans = new Map(Object.entries(start))
  const saves: Record<string, unknown>[] = []
  const matches = (url: URL, key: string) => {
    const value = url.searchParams.get(key)
    if (!value) return () => true
    const wanted = value.startsWith('in.(') ? value.slice(4, -1).split(',') : [value.replace(/^eq\./, '')]
    return (id: unknown) => wanted.includes(String(id))
  }
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const ok = matches(new URL(request.url), 'id')
      return HttpResponse.json(events.filter(e => ok(e.id)))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, ({ request }) => {
      const ok = matches(new URL(request.url), 'event_id')
      return HttpResponse.json([...plans.keys()].filter(ok).map(event_id => ({ event_id, updated_at: '2026-10-28T10:00:00Z' })))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_practices`, ({ request }) => {
      const ok = matches(new URL(request.url), 'event_id')
      return HttpResponse.json([...plans].filter(([id]) => ok(id)).flatMap(([event_id, rows]) => rows.map(row => ({ event_id, ...row }))))
    }),
    rpc('save_training_plan', args => {
      saves.push(args)
      plans.set(String(args.p_event_id), (args.p_practices as Record<string, unknown>[]).map((p, i) => ({ ...p, position: i + 1 })))
      return null
    }),
  )
  return saves
}

beforeEach(() => {
  COACH = { id: `coach-297-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('coach_drills', []),
    table('training_notes', []),
    table('training_plan_drafts', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })


describe('TRAK-297: Copy a past session', { timeout: 30_000 }, () => {
  it('lists the coach’s planned sessions newest first, searches them, and copies one into the planner unsaved', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const saves = database([
      training('older', onTheMinute(now - 8 * DAY), { title: 'Finishing under pressure' }),
      training('newer', onTheMinute(now - 3 * DAY), { title: 'Pressing zones' }),
      training('next', onTheMinute(now + DAY), { title: 'Before Everton' }),
    ], {
      older: [practice(1, 'Finishing 3v2', { minutes: 20 })],
      newer: [
        practice(1, 'Rondos 4v1', { source: 'drill', drill_id: 'd-1', area: '10 × 10 m' }),
        practice(2, 'Pressing duels', { minutes: 25, source: 'library', library_session: 'pressing-and-covering-session-pressing-duels' }),
        practice(3, 'Game 8v8', { minutes: 30, tell: 'Win it back in five seconds.' }),
      ],
    })
    renderApp('/coach/training')
    const next = await screen.findByRole('region', { name: 'Before Everton' })
    await user.click(within(next).getByRole('button', { name: 'Use a past plan' }))

    const copy = await screen.findByRole('dialog', { name: 'Use a past plan' })
    const list = await within(copy).findByRole('list', { name: 'Past plans' })
    expect(within(list).getAllByRole('listitem').map(item => item.querySelector('span')?.textContent))
      .toEqual(['Pressing zones', 'Finishing under pressure'])
    expect(within(list).getByText('3 practices · 70 min · Rondos 4v1, Pressing duels, Game 8v8')).toBeInTheDocument()
    await user.type(within(copy).getByRole('searchbox', { name: 'Search past plans' }), '3v2')
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
    await user.clear(within(copy).getByRole('searchbox', { name: 'Search past plans' }))
    await user.click(within(copy).getByRole('button', { name: /^Use this plan: Pressing zones, / }))

    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/next/plan'))
    // TRAK-340: a plan from before parts comes in as one part per practice, named after it; the planner starts at the first.
    const parts = await screen.findByRole('list', { name: 'Parts of the session' })
    expect(within(parts).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      expect.stringContaining('Rondos 4v1'), expect.stringContaining('Pressing duels'), expect.stringContaining('Game 8v8')])
    expect(screen.getByText(/Copied from Pressing zones, .+ Nothing is saved until you do\./)).toBeInTheDocument()
    expect(screen.getByText('70 of 90 min')).toBeInTheDocument()
    expect(saves).toHaveLength(0)

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: /^Next: / }))
    await user.click(await screen.findByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0].p_event_id).toBe('next')
    expect(saves[0].p_practices).toEqual([
      expect.objectContaining({ name: 'Rondos 4v1', source: 'drill', drill_id: 'd-1', area: '10 × 10 m', save_to_drills: false }),
      expect.objectContaining({ name: 'Pressing duels', minutes: 25, source: 'library', library_session: 'pressing-and-covering-session-pressing-duels' }),
      expect.objectContaining({ name: 'Game 8v8', minutes: 30, tell: 'Win it back in five seconds.', source: 'own', save_to_drills: false }),
    ])
  })

  it('with no other plan written, says so: never the training being planned', async () => {
    const user = userEvent.setup()
    database([training('next', onTheMinute(Date.now() + DAY), { title: 'Before Everton' })], {})
    renderApp('/coach/training')
    await user.click(within(await screen.findByRole('region', { name: 'Before Everton' })).getByRole('button', { name: 'Use a past plan' }))
    const copy = await screen.findByRole('dialog', { name: 'Use a past plan' })
    expect(await within(copy).findByText('No past plans yet. Every plan you save is kept here.')).toBeInTheDocument()
    expect(within(copy).queryByRole('list', { name: 'Past plans' })).toBeNull()
  })
})
