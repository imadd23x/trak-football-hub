/**
 * TRAK-391 (Drill Library 6/11, parent TRAK-384): Add to training. On a drill's page, Add to training asks which
 * training coming up; picking one opens Plan session with the drill added as a new part at the end (Kostas, 8 Nov), at
 * the players and level set on the page, whether the training has no plan, a draft or a saved plan. Nothing is saved
 * until the coach saves; the saved plan keeps the drill's level. Once a training coming up holds the drill, the button
 * says "Added to <day>" and opens it. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { LIBRARY, START_LEVEL, drillPath, fit, step } from '@/lib/training/library'
import { gameWhen } from '@/components/coach/games/useGames'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const drill = (name: string) => LIBRARY.find(d => d.name === name)!
const PLAYERS = 12

let n = 0
let COACH = { id: 'coach-391' }
function training(id: string, start: number, title: string) {
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', family_note: null,
  }
}
const practice = (position: number, name: string, over: Record<string, unknown> = {}) => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part: name, part_type: 'own', trak_drill: null, players_kind: null,
  group_size: null, trak_level: null, ...over,
})

/** Trainings, plans and drafts as the database keeps them; saves are kept for the test to read. */
function database(events: Record<string, unknown>[], start: Record<string, Record<string, unknown>[]> = {},
  drafts: Record<string, unknown>[] = []) {
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
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_drafts`, () => HttpResponse.json(drafts)),
    rpc('save_training_plan', args => {
      saves.push(args)
      plans.set(String(args.p_event_id), (args.p_practices as Record<string, unknown>[]).map((p, i) => ({ ...p, position: i + 1 })))
      return null
    }),
  )
  return { saves }
}

beforeEach(() => {
  COACH = { id: `coach-391-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', Array.from({ length: PLAYERS }, (_, i) => ({ id: `sp-${i}`, coach_user_id: COACH.id, player_name: `Player ${i}`, age_group: 'U16', status: 'active' }))),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_notes', []),
    table('coach_drills', []),
    table('coach_drill_bookmarks', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const rows = () => within(screen.getByRole('list', { name: 'The plan' })).getAllByRole('listitem')
  .map(item => item.textContent?.replace(/\s+/g, ' ').trim() ?? '')
const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  const add = await screen.findByRole('button', { name: 'Add to training' })
  await waitFor(() => expect(add).toBeEnabled())
  await user.click(add)
  return screen.findByRole('list', { name: 'Trainings coming up' })
}

describe('TRAK-391: Add to training', { timeout: 30_000 }, () => {
  it('lists the trainings coming up; the drill joins a training with no plan at the end, at the level set; the plan keeps it', async () => {
    const user = userEvent.setup()
    const keep = drill('Pass between defenders')
    const soon = onTheMinute(Date.now() + DAY), later = onTheMinute(Date.now() + 3 * DAY)
    const { saves } = database([training('soon', soon, 'Pressing triggers'), training('later', later, 'Rondos'),
      training('gone', onTheMinute(Date.now() - 3 * DAY), 'Last week')])
    renderApp(drillPath(keep.id))
    await user.click(await screen.findByRole('button', { name: /Harder/ }))
    const level = step(keep, PLAYERS, START_LEVEL, 1)!.level

    const list = await openPicker(user)
    expect(screen.getByRole('heading', { name: 'Add Pass between defenders to which training?' })).toBeInTheDocument()
    // Coming up only, soonest first, each with its day, time and how far its plan is.
    const items = within(list).getAllByRole('listitem').map(li => li.textContent)
    expect(items).toHaveLength(2)
    expect(items[0]).toContain('Pressing triggers')
    expect(items[0]).toContain(`${gameWhen(training('soon', soon, '')).day}`)
    expect(items[0]).toContain('Not planned')
    expect(items[1]).toContain('Rondos')

    await user.click(within(list).getByRole('button', { name: `Add to Pressing triggers, ${gameWhen(training('soon', soon, '')).day}` }))
    // Plan session at Review: Trak's five, then the drill as a sixth part. Nothing saved yet.
    expect(await screen.findByText('Pass between defenders is added at the end. Check the plan, then save it.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
    const parts = rows()
    expect(parts).toHaveLength(6)
    expect(parts[5]).toContain('Pass between defenders')
    expect(saves).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    const sent = (saves[0].p_practices as Record<string, unknown>[]).at(-1)!
    const fitted = fit(keep, PLAYERS, level).details
    expect(sent).toMatchObject({
      name: 'Pass between defenders', part: 'Rondo', part_type: 'rondo', minutes: 15, source: 'trak', trak_drill: keep.id, trak_level: level,
      area: fitted.area, numbers: fitted.numbers, targets: fitted.targets, direction: fitted.direction, conditions: fitted.conditions,
    })
    expect(String(sent.how)).toContain(keep.how[0])
    // TRAK-392: the usual shape's own drills are the Library's, at the standard level.
    expect((saves[0].p_practices as Record<string, unknown>[]).slice(0, 5).every(p => p.trak_level === START_LEVEL)).toBe(true)
  })

  it('joins a saved plan, and a draft, at the end; not twice when it’s already there', async () => {
    const user = userEvent.setup()
    const corners = drill('Four corners')
    const soon = onTheMinute(Date.now() + DAY), later = onTheMinute(Date.now() + 2 * DAY)
    database([training('planned', soon, 'Pressing triggers'), training('drafted', later, 'Rondos')],
      { planned: [practice(1, 'Our warm-up'), practice(2, 'Our game')] },
      [{ event_id: 'drafted', step: 1, updated_at: '2026-11-01T10:00:00Z', body: { note: 'Bring bibs', parts: [
        { key: 'd1', type: 'own', name: 'Shooting', minutes: 20, drill: { ...practice(1, 'Shooting'), position: undefined, minutes: 0 } }] } }])
    renderApp(drillPath(corners.id))
    const list = await openPicker(user)
    expect(within(list).getAllByRole('listitem').map(li => li.textContent?.split(' · ').at(-1)?.replace(/Add$/, ''))).toEqual(['Planned', 'Draft'])
    await user.click(within(list).getByRole('button', { name: /^Add to Pressing triggers/ }))
    await screen.findByRole('heading', { name: 'Review' })
    expect(rows().map(r => r.includes('Four corners') ? 'corners' : r.includes('Our warm-up') ? 'warm-up' : r.includes('Our game') ? 'game' : r))
      .toEqual(['warm-up', 'game', 'corners'])
    cleanup()

    renderApp(drillPath(corners.id))
    await user.click(within(await openPicker(user)).getByRole('button', { name: /^Add to Rondos/ }))
    await screen.findByRole('heading', { name: 'Review' })
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toContain('Shooting')
    expect(rows()[1]).toContain('Four corners')
    expect(screen.getByLabelText(/A note for you/)).toHaveValue('Bring bibs')
  })

  it('a training that already holds the drill: the button says Added to <day> and opens its plan; adding again doesn’t double it', async () => {
    const user = userEvent.setup()
    const keep = drill('Keep the ball')
    const soon = onTheMinute(Date.now() + DAY)
    database([training('planned', soon, 'Pressing triggers')],
      { planned: [practice(1, 'Our warm-up'), practice(2, 'Keep the ball', { source: 'trak', trak_drill: keep.id, part: 'Rondo', part_type: 'rondo', trak_level: 4 })] })
    renderApp(drillPath(keep.id))
    const day = gameWhen(training('planned', soon, '')).day
    const added = await screen.findByRole('link', { name: `Added to ${day}` })
    expect(added).toHaveAttribute('href', '/coach/training/planned/plan')

    await user.click(screen.getByRole('button', { name: 'Add to another training' }))
    const list = await screen.findByRole('list', { name: 'Trainings coming up' })
    expect(within(list).getByRole('listitem').textContent).toContain('Has this drill')
    await user.click(within(list).getByRole('button', { name: /^Add to Pressing triggers/ }))
    expect(await screen.findByText(/^Keep the ball is already in this plan, in Rondo\./)).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
  })

  it('a drill the plan already holds (the usual shape’s starter) isn’t added twice; that part takes the level set', async () => {
    const user = userEvent.setup()
    const keep = drill('Keep the ball')
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY), 'Pressing triggers')])
    renderApp(drillPath(keep.id))
    await user.click(await screen.findByRole('button', { name: /Harder/ }))
    await user.click(within(await openPicker(user)).getByRole('button', { name: /^Add to Pressing triggers/ }))
    expect(await screen.findByText('Keep the ball is already in this plan, in Rondo. It’s now set as you left it on its page.')).toBeInTheDocument()
    expect(rows()).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect((saves[0].p_practices as Record<string, unknown>[])[2]).toMatchObject({ trak_drill: keep.id, trak_level: step(keep, PLAYERS, START_LEVEL, 1)!.level })
  })

  it('with no trainings coming up, says so', async () => {
    const user = userEvent.setup()
    database([])
    renderApp(drillPath(drill('Four corners').id))
    await user.click(await screen.findByRole('button', { name: 'Add to training' }))
    expect(await screen.findByText('No trainings coming up. Add one in Events, then add this drill to it.')).toBeInTheDocument()
  })
})
