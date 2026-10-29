/**
 * TRAK-295 (Training 2/5, spec TRAK-293): planning a training. A training coming up has View plan and Edit plan, or
 * Create plan (TRAK-310), which asks "How do you want to plan it?" and
 * remembers the last way. Write my own types practices one at a time (change, move, remove) and saves the plan whole
 * through one database function; a failed save keeps everything typed. The plan page shows the practices with where
 * each came from, the loop, and Change the plan. Test people are named after footballers.
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
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

let n = 0
let COACH = { id: 'coach-295' }
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

/** The coach's trainings, and their plans as the database keeps them. save_training_plan replaces a plan whole and
 *  keeps each call's arguments for the test to read. */
function database(events: Record<string, unknown>[], start: Record<string, Record<string, unknown>[]> = {}) {
  const plans = new Map(Object.entries(start))
  const saves: Record<string, unknown>[] = []
  const eq = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const id = eq(new URL(request.url), 'id')
      return HttpResponse.json(id ? events.filter(e => e.id === id) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      const rows = [...plans.keys()].map(event_id => ({ event_id, updated_at: '2026-10-28T10:00:00Z' }))
      return HttpResponse.json(id ? rows.filter(r => r.event_id === id) : rows)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_practices`, ({ request }) =>
      HttpResponse.json(plans.get(eq(new URL(request.url), 'event_id')!) ?? [])),
    rpc('save_training_plan', args => {
      saves.push(args)
      const sent = args.p_practices as Record<string, unknown>[]
      plans.set(String(args.p_event_id), sent.map(({ save_to_drills, ...p }, i) => ({
        ...p, position: i + 1, ...(save_to_drills ? { source: 'drill', drill_id: `drill-${i + 1}` } : {}),
      })))
      return null
    }),
  )
  return saves
}

beforeEach(() => {
  COACH = { id: `coach-295-${++n}` }
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
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const card = (title: string) => within(screen.getByRole('region', { name: 'Coming up' })).getAllByRole('article')
  .find(article => article.getAttribute('aria-label')?.endsWith(title))!
const practices = () => within(screen.getByRole('list', { name: 'Practices' })).queryAllByRole('listitem')
  .map(item => item.querySelector('p')?.textContent)

describe('TRAK-295: planning a training from Training home', { timeout: 20_000 }, () => {
  it('a training not planned has Create plan; a planned one has View plan and Edit plan (TRAK-310)', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    database([training('soon', onTheMinute(now + DAY)), training('later', onTheMinute(now + 3 * DAY))],
      { later: [practice(1, 'Rondos 4v1')] })
    renderApp('/coach/training')
    await waitFor(() => expect(within(card('Training soon')).getByRole('button', { name: 'Create plan' })).toBeInTheDocument())
    expect(within(card('Training soon')).queryByRole('button', { name: /View plan|Edit plan/ })).toBeNull()
    expect(within(card('Training later')).queryByRole('button', { name: 'Create plan' })).toBeNull()
    // No New session: every training coming up has its own Create plan.
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull()

    // Kostas, 29 Oct: View plan opens View, the screen the training's own View button opens; back goes to Training.
    await user.click(within(card('Training later')).getByRole('button', { name: 'View plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/later/view'))
    expect(await screen.findByRole('list', { name: 'Practices to run' })).toHaveTextContent('Rondos 4v1')
    await user.click(screen.getByRole('link', { name: 'Back to Training' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training'))
    await user.click(await within(await screen.findByRole('article', { name: /Training later$/ })).findByRole('button', { name: 'Edit plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/later/plan'))
  })

  it('Create plan asks how, Write my own opens the planner, and next time it says so', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training')
    await waitFor(() => expect(within(card('Training soon')).getByRole('button', { name: 'Create plan' })).toBeInTheDocument())
    await user.click(within(card('Training soon')).getByRole('button', { name: 'Create plan' }))
    let sheet = await screen.findByRole('dialog', { name: 'How do you want to plan it?' })
    expect(within(sheet).getByText(/Pitch 2 · 90 min/)).toBeInTheDocument()
    // Copy a past session is Training 4/5; Build it with Trak is parked.
    expect(within(sheet).queryByText(/Copy a past session|Build it with Trak/)).toBeNull()
    expect(within(sheet).queryByText('You used this last time')).toBeNull()
    await user.click(within(sheet).getByRole('button', { name: /Write my own/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon/plan'))
    expect(await screen.findByRole('form', { name: 'Practice 1' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Training' }))
    await waitFor(() => expect(within(card('Training soon')).getByRole('button', { name: 'Create plan' })).toBeInTheDocument())
    await user.click(within(card('Training soon')).getByRole('button', { name: 'Create plan' }))
    sheet = await screen.findByRole('dialog', { name: 'How do you want to plan it?' })
    expect(within(sheet).getByText('You used this last time')).toBeInTheDocument()
  })
})

describe('TRAK-295: Write my own', { timeout: 30_000 }, () => {
  it('types practices one at a time, changes, moves and removes them, and saves the plan whole', async () => {
    const user = userEvent.setup()
    const saves = database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/soon/plan')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Training loop' })).toHaveTextContent(/1 · Plan\s*\(now\)/)
    expect(screen.getByText('0 of 90 min planned')).toBeInTheDocument()

    // Practice 1, with what to tell them and a detail; Save to My drills starts ticked.
    let form = screen.getByRole('form', { name: 'Practice 1' })
    await user.click(within(form).getByRole('button', { name: 'Add practice' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Give the practice a name.')
    await user.type(within(form).getByLabelText('Name'), '  Pressing on the trigger ')
    await user.click(within(form).getByRole('button', { name: '25' }))
    await user.type(within(form).getByLabelText(/What you’ll tell them/), 'Press when their 6 turns back.')
    await user.click(within(form).getByText('Add details'))
    await user.type(within(form).getByLabelText('Area'), '30 × 40 m')
    expect(within(form).getByRole('checkbox', { name: /Save to My drills/ })).toBeChecked()
    await user.click(within(form).getByRole('button', { name: 'Add practice' }))
    await waitFor(() => expect(practices()).toEqual(['Pressing on the trigger']))
    expect(screen.getByText('25 of 90 min planned')).toBeInTheDocument()
    expect(screen.getByText('65 min left')).toBeInTheDocument()

    // Practice 2, not kept as a drill, written here.
    await user.click(screen.getByRole('button', { name: 'Write it' }))
    form = await screen.findByRole('form', { name: 'Practice 2' })
    await user.type(within(form).getByLabelText('Name'), 'Warm-up: rondos 4v1')
    await user.click(within(form).getByRole('checkbox', { name: /Save to My drills/ }))
    await user.click(within(form).getByRole('button', { name: 'Add practice' }))
    await waitFor(() => expect(practices()).toEqual(['Pressing on the trigger', 'Warm-up: rondos 4v1']))
    expect(screen.getByText('Written here')).toBeInTheDocument()

    // A third, then removed; the warm-up moved first; the pressing practice changed to 20 minutes.
    await user.click(screen.getByRole('button', { name: 'Write it' }))
    await user.type(within(await screen.findByRole('form', { name: 'Practice 3' })).getByLabelText('Name'), 'Cool-down')
    await user.click(screen.getByRole('button', { name: 'Add practice' }))
    await user.click(await screen.findByRole('button', { name: 'Remove Cool-down' }))
    await user.click(screen.getByRole('button', { name: 'Move Warm-up: rondos 4v1 up' }))
    await waitFor(() => expect(practices()).toEqual(['Warm-up: rondos 4v1', 'Pressing on the trigger']))
    expect(screen.getByRole('button', { name: 'Move Warm-up: rondos 4v1 up' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Edit Pressing on the trigger' }))
    form = await screen.findByRole('form', { name: 'Practice 2' })
    expect(within(form).getByLabelText('Name')).toHaveValue('Pressing on the trigger')
    await user.click(within(form).getByRole('button', { name: '20' }))
    await user.click(within(form).getByRole('button', { name: 'Keep changes' }))
    await waitFor(() => expect(screen.getByText('35 of 90 min planned')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon'))
    expect(saves).toHaveLength(1)
    expect(saves[0].p_event_id).toBe('soon')
    expect(saves[0].p_practices).toEqual([
      expect.objectContaining({ name: 'Warm-up: rondos 4v1', minutes: 15, source: 'own', save_to_drills: false }),
      expect.objectContaining({ name: 'Pressing on the trigger', minutes: 20, tell: 'Press when their 6 turns back.',
        area: '30 × 40 m', source: 'own', save_to_drills: true }),
    ])

    // The plan: Ready, the loop on Who's here next, each practice with where it came from.
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Training loop' })).toHaveTextContent(/2 · Who’s here\s*\(next\)/)
    expect(screen.getByText('2 practices · 35 min')).toBeInTheDocument()
    const plan = screen.getByRole('region', { name: 'Practices' })
    expect(within(plan).getByText('Written here')).toBeInTheDocument()
    expect(within(plan).getByText('Your drill')).toBeInTheDocument()
    expect(within(plan).getByText('“Press when their 6 turns back.”')).toBeInTheDocument()
  })

  it('Change the plan opens the saved plan to change; Save asks to finish a practice being typed first', async () => {
    const user = userEvent.setup()
    const saves = database([training('soon', onTheMinute(Date.now() + DAY))],
      { soon: [practice(1, 'Rondos 4v1'), practice(2, 'Game 8v8', { minutes: 30, source: 'drill', drill_id: 'd-1' })] })
    renderApp('/coach/training/soon')
    await user.click(await screen.findByRole('button', { name: 'Change the plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon/plan'))
    await waitFor(() => expect(practices()).toEqual(['Rondos 4v1', 'Game 8v8']))
    expect(screen.queryByRole('form')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Write it' }))
    await user.type(within(await screen.findByRole('form', { name: 'Practice 3' })).getByLabelText('Name'), 'Finishing')
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    expect(await screen.findByText('Add practice 3 or cancel it first.')).toBeInTheDocument()
    expect(saves).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    // A practice already saved is never sent to My drills again.
    expect(saves[0].p_practices).toEqual([
      expect.objectContaining({ name: 'Rondos 4v1', source: 'own', save_to_drills: false }),
      expect.objectContaining({ name: 'Game 8v8', source: 'drill', drill_id: 'd-1', save_to_drills: false }),
    ])
  })

  it("a failed save keeps everything typed and says so; the database's own refusal is said in its words", async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))])
    server.use(rpc('save_training_plan', () => ({ status: 503, body: { message: 'offline' } })))
    renderApp('/coach/training/soon/plan')
    const form = await screen.findByRole('form', { name: 'Practice 1' })
    await user.type(within(form).getByLabelText('Name'), 'Finishing 3v2')
    await user.click(within(form).getByRole('button', { name: 'Add practice' }))
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't save the plan.*Nothing you typed is lost/)
    expect(practices()).toEqual(['Finishing 3v2'])
    expect(window.location.pathname).toBe('/coach/training/soon/plan')

    server.use(rpc('save_training_plan', () => ({ status: 400, body: { code: 'P0001', message: 'This training was cancelled' } })))
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This training was cancelled.'))
  })

  it('a training not planned says so and offers to plan it; a cancelled one can’t be planned', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY)), training('off', onTheMinute(Date.now() + 2 * DAY), { status: 'cancelled' })])
    renderApp('/coach/training/soon')
    expect(await screen.findByText('Not planned yet')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Training loop' })).toHaveTextContent(/1 · Plan\s*\(now\)/)
    await user.click(screen.getAllByRole('button', { name: 'Plan this session' })[0])
    expect(await screen.findByRole('dialog', { name: 'How do you want to plan it?' })).toBeInTheDocument()

    cleanup()
    renderApp('/coach/training/off/plan')
    expect(await screen.findByText('This training was cancelled, so its plan can’t change.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save the plan' })).toBeNull()
  })

  it('a plan longer than the training says so plainly on both pages, and still saves (Kostas, 28 Oct)', async () => {
    const user = userEvent.setup()
    const saves = database([training('soon', onTheMinute(Date.now() + DAY))],
      { soon: [practice(1, 'Rondos 4v1', { minutes: 30 }), practice(2, 'Game 8v8', { minutes: 60 })] })
    renderApp('/coach/training/soon')
    const note = 'You set this training for 90 min. The plan runs 10 min over.'
    await user.click(await screen.findByRole('button', { name: 'Change the plan' }))
    await waitFor(() => expect(practices()).toEqual(['Rondos 4v1', 'Game 8v8']))
    expect(screen.queryByText(new RegExp(note))).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Write it' }))
    const form = await screen.findByRole('form', { name: 'Practice 3' })
    await user.type(within(form).getByLabelText('Name'), 'Cool-down')
    await user.click(within(form).getByRole('button', { name: '10' }))
    await user.click(within(form).getByRole('button', { name: 'Add practice' }))
    expect(await screen.findByText(new RegExp(note))).toBeInTheDocument()
    expect(screen.getByText('10 min over')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon'))
    expect(await screen.findByText(new RegExp(note))).toBeInTheDocument()
  })

  it("a training that isn't the coach's says so", async () => {
    database([])
    renderApp('/coach/training/someone-elses/plan')
    expect(await screen.findByText('This training isn’t on your schedule.')).toBeInTheDocument()
  })
})
