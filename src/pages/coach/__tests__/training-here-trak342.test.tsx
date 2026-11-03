/**
 * TRAK-342 (Training redo 4/5, spec TRAK-338, 2 Nov prototype): Who's here. The register first (several names a row);
 * once it's saved, and only then, each part of the plan shows Trak's suggestion for the players who came: no change, a
 * new set-up or a swap. Use it or Keep, then Save today's plan saves the plan whole. Test people are named after
 * footballers.
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
const SQUAD = ['Mohamed Salah', 'Virgil van Dijk', 'Trent Alexander-Arnold', 'Andy Robertson', 'Jordan Henderson', 'Sadio Mané']
let COACH = { id: 'coach-342' }
function training(id: string, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', family_note: null, ...over,
  }
}
const practice = (position: number, name: string, over: Record<string, unknown> = {}) => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part: '', part_type: null, trak_drill: null, players_kind: null, group_size: null, ...over,
})
const trak = (position: number, id: string, name: string, part: string, part_type: string, minutes = 15) =>
  practice(position, name, { source: 'trak', trak_drill: id, part, part_type, minutes })

/** Trainings, plans, drafts and My drills as the database keeps them; saves, drafts and drills written are kept. */
function database(events: Record<string, unknown>[], start: Record<string, Record<string, unknown>[]> = {},
  { drafts = [] as Record<string, unknown>[], drills = [] as Record<string, unknown>[] } = {}) {
  const plans = new Map(Object.entries(start))
  const saves: Record<string, unknown>[] = []
  const draftsSent: Record<string, unknown>[] = []
  const drillsSent: Record<string, unknown>[] = []
  const eq = (url: URL, key: string) => url.searchParams.get(key)?.match(/^eq\.(.*)$/)?.[1]
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const id = eq(new URL(request.url), 'id')
      return HttpResponse.json(id ? events.filter(e => e.id === id) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      const rows = [...plans.keys()].map(event_id => ({ event_id, updated_at: '2026-11-01T10:00:00Z', note: '' }))
      return HttpResponse.json(id ? rows.filter(r => r.event_id === id) : rows)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_practices`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      if (id) return HttpResponse.json(plans.get(id) ?? [])
      return HttpResponse.json([...plans].flatMap(([event_id, rows]) => rows.map(row => ({ event_id, ...row }))))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_drafts`, () => HttpResponse.json(drafts)),
    http.post(`${SUPABASE_URL}/rest/v1/training_plan_drafts`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      draftsSent.push(body)
      return HttpResponse.json({ event_id: body.event_id })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/coach_drills`, () => HttpResponse.json(drills)),
    http.post(`${SUPABASE_URL}/rest/v1/coach_drills`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      drillsSent.push(body)
      return HttpResponse.json({ id: `drill-new-${drillsSent.length}`, updated_at: '2026-11-03T10:00:00Z', tell: '', area: '', numbers: '',
        direction: '', targets: '', conditions: '', ...body })
    }),
    rpc('save_training_plan', args => {
      saves.push(args)
      plans.set(String(args.p_event_id), (args.p_practices as Record<string, unknown>[]).map((p, i) => ({ ...p, position: i + 1 })))
      return null
    }),
  )
  return { saves, draftsSent, drillsSent }
}

beforeEach(() => {
  COACH = { id: `coach-342-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', SQUAD.map((name, i) => ({ id: `sp-${i + 1}`, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active' }))),
    rpc('coach_squad_player_consent_required', () => false),
    table('event_absences', []),
    table('training_notes', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

/** The register as the database keeps it: one completed session per event, and who was marked present. */
function register(taken: string[] | null) {
  let present = taken
  const calls: unknown[] = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () => HttpResponse.json(present ? [{ id: 'session-soon', event_id: 'soon' }] : [])),
    http.get(`${SUPABASE_URL}/rest/v1/session_attendance`, () =>
      HttpResponse.json((present ?? []).map(id => ({ session_id: 'session-soon', squad_player_id: id, status: 'present' })))),
    rpc('take_event_register', args => { calls.push(args); present = args.p_present as string[]; return 'session-soon' }),
  )
  return calls
}
const PLAN = { soon: [trak(1, 'w1', 'Dynamic warm-up', 'Dry warm-up', 'warmup', 10), trak(2, 'r1', 'Rondo 4 v 2', 'Rondo', 'rondo', 15),
  trak(3, 'g1', 'Free play', 'Game', 'game', 25)] }
const column = (name: string) => within(screen.getByRole('list', { name: 'Today’s plan' })).getByRole('article', { name })
const sent = (save: Record<string, unknown>) => (save.p_practices as Record<string, unknown>[]).map(p => `${p.name}${p.numbers ? ` (${p.numbers})` : ''}`)

describe('TRAK-342: Who’s here', { timeout: 30_000 }, () => {
  it('the register comes first; the plan waits, greyed, until the register is saved', async () => {
    const user = userEvent.setup()
    const calls = register(null)
    database([training('soon', onTheMinute(Date.now() - 10 * MINUTE))], PLAN)
    renderApp('/coach/training/soon/here')
    expect(await screen.findByRole('heading', { level: 1, name: 'Who’s here?' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Your plan, for all 6' })).toBeInTheDocument()
    expect(screen.getByText('Trak checks it once you’re done with the register.')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Today’s plan' })).queryByText(/Trak suggests/)).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Sadio Mané: present' }))
    await user.click(screen.getByRole('button', { name: 'Done: 5 here' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(await screen.findByRole('heading', { name: 'Today’s plan for 5 players' })).toBeInTheDocument()
    expect(screen.getByText(/5 of 6 here\./)).toBeInTheDocument()
  })

  it('after the register: each part says what to do, and Save today’s plan saves the choices', async () => {
    const user = userEvent.setup()
    register(['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5'])
    const { saves } = database([training('soon', onTheMinute(Date.now() - 10 * MINUTE))], PLAN)
    renderApp('/coach/training/soon/here')
    expect(await screen.findByRole('heading', { name: 'Today’s plan for 5 players' })).toBeInTheDocument()
    expect(column('Dry warm-up')).toHaveTextContent('No change')
    expect(column('Dry warm-up')).toHaveTextContent('Works with any number. No change.')
    expect(column('Rondo')).toHaveTextContent('planned for 6: 1 grid of 6 (4 v 2)')
    expect(column('Rondo')).toHaveTextContent('Trak suggests: Change to 1 grid of 5 (4 v 1).')
    // Free play needs two teams of at least 8 players: too few, and nothing to swap to.
    expect(column('Game')).toHaveTextContent('Free play doesn’t work well with 5.')
    expect(screen.getByText('1 part needs a change. Pick “Use it” or “Keep” for each. 1 part doesn’t work with 5 players. Change it yourself.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save today’s plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(sent(saves[0])).toEqual(['Dynamic warm-up', 'Rondo 4 v 2 (1 grid of 5 (4 v 1))', 'Free play'])
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon'))
  })

  it('Keep leaves a part as planned; with nothing to change, Save just goes back', async () => {
    const user = userEvent.setup()
    register(['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5'])
    const { saves } = database([training('soon', onTheMinute(Date.now() - 10 * MINUTE))], PLAN)
    renderApp('/coach/training/soon/here')
    await screen.findByRole('heading', { name: 'Today’s plan for 5 players' })
    await user.click(within(column('Rondo')).getByRole('button', { name: 'Keep' }))
    await user.click(screen.getByRole('button', { name: 'Save today’s plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon'))
    expect(saves).toHaveLength(0)
  })

  it('everyone here: the plan works as it is', async () => {
    register(SQUAD.map((_, i) => `sp-${i + 1}`))
    database([training('soon', onTheMinute(Date.now() - 10 * MINUTE))], PLAN)
    renderApp('/coach/training/soon/here')
    expect(await screen.findByText('Everyone’s here. Your plan works as it is.')).toBeInTheDocument()
    expect(column('Rondo')).toHaveTextContent('Everyone’s here. No change.')
  })

  it('Change it myself opens that part in the planner', async () => {
    const user = userEvent.setup()
    register(['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5'])
    database([training('soon', onTheMinute(Date.now() - 10 * MINUTE))], PLAN)
    renderApp('/coach/training/soon/here')
    await screen.findByRole('heading', { name: 'Today’s plan for 5 players' })
    await user.click(within(column('Game')).getByRole('button', { name: 'Change it myself' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit: Game' })).toBeInTheDocument()
  })

  it('no plan: take the register anyway, and Plan session is there', async () => {
    register(null)
    database([training('soon', onTheMinute(Date.now() - 10 * MINUTE))])
    renderApp('/coach/training/soon/here')
    expect(await screen.findByRole('heading', { name: 'No plan for today' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan session' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Done: 6 here' })).toBeInTheDocument()
  })

  it('before the training starts, the register waits', async () => {
    register(null)
    database([training('soon', onTheMinute(Date.now() + DAY))], PLAN)
    renderApp('/coach/training/soon/here')
    expect(await screen.findByText('Who’s here opens when the training starts.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Done:/ })).toBeNull()
  })
})
