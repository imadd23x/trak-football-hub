import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { atMorningToday } from '../../../../tests/support/clock'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { chooseCardAction, endActions } from '../../../../tests/support/schedule-actions'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toAcademyInstant, toInstant } from '@/lib/event-time'
import { pickTime, timeShown } from '../../../../tests/support/arc-pickers'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'

/**
 * TRAK-127 (J8.4). With events switched on, the coach creates a training,
 * match or other event as a draft, publishes it, edits it (live once
 * published), and cancels it: it stays on the schedule as Cancelled. Only a
 * draft nobody has seen can be deleted. A failed save keeps what was typed.
 * The AI "Read Schedule" import is gone (G7). Driven through the rendered app
 * and the real SDK.
 */

const COACH = { id: 'coach-1' }
const today = localTodayISO()
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`

const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: toInstant(today, '17:00'),
  ends_at: null, event_date: today, start_time: '17:00:00', venue: 'Academy Pitch 2', opponent: null,
  notes: null, published: false, source: 'manual', meet_time: null, kit: null, home_away: null,
  status: 'scheduled', cancel_reason: null, ...over,
})
const DRAFT = row({ id: 'draft-1', title: 'Finishing' })
const LIVE = row({
  id: 'live-1', title: 'vs Synthetic Rovers', event_type: 'match', opponent: 'Synthetic Rovers',
  starts_at: toInstant(today, '18:30'), start_time: '18:30:00', venue: 'Rovers Park', published: true,
})

type Write = { method: string; query: string; body: unknown }
let writes: Write[]
let requests: string[]
let rows: Record<string, unknown>[]
let failWrites: false | 'error' | 'no-row'
let emailNudges: number

function fixtures() {
  writes = []
  requests = []
  failWrites = false
  emailNudges = 0
  rows = [DRAFT, LIVE]
  server.events.on('request:start', ({ request }) => { requests.push(new URL(request.url).pathname) })
  const write = (method: string) => async ({ request }: { request: Request }) => {
    const body = method === 'delete' ? null : await request.json()
    writes.push({ method, query: decodeURIComponent(new URL(request.url).search), body })
    if (failWrites === 'error') return HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })
    if (failWrites === 'no-row') return HttpResponse.json([])
    return HttpResponse.json([{ id: 'written' }], { status: method === 'post' ? 201 : 200 })
  }
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json(rows)),
    table('coach_sessions', []),
    table('squad_players', []), // TRAK-139: the squad label for the WhatsApp message
    // TRAK-288: Games off unless a test turns it on: with it on, a new match asks its competition.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games'),
    // TRAK-286: no game plan, shared or not.
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    http.post(EVENTS, write('post')),
    http.patch(EVENTS, write('patch')),
    http.delete(EVENTS, write('delete')),
    // TRAK-135: the app asks the server to send queued family emails.
    http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => {
      emailNudges++
      return HttpResponse.json({ accepted: true }, { status: 202 })
    }),
  )
}

const card = (title: string) => screen.getByText(title).closest('div.rounded-\\[14px\\]') as HTMLElement
async function open() {
  renderApp('/coach/schedule')
  await screen.findByText('Finishing')
  // The switch is on: the "Coming soon" pill goes away.
  await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
}

// Picking through Arc's pickers takes a few seconds on a busy runner (TRAK-157).
describe('J8.4: the coach creates, edits and cancels events', { timeout: 20_000 }, () => {
  afterEach(() => { server.events.removeAllListeners(); vi.useRealTimers() })
  beforeEach(() => {
    // TRAK-230: today's 16:00–18:30 events are still to come, so they can be edited.
    atMorningToday()
    signInAs(COACH)
    fixtures()
  })

  it('creates a match with every field as a draft only the coach sees', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Away' }))
    await userEvent.type(within(sheet).getByLabelText('Venue'), 'United Ground')
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Kickoff', '16:00')
    await userEvent.click(within(sheet).getByRole('button', { name: '75 min' }))
    await pickTime(userEvent, /^Meet time/, '15:15')
    await eventStep(sheet, 'For families')
    await userEvent.type(within(sheet).getByLabelText('Kit'), 'Red shirts')
    // TRAK-182: Review shows everything before the save.
    await eventStep(sheet, 'Review')
    for (const [term, value] of [['Opponent', 'Synthetic United (Away)'], ['Title', 'vs Synthetic United'], ['Venue', 'United Ground'],
      ['Kickoff', '16:00'], ['Meet', '15:15'], ['Length', '75 min'], ['Kit', 'Red shirts'], ['Note for families', 'None']]) {
      expect(within(sheet).getByText(term).nextElementSibling).toHaveTextContent(value)
    }
    await saveEventWith(sheet, 'Save draft')

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].method).toBe('post')
    // One event is a one-row insert; a weekly series (J8.5) is the same insert with more rows.
    expect(writes[0].body).toHaveLength(1)
    const [inserted] = writes[0].body as Record<string, unknown>[]
    expect(inserted).toMatchObject({
      coach_user_id: COACH.id, title: 'vs Synthetic United', event_type: 'match',
      starts_at: toAcademyInstant(today, '16:00'),
      ends_at: new Date(new Date(toAcademyInstant(today, '16:00')!).getTime() + 75 * 60_000).toISOString(),
      event_date: today, start_time: '16:00:00', end_time: '17:15:00',
      venue: 'United Ground', meet_time: '15:15:00', opponent: 'Synthetic United',
      home_away: 'away', kit: 'Red shirts', published: false, source: 'manual',
    })
    // The app never writes the status or the sequence number.
    expect(inserted).not.toHaveProperty('status')
    expect(inserted).not.toHaveProperty('sequence')
    expect(inserted).not.toHaveProperty('series_id')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // A draft has no families yet: no email (TRAK-135).
    expect(emailNudges).toBe(0)
  })

  // TRAK-161 (J8.8): training kit matters too, and families get a short note
  // under it. Dora had typed "Shin guards are optional" into Kit.
  it('gives a training Kit and a note for families', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '17:00')
    await eventStep(sheet, 'For families')
    await userEvent.type(within(sheet).getByLabelText('Kit'), 'Green kits')
    const note = within(sheet).getByLabelText('Note for families')
    expect(note).toHaveAttribute('maxlength', '200')
    expect(within(sheet).getByText(/players and parents see this/i)).toBeInTheDocument()
    await userEvent.type(note, 'Bring extra water, it is a hot day')
    await saveEventWith(sheet, 'Save draft')

    await waitFor(() => expect(writes).toHaveLength(1))
    const [inserted] = writes[0].body as Record<string, unknown>[]
    expect(inserted).toMatchObject({ event_type: 'training', kit: 'Green kits', family_note: 'Bring extra water, it is a hot day' })
    // The coach-only notes column is never written from here.
    expect(inserted).not.toHaveProperty('notes')
  })

  // TRAK-161 follow-up (Kostas, #293): told as they type, not after families miss it.
  it('warns as the coach types a note families won\'t see', async () => {
    server.use(table('squad_players', [{ age_group: 'U15', player_name: 'Omar Haddad', status: 'active' }]))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '17:00')
    await eventStep(sheet, 'For families')
    const note = within(sheet).getByLabelText('Note for families')
    await userEvent.type(note, 'Bring water')
    expect(within(sheet).queryByText(/families won't see this note/i)).toBeNull()
    await userEvent.type(note, ', Omar brings the bibs')
    expect(await within(sheet).findByText("Families won't see this note: it names a player.")).toBeInTheDocument()
    await userEvent.clear(note)
    await userEvent.type(note, 'Directions: maps.app.goo.gl/abc')
    expect(within(sheet).getByText("Families won't see this note: it has a link.")).toBeInTheDocument()
    expect(note).toHaveAccessibleDescription(/it has a link/)
    // Review says it again, before the coach saves.
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByText("Families won't see this note: it has a link.")).toBeInTheDocument()
  })

  it('picks a venue the coach has used before', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const options = [...document.querySelectorAll('#saved-venues option')].map(o => (o as HTMLOptionElement).value)
    // Most recent first: the 18:30 match, then the 17:00 training.
    expect(options).toEqual(['Rovers Park', 'Academy Pitch 2'])
  })

  it('says what is missing and sends nothing', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    // TRAK-182: Next stops on the step that can fix it, and says what's missing.
    const next = () => userEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    await next()
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Add the opponent')
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    expect(within(sheet).queryByRole('alert')).toBeNull()
    await next()

    // TRAK-157: no event saves without a start time; there is no "no time".
    expect(timeShown('Kickoff')).toBe('Pick a start time')
    await next()
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Pick a start time')
    expect(within(sheet).queryByText(/time not set/i)).toBeNull()

    await pickTime(userEvent, 'Kickoff', '16:00')
    await pickTime(userEvent, /^Meet time/, '16:30')
    await next()
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Meet time must be before the start')
    expect(within(sheet).getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it.each([
    { mode: 'error', why: 'the request fails' },
    { mode: 'no-row', why: 'the database refuses the row' },
  ] as const)(
    'keeps what was typed and says what failed when $mode ($why)', async ({ mode }) => {
      await open()
      failWrites = mode
      await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
      const sheet = screen.getByRole('dialog', { name: 'New event' })
      await userEvent.type(within(sheet).getByLabelText('Venue'), 'Academy Pitch 1')
      await eventStep(sheet, 'When')
      await pickTime(userEvent, 'Start', '17:00')
      await saveEventWith(sheet, 'Save draft')

      expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't save the event")
      expect(screen.getByRole('dialog', { name: 'New event' })).toBeInTheDocument()
      await eventStep(sheet, 'What')
      expect(within(sheet).getByLabelText('Venue')).toHaveValue('Academy Pitch 1')
      await eventStep(sheet, 'When')
      expect(timeShown('Start')).toBe('5:00 PM')
    })

  it('publishes a draft', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Publish Finishing' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'patch', query: '?id=eq.draft-1&select=id', body: { published: true } })
    // TRAK-135 (16 Oct): publishing emails families too, so the app asks the server to send.
    await waitFor(() => expect(emailNudges).toBe(1))
  })

  // TRAK-182 (Imad's 7c): Review's Publish saves, then publishes what it saved.
  it('publishes a new event from Review', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '17:00')
    await saveEventWith(sheet, 'Publish')

    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[0]).toMatchObject({ method: 'post' })
    expect((writes[0].body as Record<string, unknown>[])[0]).toMatchObject({ published: false })
    expect(writes[1]).toMatchObject({ method: 'patch', query: '?id=in.(written)&select=id', body: { published: true } })
    expect(await screen.findByText('Published to the squad')).toBeInTheDocument()
    await waitFor(() => expect(emailNudges).toBe(1)) // TRAK-135
  })

  it('publishes a draft it edits, from Review', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Finishing' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit event' })
    await saveEventWith(sheet, 'Publish')
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[0]).toMatchObject({ method: 'patch', query: '?id=eq.draft-1&select=id' })
    expect(writes[0].body).not.toHaveProperty('published')
    expect(writes[1]).toMatchObject({ method: 'patch', query: '?id=in.(draft-1)&select=id', body: { published: true } })
    await waitFor(() => expect(emailNudges).toBe(1)) // TRAK-135
  })

  // A clash (TRAK-158) refuses the publish, not the save: the draft stays, said plainly.
  it('keeps the draft and says why when the publish is refused', async () => {
    let patches = 0
    server.use(http.patch(EVENTS, async ({ request }) => {
      writes.push({ method: 'patch', query: decodeURIComponent(new URL(request.url).search), body: await request.json() })
      return ++patches === 1
        ? HttpResponse.json([{ id: 'draft-1' }])
        : HttpResponse.json({ code: 'P0001', message: 'This overlaps vs Synthetic Rovers (18:30–20:00).' }, { status: 400 })
    }))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Finishing' }))
    await saveEventWith(screen.getByRole('dialog', { name: 'Edit event' }), 'Publish')
    expect(await screen.findByText(/Saved as a draft, not published\. This overlaps vs Synthetic Rovers/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(emailNudges).toBe(0) // TRAK-135: a refused publish emails nobody
  })

  it('edits a published event live, without touching published', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Edit vs Synthetic Rovers' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit event' })
    // TRAK-182 (live run 3, 16 Oct): an edit opens on the first step, filled in from the saved event.
    expect(sheet.querySelector('[aria-current="step"]')).toHaveTextContent('What')
    expect(within(sheet).getByLabelText('Opponent')).toHaveValue('Synthetic Rovers')
    await eventStep(sheet, 'When')
    expect(timeShown('Kickoff')).toBe('6:30 PM')
    // A published event has no Publish or draft.
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByText('Families see the change as soon as you save.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Publish' })).toBeNull()
    await eventStep(sheet, 'What')
    const venue = within(sheet).getByLabelText('Venue')
    await userEvent.clear(venue)
    await userEvent.type(venue, 'Rovers Park Pitch 3')
    await saveEventWith(sheet, 'Save changes')

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'patch', query: '?id=eq.live-1&select=id' })
    expect(writes[0].body).toMatchObject({ venue: 'Rovers Park Pitch 3', title: 'vs Synthetic Rovers', opponent: 'Synthetic Rovers' })
    expect(writes[0].body).not.toHaveProperty('published')
    // TRAK-135: the server is asked to send whatever email the change queued.
    await waitFor(() => expect(emailNudges).toBe(1))
  })

  it('cancels a published event: it stays, marked Cancelled, and nothing is deleted', async () => {
    await open()
    // A published event has no Delete: families have seen it.
    expect(endActions('vs Synthetic Rovers')).toEqual(['Cancel'])
    await chooseCardAction('vs Synthetic Rovers', 'Cancel')
    const sheet = screen.getByRole('dialog', { name: 'Cancel event' })
    await userEvent.type(within(sheet).getByLabelText('Reason (optional)'), 'Pitch waterlogged')
    rows = [DRAFT, { ...LIVE, status: 'cancelled', cancel_reason: 'Pitch waterlogged' }]
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel event' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      method: 'patch', query: '?id=eq.live-1&select=id', body: { status: 'cancelled', cancel_reason: 'Pitch waterlogged' },
    })
    expect(await within(card('vs Synthetic Rovers')).findByText('Cancelled')).toBeInTheDocument()
    expect(within(card('vs Synthetic Rovers')).getByText('Pitch waterlogged')).toBeInTheDocument()
    // A cancelled event can't be edited, published or cancelled again: its card opens its sheet (the title) and shares the cancellation.
    expect(within(card('vs Synthetic Rovers')).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent?.trim()))
      .toEqual(['vs Synthetic Rovers', 'Share vs Synthetic Rovers'])
    expect(writes.some(w => w.method === 'delete')).toBe(false)
    // TRAK-135: and the families' cancellation email is sent.
    expect(emailNudges).toBe(1)
  })

  it('deletes only a draft nobody has seen', async () => {
    await open()
    await chooseCardAction('Finishing', 'Delete')
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'delete', query: '?id=eq.draft-1&select=id' })
    expect(emailNudges).toBe(0)
  })

  it('offers no AI import and never calls parse-schedule (G7)', async () => {
    await open()
    expect(screen.queryByRole('button', { name: /Read Schedule/i })).toBeNull()
    expect(screen.queryByText(/Import from text/i)).toBeNull()
    expect(requests.some(p => p.includes('parse-schedule'))).toBe(false)
  })

  it('reads past sessions with real coach_sessions columns only', async () => {
    // coach_sessions has no opponent column. Asking for one failed every load
    // with 42703, so the live screen said "Couldn't connect" (found 9 Oct).
    const types = readFileSync(`${process.cwd()}/src/integrations/supabase/types.ts`, 'utf8')
    const block = types.match(/\n {6}coach_sessions: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/)![1]
    const real = new Set([...block.matchAll(/^\s+(\w+):/gm)].map(m => m[1]))
    let asked: string[] = []
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, ({ request }) => {
      asked = (new URL(request.url).searchParams.get('select') ?? '').split(',')
      const unknown = asked.filter(c => !real.has(c))
      if (unknown.length) {
        return HttpResponse.json({ code: '42703', message: `column coach_sessions.${unknown[0]} does not exist` }, { status: 400 })
      }
      return HttpResponse.json([{
        id: 's-1', coach_user_id: COACH.id, title: 'Recovery session', session_type: 'training',
        session_date: today, competition: null, venue: 'Gym', notes: null,
      }])
    }))
    await open()
    expect(await screen.findByText('Recovery session')).toBeInTheDocument()
    expect(screen.queryByText(/We couldn't load your schedule/)).toBeNull()
    expect(asked.length).toBeGreaterThan(0)
  })

  it('says the calendar failed to load instead of showing it empty', async () => {
    server.use(http.get(EVENTS, () => HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })))
    renderApp('/coach/schedule')
    expect(await screen.findByText(/We couldn't load your schedule/)).toBeInTheDocument()
  })
})

// TRAK-283 (Games 1/8): with Games on, a match just published offers its next step, the game plan.
describe('TRAK-283: a match just published offers its game plan', { timeout: 20_000 }, () => {
  afterEach(() => { server.events.removeAllListeners(); vi.useRealTimers() })
  beforeEach(() => {
    atMorningToday()
    // TRAK-288: Games on. The app keeps a switch's answer for 30 s, so the academy with Games is another coach's.
    signInAs({ id: 'coach-1-games' })
    fixtures()
    server.use(rpc('feature_on', () => true))
    rows = [DRAFT, row({ id: 'match-1', title: 'vs Parkview Athletic', event_type: 'match', opponent: 'Parkview Athletic',
      starts_at: toInstant(today, '20:00'), start_time: '20:00:00' })]
  })
  // By keyboard: a toast's button is reachable without a pointer (and jsdom has no pointer capture for Sonner's swipe).
  const takeNextStep = async () => {
    const button = await screen.findByRole('button', { name: 'Write the game plan' })
    button.focus()
    await userEvent.keyboard('{Enter}')
  }

  it("the list's Publish: Write the game plan opens the match's game page", async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Publish vs Parkview Athletic' }))
    expect(await screen.findByText('Published to the squad')).toBeInTheDocument()
    await takeNextStep()
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/coach/games/match-1?tab=plan'))
  })

  it("Review's Publish of a new match offers it too", async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    // TRAK-288: with Games on, New event asks a match's competition.
    await userEvent.click(within(within(sheet).getByRole('group', { name: 'Competition' })).getByRole('button', { name: 'League' }))
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Kickoff', '16:00')
    await saveEventWith(sheet, 'Publish')
    await takeNextStep()
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/coach/games/written?tab=plan'))
  })

  it('a training gets the usual toast only', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Publish Finishing' }))
    expect(await screen.findByText('Published to the squad')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write the game plan' })).toBeNull()
  })

  it('so does a match where Games is off', async () => {
    // The app keeps a switch's answer for 30 s, so the academy without Games is another coach's.
    signInAs({ id: 'coach-1-no-games' })
    server.use(rpc('feature_on', ({ p_feature }) => p_feature === 'events'))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Publish vs Parkview Athletic' }))
    expect(await screen.findByText('Published to the squad')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write the game plan' })).toBeNull()
  })
})
