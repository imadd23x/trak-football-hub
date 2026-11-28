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
// Plan session one column (25 Nov): the part being planned moves with Move earlier and Move later, beside its bin.
const earlier = async (name: string) => screen.findByRole('button', { name: `Move ${name} earlier` })

// TRAK-456 (Imad, 16 Nov): a saved plan is changed in the planner, the training page's Training plan tab; Review & share
// is the match's Review card, so a part moves in Your session, beside each part, and the plan saves on Save the plan.
const parts = () => within(screen.getByRole('list', { name: 'Parts of the session' })).getAllByRole('listitem').map(li => li.textContent)
const toPart = async (name: string) => userEvent.click(await screen.findByRole('button', { name: `Edit ${name.toLowerCase()}` }))
const backToReview = () => userEvent.click(screen.getByRole('button', { name: 'Review & share' }))

describe('TRAK-367: moving a part on Review', { timeout: 30_000 }, () => {
  it('on a saved plan: Move earlier moves it, it saves the plan whole, and a first part can\u2019t move earlier', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))], SAVED)
    renderApp('/coach/training/soon?tab=plan')
    await toPart('Rondo')
    await user.click(await earlier('Rondo'))
    await waitFor(() => expect(parts()[0]).toContain('Rondo'))
    // The part being planned is still Rondo, now first.
    expect(await earlier('Rondo')).toBeDisabled()
    await backToReview()
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(sent(saves[0])).toEqual(['Rondo', 'Dry warm-up', 'Game'])
  })

  it('a move that can’t save stays and says so', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))], SAVED)
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/save_training_plan`, () => HttpResponse.json({ message: 'offline' }, { status: 503 })))
    renderApp('/coach/training/soon?tab=plan')
    await toPart('Game')
    await user.click(await earlier('Game'))
    await backToReview()
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/Couldn’t save/)
    expect(rows()[2]).toContain('Game 7 v 7')
  })

  it('on the planner’s Review step: it moves, and Save the plan saves that order', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))], SAVED)
    renderApp('/coach/training/soon/plan')
    await screen.findByRole('region', { name: 'Training plan review' })
    await toPart('Game')
    await user.click(await earlier('Game'))
    expect(saves).toHaveLength(0) // nothing saves until Save the plan
    await backToReview()
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
  // TRAK-584 (Kostas, 25 Nov): the Next training card is the match card's style, which has no message to players; the
  // message is edited in Events, as a match's is.
  it('the Next training card has no message line: it is edited in Events', async () => {
    database([training('soon', onTheMinute(Date.now() + 2 * DAY), { family_note: 'Bring shin pads.' })])
    renderApp('/coach/training')
    const next = await screen.findByRole('region', { name: 'Next training' }, { timeout: 5000 })
    await within(next).findByText('Training soon')
    expect(within(next).queryByText('Bring shin pads.')).toBeNull()
    expect(within(next).queryByRole('link', { name: /message/i })).toBeNull()
  })

  it('Schedule opens the event straight at its note', async () => {
    database([training('soon', onTheMinute(Date.now() + 2 * DAY), { family_note: 'Bring shin pads.' })])
    renderApp('/coach/schedule?edit=soon&step=2')
    // Kostas, 3 Nov: one name for it, here and on Training's card.
    expect(await screen.findByLabelText('Message to players (Optional)', {}, { timeout: 8000 })).toHaveValue('Bring shin pads.')
  })
})

describe('TRAK-367: the trail', { timeout: 30_000 }, () => {
  it('a page opened from Drills reads Training, Drills: never Training twice', async () => {
    const user = userEvent.setup()
    database([])
    renderApp('/coach/training')
    await user.click(await screen.findByRole('radio', { name: 'Drills' }, { timeout: 5000 }))
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
    // TRAK-456: Plan session is the training page's tab; the page's crumb is the training's day.
    expect(within(trail).getByText(/^\w{3} \d{1,2} \w{3}$/)).toBeInTheDocument()
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
    // TRAK-584: behind the Next training card's Plan session.
    await user.click(await screen.findByRole('button', { name: 'Plan session more actions' }, { timeout: 5000 }))
    await user.click(await screen.findByRole('menuitem', { name: 'Use a past plan' }))
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
