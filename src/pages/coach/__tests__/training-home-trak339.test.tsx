/**
 * TRAK-339 (Training redo 1/5, spec TRAK-338, 2 Nov prototype): Training home laid out like Matches. The Next training
 * card shows one training, where it is in its loop (Logistics → Plan → Who's here → Notes) and its next action: Plan
 * session or Use a past plan; Review plan and Edit plan; on the day Who's here; after it, Notes ("Would you run this
 * session again?") saved or skipped. Upcoming trainings is a row; Past trainings is a button at the bottom that opens
 * its own page, where a plan can be copied into a training coming up. Test people are named after footballers.
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
let COACH = { id: 'coach-339' }
function training(id: string, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', family_note: null, ...over,
  }
}
const practice = (position: number, name: string, over: Record<string, unknown> = {}) => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, ...over,
})

/** Trainings, plans, registers (completed sessions by event) and Notes as the database keeps them. Notes written are
 *  kept for the test to read. */
function database(events: Record<string, unknown>[], plans: Record<string, Record<string, unknown>[]> = {},
  registers: Record<string, string> = {}, startNotes: Record<string, unknown>[] = []) {
  const notes = [...startNotes]
  const written: Record<string, unknown>[] = []
  // One row by eq.<id>; every row asked for by in.(…); everything when unfiltered.
  const eq = (url: URL, key: string) => url.searchParams.get(key)?.match(/^eq\.(.*)$/)?.[1]
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const id = eq(new URL(request.url), 'id')
      return HttpResponse.json(id ? events.filter(e => e.id === id) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      const rows = Object.keys(plans).map(event_id => ({ event_id, updated_at: '2026-11-01T10:00:00Z' }))
      return HttpResponse.json(id ? rows.filter(r => r.event_id === id) : rows)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_practices`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      if (id) return HttpResponse.json(plans[id] ?? [])
      return HttpResponse.json(Object.entries(plans).flatMap(([event_id, rows]) => rows.map(row => ({ event_id, ...row }))))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () =>
      HttpResponse.json(Object.entries(registers).map(([event_id, id]) => ({ id, event_id })))),
    http.get(`${SUPABASE_URL}/rest/v1/training_notes`, () => HttpResponse.json(notes)),
    http.post(`${SUPABASE_URL}/rest/v1/training_notes`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      written.push(body)
      notes.push(body)
      return HttpResponse.json({ event_id: body.event_id })
    }),
  )
  return written
}

beforeEach(() => {
  COACH = { id: `coach-339-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Virgil van Dijk', age_group: 'U16', status: 'active' },
    ]),
    table('session_attendance', [{ session_id: 'session-done', squad_player_id: 'sp-1', status: 'present' },
      { session_id: 'session-done', squad_player_id: 'sp-2', status: 'present' }]),
    table('event_absences', []),
    table('coach_drills', []),
    table('training_plan_drafts', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const nextCard = (title: string) => screen.findByRole('region', { name: title }, { timeout: 5000 })

describe('TRAK-339: the Next training card', { timeout: 30_000 }, () => {
  it('not planned: Plan session goes straight to the planner; the message to players and the loop show', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + 2 * DAY), { title: 'Pressing triggers', family_note: 'Bring shin pads.' }),
      training('later', onTheMinute(Date.now() + 4 * DAY))])
    renderApp('/coach/training')
    const card = await nextCard('Pressing triggers')
    // Kostas, 30 Oct: no visible "Training" or "Next training" title; the name leads the card.
    expect(screen.getByRole('heading', { level: 1, name: 'Training' })).toHaveClass('sr-only')
    expect(within(card).queryByText('Next training')).toBeNull()
    expect(within(card).getByText('Plan not written')).toBeInTheDocument()
    expect(within(card).getByText(/Pitch 2 · 90 min/)).toBeInTheDocument()
    for (const step of ['Logistics', 'Plan', 'Who’s here', 'Notes']) expect(within(card).getAllByText(step).length).toBeGreaterThan(0)
    expect(within(card).getByText('Bring shin pads.')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/coach/schedule?event=soon')
    expect(within(card).getByRole('button', { name: 'Use a past plan' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Plan session' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon/plan'))
    expect(screen.queryByRole('dialog', { name: 'How do you want to plan it?' })).toBeNull()
  })

  it('planned: Review plan opens the plan, Edit plan the planner', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + 2 * DAY))], { soon: [practice(1, 'Rondo 4 v 2')] })
    renderApp('/coach/training')
    const card = await nextCard('Training soon')
    expect(await within(card).findByText('Plan ready')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Plan session' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Edit plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon/plan'))
    window.history.back()
    await user.click(within(await nextCard('Training soon')).getByRole('button', { name: 'Review plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/soon'))
  })

  it('on the day: Today, and Who’s here opens the register', async () => {
    const user = userEvent.setup()
    database([training('today', onTheMinute(Date.now() - 20 * MINUTE))], { today: [practice(1, 'Rondo 4 v 2')] })
    renderApp('/coach/training')
    const card = await nextCard('Training today')
    expect(within(card).getByText('Today', { selector: 'span' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Review plan' })).toBeInTheDocument()
    // TRAK-342: Who's here is its own page.
    await user.click(within(card).getByRole('button', { name: 'Who’s here' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/today/here'))
    expect(await screen.findByRole('button', { name: 'Mohamed Salah: present' })).toBeInTheDocument()
  })

  it('after the training: Notes on the card; Save and close keeps the answer and moves the card on', async () => {
    const user = userEvent.setup()
    const written = database([
      training('done', onTheMinute(Date.now() - 3 * HOUR), { title: 'Defending the box' }),
      training('next', onTheMinute(Date.now() + 2 * DAY), { title: 'Counter-attacks' }),
    ], { done: [practice(1, 'Rondo 4 v 2')] }, { done: 'session-done' })
    renderApp('/coach/training')
    const card = await nextCard('Defending the box')
    expect(await within(card).findByText('2 here')).toBeInTheDocument()
    expect(within(card).queryByText('No register taken')).toBeNull()
    expect(within(card).queryByText('No plan written')).toBeNull()
    expect(within(card).getByText('Would you run this session again?')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Yes, with changes' }))
    await user.type(within(card).getByLabelText('A note for next time'), '  Rondo grids too small. ')
    await user.click(within(card).getByRole('button', { name: 'Save and close' }))
    await waitFor(() => expect(written).toEqual([{ event_id: 'done', again: 'changes', note: 'Rondo grids too small.' }]))
    expect(await screen.findByText('Defending the box is closed.')).toBeInTheDocument()
    expect(await nextCard('Counter-attacks')).toBeInTheDocument()
  })

  it('Skip and close keeps a row with no answer, so the card moves on all the same', async () => {
    const user = userEvent.setup()
    const written = database([training('done', onTheMinute(Date.now() - 3 * HOUR), { title: 'Defending the box' })])
    renderApp('/coach/training')
    const card = await nextCard('Defending the box')
    expect(within(card).getByText('Finished')).toBeInTheDocument()
    // Live check, 3 Nov: no register, so Who's here isn't ticked; it says so.
    expect(within(card).getAllByText('No register taken').length).toBeGreaterThan(0)
    expect(within(card).getAllByText('No plan written').length).toBeGreaterThan(0)
    // No plan, so nothing to review.
    expect(within(card).queryByRole('button', { name: 'Review today’s plan' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Skip and close' }))
    await waitFor(() => expect(written).toEqual([{ event_id: 'done', again: null, note: '' }]))
    expect(await screen.findByText('No training coming up')).toBeInTheDocument()
  })

  it('a training that ended over a day ago doesn’t wait for Notes: the card shows the next one', async () => {
    database([training('old', onTheMinute(Date.now() - 2 * DAY)), training('next', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training')
    expect(await nextCard('Training next')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Training old' })).toBeNull()
  })

  it('Upcoming trainings: every one coming up, soonest first, each with its badge', async () => {
    const now = Date.now()
    database([training('later', onTheMinute(now + 5 * DAY), { title: 'Finishing' }), training('soon', onTheMinute(now + 2 * DAY), { title: 'Pressing' })],
      { later: [practice(1, 'Rondo 4 v 2')] })
    renderApp('/coach/training')
    const row = (await screen.findAllByRole('region', { name: 'Upcoming trainings' }))[0]
    const links = within(row).getAllByRole('link')
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/coach/training/soon', '/coach/training/later'])
    expect(links[0]).toHaveTextContent('Plan not written')
    await waitFor(() => expect(links[1]).toHaveTextContent('Plan ready'))
  })
})

describe('TRAK-339: Past trainings', { timeout: 30_000 }, () => {
  it('a button at the bottom opens them: newest first, the plan, who came and the Notes; Use this plan copies into a training coming up', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    database([
      training('older', onTheMinute(now - 9 * DAY), { title: 'First session' }),
      training('done', onTheMinute(now - 3 * DAY), { title: 'Pressing' }),
      training('next', onTheMinute(now + DAY), { title: 'Counter-attacks' }),
    ], { done: [practice(1, 'Rondo 4 v 2'), practice(2, 'Counter-pressing 5 v 3', { minutes: 25 })] }, { done: 'session-done' },
    [{ event_id: 'done', again: 'yes', note: 'Keep the five-second rule.' }])
    renderApp('/coach/training')
    const button = await screen.findByRole('button', { name: /^Past trainings/ })
    await waitFor(() => expect(button).toHaveTextContent('2'))
    await user.click(button)
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/past'))
    const list = await screen.findByRole('list', { name: 'Past trainings' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Pressing')
    expect(items[0]).toHaveTextContent('2 practices · 40 min · Rondo 4 v 2, Counter-pressing 5 v 3')
    await waitFor(() => expect(items[0]).toHaveTextContent('2 here'))
    expect(items[0]).toHaveTextContent('Run it again: Yes')
    expect(items[0]).toHaveTextContent('“Keep the five-second rule.”')
    expect(items[1]).toHaveTextContent('No plan written')
    expect(within(items[1]).queryByRole('button', { name: /Use this plan/ })).toBeNull()

    await user.type(screen.getByRole('searchbox', { name: 'Search past trainings' }), 'five-second')
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))

    await user.click(within(list).getByRole('button', { name: /^Use this plan: Pressing/ }))
    const pick = await screen.findByRole('dialog', { name: 'Copy Pressing into which training?' })
    await user.click(within(pick).getByRole('button', { name: /^Copy here: Counter-attacks/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/next/plan'))
    expect(await screen.findByText(/Copied from Pressing, .+ Nothing is saved until you do\./)).toBeInTheDocument()
  })

  it('with none yet, says so', async () => {
    database([training('next', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/past')
    expect(await screen.findByText('No past trainings yet')).toBeInTheDocument()
  })
})
