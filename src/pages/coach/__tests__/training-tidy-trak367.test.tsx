/**
 * TRAK-367 (Training redo 5/5, spec TRAK-338): the tidy-up. Kostas, 3 Nov: on Review a part moves as it does while
 * planning. The clash check's fixes: the message line is always there to add a message, and its Edit opens the form at
 * the note; Use a past plan puts the plans the coach would run again first. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { keepKeys, sameOrder, type Part } from '@/lib/training/parts'
import { yesFirst } from '@/lib/training/next'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

let n = 0
let COACH = { id: 'coach-367' }
function training(id: string, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', family_note: null, ...over,
  }
}
const trak = (position: number, id: string, name: string, part: string, part_type: string, minutes = 15) => ({
  position, name, minutes, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'trak', drill_id: null, library_session: null, part, part_type, trak_drill: id, players_kind: null, group_size: null,
})

function database(events: Record<string, unknown>[], start: Record<string, Record<string, unknown>[]> = {}) {
  const plans = new Map(Object.entries(start))
  const saves: Record<string, unknown>[] = []
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
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_drafts`, () => HttpResponse.json([])),
    http.get(`${SUPABASE_URL}/rest/v1/coach_drills`, () => HttpResponse.json([])),
    http.get(`${SUPABASE_URL}/rest/v1/coach_drill_bookmarks`, () => HttpResponse.json([])),
    rpc('save_training_plan', args => {
      saves.push(args)
      plans.set(String(args.p_event_id), (args.p_practices as Record<string, unknown>[]).map((p, i) => ({ ...p, position: i + 1 })))
      return null
    }),
  )
  return { saves }
}

beforeEach(() => {
  COACH = { id: `coach-367-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_notes', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const sent = (save: Record<string, unknown>) => (save.p_practices as Record<string, unknown>[]).map(p => p.part || p.name)
const rows = () => within(screen.getByRole('list', { name: 'The plan' })).getAllByRole('listitem').map(li => li.textContent)
const SAVED = { soon: [trak(1, 'w1', 'Dynamic warm-up', 'Dry warm-up', 'warmup', 10), trak(2, 'r1', 'Rondo 4 v 2', 'Rondo', 'rondo'), trak(3, 'g1', 'Game 7 v 7', 'Game', 'game', 25)] }
const handle = (name: string) => screen.findByRole('button', { name: `Move ${name}. Use the up and down arrow keys.` })

describe('TRAK-367: moving a part on Review', { timeout: 30_000 }, () => {
  it('on a saved plan: the arrow keys move it, it saves the plan whole, and the keyboard stays on it', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))], SAVED)
    renderApp('/coach/training/soon')
    const rondo = await handle('Rondo')
    rondo.focus()
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(sent(saves[0])).toEqual(['Rondo', 'Dry warm-up', 'Game'])
    await waitFor(() => expect(rows()[0]).toContain('Rondo 4 v 2'))
    // The plan comes back saved, and the row is still the same row.
    await waitFor(async () => expect(await handle('Rondo')).toHaveFocus())
    await user.keyboard('{ArrowUp}')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(saves).toHaveLength(1) // already first
  })

  it('a move that can’t save goes back and says so', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))], SAVED)
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/save_training_plan`, () => HttpResponse.json({ message: 'offline' }, { status: 503 })))
    renderApp('/coach/training/soon')
    ;(await handle('Game')).focus()
    await user.keyboard('{ArrowUp}')
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Couldn’t move it.')
    expect(rows()[2]).toContain('Game 7 v 7')
  })

  it('on the planner’s Review step: it moves, and Save the plan saves that order', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))], SAVED)
    renderApp('/coach/training/soon/plan')
    await screen.findByRole('heading', { name: 'Review' })
    ;(await handle('Game')).focus()
    await user.keyboard('{ArrowUp}')
    expect(saves).toHaveLength(0) // nothing saves until Save the plan
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(sent(saves[0])).toEqual(['Dry warm-up', 'Game', 'Rondo'])
  })

  it('a cancelled training’s plan can’t move', async () => {
    database([training('soon', onTheMinute(Date.now() + DAY), { status: 'cancelled' })], SAVED)
    renderApp('/coach/training/soon')
    expect(await screen.findByText(/Rondo 4 v 2/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
  })

  it('a part keeps its key when the plan comes back; a new part gets its own', () => {
    const part = (key: string, name: string): Part => ({ key, type: 'rondo', name, minutes: 15, drill: null })
    const before = [part('a', 'One'), part('b', 'Two')]
    expect(keepKeys(before, [part('x', 'Two'), part('y', 'One'), part('z', 'Three')]).map(p => p.key)).toEqual(['b', 'a', 'z'])
    expect(sameOrder(before, [part('x', 'One'), part('y', 'Two')])).toBe(true)
    expect(sameOrder(before, [part('x', 'Two'), part('y', 'One')])).toBe(false)
  })
})

describe('TRAK-367: the message to players', { timeout: 30_000 }, () => {
  const card = (title: string) => screen.findByRole('region', { name: title }, { timeout: 5000 })

  it('with a message, Edit opens the form at the note', async () => {
    database([training('soon', onTheMinute(Date.now() + 2 * DAY), { family_note: 'Bring shin pads.' })])
    renderApp('/coach/training')
    const next = await card('Training soon')
    expect(within(next).getByText('Bring shin pads.')).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/coach/schedule?edit=soon&step=2')
  })

  it('with none, Add a message is there', async () => {
    database([training('soon', onTheMinute(Date.now() + 2 * DAY))])
    renderApp('/coach/training')
    const next = await card('Training soon')
    expect(within(next).getByRole('link', { name: 'Add a message' })).toHaveAttribute('href', '/coach/schedule?edit=soon&step=2')
  })

  it('once it has started, the message stays with nothing to edit', async () => {
    database([training('now', onTheMinute(Date.now() - 20 * MINUTE), { family_note: 'Bring shin pads.' })])
    renderApp('/coach/training')
    const next = await card('Training now')
    expect(within(next).getByText('Bring shin pads.')).toBeInTheDocument()
    expect(within(next).queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  it('once it has started with no message, there is no line', async () => {
    database([training('empty', onTheMinute(Date.now() - 20 * MINUTE))])
    renderApp('/coach/training')
    const next = await card('Training empty')
    expect(within(next).queryByText(/Message to players/)).toBeNull()
  })

  it('Schedule opens the event straight at its note', async () => {
    database([training('soon', onTheMinute(Date.now() + 2 * DAY), { family_note: 'Bring shin pads.' })])
    renderApp('/coach/schedule?edit=soon&step=2')
    // Kostas, 3 Nov: one name for it, here and on Training's card.
    expect(await screen.findByLabelText('Message to players', {}, { timeout: 8000 })).toHaveValue('Bring shin pads.')
  })
})

describe('TRAK-367: the trail', { timeout: 30_000 }, () => {
  it('a page opened from Drills reads Training, Drills: never Training twice', async () => {
    const user = userEvent.setup()
    database([])
    renderApp('/coach/training')
    await user.click(await screen.findByRole('button', { name: 'Drills' }, { timeout: 5000 }))
    // TRAK-387: the Library's Technical tile (the old FA Library has a Technical tile too, below it).
    await user.click(within(await screen.findByRole('region', { name: 'What kind of practice?' }, { timeout: 5000 })).getByRole('link', { name: /^Technical/ }))
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb trail' }, { timeout: 5000 })
    expect(within(trail).getAllByText('Training')).toHaveLength(1)
    expect(within(trail).getByText('Drills')).toBeInTheDocument()
  })

  it('Plan session says which training, by its day', async () => {
    const soon = onTheMinute(Date.now() + DAY)
    database([training('soon', soon)])
    renderApp('/coach/training/soon/plan')
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb trail' }, { timeout: 5000 })
    expect(within(trail).getByText(/^Plan session · /)).toBeInTheDocument()
  })
})

describe('TRAK-367: Use a past plan', { timeout: 30_000 }, () => {
  it('puts the plans the coach would run again first, and says so', async () => {
    const user = userEvent.setup()
    const soon = onTheMinute(Date.now() + 2 * DAY)
    database([training('soon', soon), training('new', soon - 3 * DAY), training('old', soon - 9 * DAY)],
      { new: [trak(1, 'r1', 'Rondo 4 v 2', 'Rondo', 'rondo')], old: [trak(1, 'g1', 'Game 7 v 7', 'Game', 'game')] })
    server.use(table('training_notes', [{ event_id: 'old', again: 'yes', note: '' }, { event_id: 'new', again: 'no', note: '' }]))
    renderApp('/coach/training')
    await user.click(await screen.findByRole('button', { name: 'Use a past plan' }, { timeout: 5000 }))
    const list = await screen.findByRole('list', { name: 'Past plans' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Training old'))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('You’d run it again')
    expect(within(list).getAllByRole('listitem')[1]).not.toHaveTextContent('You’d run it again')
  })

  it('keeps the rest in their order', () => {
    const plans = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(yesFirst(plans, id => id === 'c').map(p => p.id)).toEqual(['c', 'a', 'b'])
  })
})
