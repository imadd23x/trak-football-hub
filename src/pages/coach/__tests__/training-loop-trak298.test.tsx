/**
 * TRAK-298 (Training 5/5, spec TRAK-293): the loop on a training's page. Before it starts, Who's here waits and View
 * is there; on the day, Who's here opens the existing register; with the register taken, Close is next. View is the
 * plan at the pitch side (TRAK-309: it was Run it, a step of the loop, at /run). A training closes on its own once it
 * has ended with its register taken (Kostas, 28 Oct): every step done, Closed, View log; Last week says so. Nothing new
 * is stored. Test people are named after footballers.
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
let COACH = { id: 'coach-298' }
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

/** Trainings, plans and registers (completed sessions by event). take_event_register makes the session. */
function database(events: Record<string, unknown>[], plans: Record<string, Record<string, unknown>[]>, registers: Record<string, string> = {}) {
  const sessions = new Map(Object.entries(registers))
  const taken: Record<string, unknown>[] = []
  const eq = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const id = eq(new URL(request.url), 'id')
      return HttpResponse.json(id ? events.filter(e => e.id === id) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      const rows = Object.keys(plans).map(event_id => ({ event_id, updated_at: '2026-10-28T10:00:00Z' }))
      return HttpResponse.json(id ? rows.filter(r => r.event_id === id) : rows)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_practices`, ({ request }) => HttpResponse.json(plans[eq(new URL(request.url), 'event_id')!] ?? [])),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, ({ request }) => {
      const url = new URL(request.url)
      const id = eq(url, 'id')
      if (id) return HttpResponse.json([...sessions].filter(([, s]) => s === id).map(([event_id]) => ({
        id, event_id, session_type: 'training', title: 'Training', session_date: '2026-10-28', training_type: null, notes: null,
      })))
      return HttpResponse.json([...sessions].map(([event_id, sid]) => ({ id: sid, event_id })))
    }),
    rpc('take_event_register', args => {
      taken.push(args)
      sessions.set(String(args.p_event_id), `session-${args.p_event_id}`)
      return `session-${args.p_event_id}`
    }),
  )
  return taken
}

beforeEach(() => {
  COACH = { id: `coach-298-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Virgil van Dijk', age_group: 'U16', status: 'active' },
    ]),
    table('session_attendance', [{ squad_player_id: 'sp-1', status: 'present' }]),
    table('event_absences', []),
    table('coach_drills', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const loop = () => screen.getByRole('list', { name: 'Training loop' })

describe('TRAK-298: the loop on a training’s page', { timeout: 30_000 }, () => {
  it('before the training: Who’s here waits for the start, and View is there', async () => {
    database([training('soon', onTheMinute(Date.now() + DAY))], { soon: [practice(1, 'Rondos 4v1')] })
    renderApp('/coach/training/soon')
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Who’s here opens when the training starts.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Who’s here' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument()
    expect(within(loop()).getAllByRole('listitem').map(step => step.textContent))
      .toEqual(['1 · Plan(done)', '→2 · Who’s here(next)', '→3 · Close'])
  })

  it('on the day: Who’s here opens the existing register; once taken, Close is next', async () => {
    const user = userEvent.setup()
    // Started 20 minutes ago, 90 minutes long.
    const taken = database([training('today', onTheMinute(Date.now() - 20 * MINUTE))], { today: [practice(1, 'Rondos 4v1')] })
    renderApp('/coach/training/today')
    await user.click(await screen.findByRole('button', { name: 'Who’s here' }))
    const sheet = await screen.findByRole('dialog', { name: 'Who’s here' })
    expect(await within(sheet).findByRole('button', { name: 'Mohamed Salah: present' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Virgil van Dijk: present' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save register' }))
    await waitFor(() => expect(taken).toEqual([{ p_event_id: 'today', p_present: ['sp-1'] }]))

    // The sheet closes on save; the page shows again once it has.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Who’s here' })).toBeNull())
    expect(loop()).toHaveTextContent(/2 · Who’s here\s*\(done\)/)
    expect(loop()).toHaveTextContent(/3 · Close\s*\(next\)/)
    expect(screen.getByRole('button', { name: 'Edit register' })).toBeInTheDocument()
    expect(screen.queryByText('Closed')).toBeNull()
  })

  it('closes on its own once it has ended with its register taken: every step done, and the log', async () => {
    const user = userEvent.setup()
    database([training('done', onTheMinute(Date.now() - DAY))], { done: [practice(1, 'Rondos 4v1')] }, { done: 'session-done' })
    renderApp('/coach/training/done')
    expect(await screen.findByText('Closed')).toBeInTheDocument()
    expect(within(loop()).getAllByText('(done)')).toHaveLength(3)
    expect(screen.getByText('Closed. Who came is in the log.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View log' }))
    const sheet = await screen.findByRole('dialog', { name: 'The log' })
    expect(await within(sheet).findByRole('link', { name: 'Edit log' })).toHaveAttribute('href', '/coach/sessions/session-done')
  })

  it('an ended training without a register isn’t closed: Who’s here is still to do', async () => {
    database([training('missed', onTheMinute(Date.now() - DAY))], { missed: [practice(1, 'Rondos 4v1')] })
    renderApp('/coach/training/missed')
    expect(await screen.findByRole('button', { name: 'Who’s here' })).toBeInTheDocument()
    expect(screen.queryByText('Closed')).toBeNull()
    expect(loop()).toHaveTextContent(/2 · Who’s here\s*\(now\)/)
  })

  it('a training not published says Who’s here needs it published', async () => {
    database([training('draft', onTheMinute(Date.now() - 20 * MINUTE), { published: false })], { draft: [practice(1, 'Rondos 4v1')] })
    renderApp('/coach/training/draft')
    expect(await screen.findByText('Who’s here: only a published event has a register.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Who’s here' })).toBeNull()
  })
})

describe('TRAK-298: View', { timeout: 30_000 }, () => {
  it('reads the plan at the pitch side: when each practice starts, how long, what to tell them', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))], {
      soon: [practice(1, 'Rondos 4v1', { area: '10 × 10 m' }), practice(2, 'Pressing on the trigger', { minutes: 25, tell: 'Press when their 6 turns.' })],
    })
    renderApp('/coach/training/soon')
    await user.click(await screen.findByRole('button', { name: 'View' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon/view'))
    expect(screen.getByText('View')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Practices to run' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const start = screen.getByRole('heading', { level: 1 }).textContent!.split(' · ')[1]
    expect(rows[0]).toHaveTextContent(new RegExp(`^${start}15min`))
    expect(rows[0]).toHaveTextContent('10 × 10 m')
    expect(rows[1]).toHaveTextContent('25min')
    expect(within(rows[1]).getByText('“Press when their 6 turns.”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the plan' })).toHaveAttribute('href', '/coach/training/soon')
  })

  it('the old Run it address opens View', async () => {
    database([training('soon', onTheMinute(Date.now() + DAY))], { soon: [practice(1, 'Rondos 4v1')] })
    renderApp('/coach/training/soon/run')
    expect(await screen.findByRole('list', { name: 'Practices to run' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/training/soon/view')
  })
})

describe('TRAK-298: Last week', { timeout: 30_000 }, () => {
  it('says which trainings closed, with View plan and Edit plan, or Create plan, on the right', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    database([training('tue', onTheMinute(now - 5 * DAY), { title: 'Pressing zones' }), training('thu', onTheMinute(now - 2 * DAY), { title: 'Finishing' })],
      { tue: [practice(1, 'Pressing 3v2')] }, { tue: 'session-tue' })
    renderApp('/coach/training')
    const lastWeek = await screen.findByRole('region', { name: 'Last week' })
    await waitFor(() => expect(within(lastWeek).getByText('Closed')).toBeInTheDocument())
    const [thu, tue] = within(lastWeek).getAllByRole('article')
    expect(thu).toHaveAccessibleName(/Finishing$/)
    expect(thu).toHaveTextContent('No register')
    expect(tue).toHaveTextContent('Closed')
    // Its day and title still open its own page, where the register and the log are.
    expect(within(thu).getByRole('link')).toHaveAttribute('href', '/coach/training/thu')
    expect(within(tue).getByRole('link')).toHaveAttribute('href', '/coach/training/tue')

    // Kostas, 29 Oct: a training that's over has the same two buttons as one coming up.
    expect(await within(thu).findByRole('button', { name: 'Create plan' })).toBeInTheDocument()
    expect(within(thu).queryByRole('button', { name: 'View plan' })).toBeNull()
    await user.click(within(tue).getByRole('button', { name: 'View plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/tue/view'))
    expect(await screen.findByRole('list', { name: 'Practices to run' })).toHaveTextContent('Pressing 3v2')
    await user.click(screen.getByRole('link', { name: 'Back to Training' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training'))
    await user.click(await within(await screen.findByRole('article', { name: /Pressing zones$/ })).findByRole('button', { name: 'Edit plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/tue/plan'))
  })

  it('Create plan on a training that’s over asks how to plan it', async () => {
    database([training('thu', onTheMinute(Date.now() - 2 * DAY), { title: 'Finishing' })], {})
    renderApp('/coach/training')
    const thu = await within(await screen.findByRole('region', { name: 'Last week' })).findByRole('article', { name: /Finishing$/ })
    await userEvent.click(await within(thu).findByRole('button', { name: 'Create plan' }))
    expect(await screen.findByRole('dialog', { name: 'How do you want to plan it?' })).toBeInTheDocument()
  })
})
