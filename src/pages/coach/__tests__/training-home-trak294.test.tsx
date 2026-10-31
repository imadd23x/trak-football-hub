/**
 * TRAK-294 (Training 1/5, spec TRAK-293): with the academy's training switch on, Training takes Library's place in
 * the coach's nav. Training home lists the coach's own trainings (Coming up, then Last week) of the squad in view;
 * Drills holds My drills (add, change, delete, search) and the Library's tiles. With the switch off, the nav keeps
 * Library and Training is parked. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { pickSquad } from '../../../../tests/support/squad-switcher'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, tableError, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

let n = 0
let COACH = { id: 'coach-294' }
function training(id: string, squad: string | null, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad, title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', ...over,
  }
}
const drill = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  updated_at: '2026-10-27T10:00:00Z', ...over,
})
/** The events read answers with these rows and keeps what each request asked for. */
function eventsRead(rows: Record<string, unknown>[]) {
  const asked: URL[] = []
  server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
    asked.push(new URL(request.url))
    return HttpResponse.json(rows)
  }))
  return asked
}
/** My drills, as the database keeps them: reads, adds, changes and deletes, each kept for the test to read. */
function drillsTable(start: Record<string, unknown>[]) {
  let rows = [...start]
  const sent: { method: string; url: URL; body: Record<string, unknown> | null }[] = []
  const one = (row: Record<string, unknown>) => HttpResponse.json(row)
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_drills`, () => HttpResponse.json(rows)),
    http.post(`${SUPABASE_URL}/rest/v1/coach_drills`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sent.push({ method: 'POST', url: new URL(request.url), body })
      const row = drill(`new-${rows.length + 1}`, String(body.name), { ...body, updated_at: new Date().toISOString() })
      rows = [row, ...rows]
      return one({ id: row.id })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/coach_drills`, async ({ request }) => {
      const url = new URL(request.url)
      const body = await request.json() as Record<string, unknown>
      sent.push({ method: 'PATCH', url, body })
      const id = url.searchParams.get('id')!.slice(3)
      rows = rows.map(row => row.id === id ? { ...row, ...body } : row)
      return one({ id })
    }),
    http.delete(`${SUPABASE_URL}/rest/v1/coach_drills`, ({ request }) => {
      const url = new URL(request.url)
      sent.push({ method: 'DELETE', url, body: null })
      const id = url.searchParams.get('id')!.slice(3)
      rows = rows.filter(row => row.id !== id)
      return one({ id })
    }),
  )
  return sent
}

beforeEach(() => {
  COACH = { id: `coach-294-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Thierry Henry', age_group: 'U14', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Patrick Vieira', age_group: 'U16', status: 'active' },
    ]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_plans', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const comingUp = () => within(screen.getByRole('region', { name: 'Coming up' })).queryAllByRole('article')
  .map(card => card.getAttribute('aria-label'))
// TRAK-296: a card's other button, Add to <training>, isn't the drill.
const myDrills = () => within(screen.getByRole('region', { name: 'My drills' })).queryAllByRole('button')
  .map(button => button.getAttribute('aria-label')).filter(label => label?.endsWith('. Edit'))

describe('TRAK-294: Training home', { timeout: 20_000 }, () => {
  it('with the switch on, Training takes Library’s place in the nav, and the Library’s pages mark it', async () => {
    eventsRead([])
    drillsTable([])
    renderApp('/coach/training')
    expect(await screen.findByRole('heading', { level: 1, name: 'Training' })).toBeInTheDocument()
    const nav = screen.getByRole('tablist', { name: 'Coach' })
    await waitFor(() => expect(within(nav).getByRole('tab', { name: 'Training' })).toHaveAttribute('aria-selected', 'true'))
    expect(within(nav).queryByRole('tab', { name: 'Library' })).toBeNull()
  })

  it("lists the coach's trainings of the squad in view: Coming up soonest first, then last week's newest first", async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const asked = eventsRead([
      training('later', 'U14', onTheMinute(now + 5 * DAY)),
      training('last-tue', 'U16', onTheMinute(now - 5 * DAY)),
      training('soon', 'U16', onTheMinute(now + 2 * DAY), { title: 'Before AEK U16 on Saturday' }),
      training('last-thu', null, onTheMinute(now - 2 * DAY)),
    ])
    drillsTable([])
    renderApp('/coach/training')
    await screen.findByRole('region', { name: 'Coming up' })
    await waitFor(() => expect(comingUp()).toHaveLength(2))
    expect(comingUp()[0]).toMatch(/Before AEK U16 on Saturday$/)
    expect(comingUp()[1]).toMatch(/Training later$/)
    const first = within(screen.getByRole('region', { name: 'Coming up' })).getAllByRole('article')[0]
    expect(await within(first).findByRole('button', { name: 'Create plan' })).toBeInTheDocument()
    expect(within(first).getByText(/90 min · U16/)).toBeInTheDocument()
    // TRAK-310: the buttons say whether it's planned; Schedule is its own tab.
    expect(within(first).queryByText(/Planned|Not planned/)).toBeNull()
    expect(within(first).queryByRole('link', { name: 'Open in Schedule' })).toBeNull()
    const lastWeek = () => within(screen.getByRole('region', { name: 'Last week' })).getAllByRole('article').map(row => row.getAttribute('aria-label'))
    // Newest first. TRAK-298: its day and title open its own page. TRAK-311: and it has the plan buttons too.
    expect(lastWeek()).toEqual([expect.stringMatching(/Training last-thu$/), expect.stringMatching(/Training last-tue$/)])
    expect(within(screen.getByRole('region', { name: 'Last week' })).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['/coach/training/last-thu', '/coach/training/last-tue'])
    expect(within(screen.getByRole('region', { name: 'Last week' })).getAllByRole('button', { name: 'Create plan' })).toHaveLength(2)

    // Only the coach's own trainings, never a cancelled one, from about a week ago.
    const read = asked.find(url => url.searchParams.get('event_type') === 'eq.training')!
    expect(read.searchParams.get('coach_user_id')).toBe(`eq.${COACH.id}`)
    expect(read.searchParams.get('status')).toBe('neq.cancelled')
    expect(Date.parse(read.searchParams.get('starts_at')!.slice(4))).toBeLessThan(now - 7 * DAY)

    // U14: its own training and the whole roster's.
    await pickSquad('U14')
    await waitFor(() => expect(comingUp()).toHaveLength(1))
    expect(comingUp()[0]).toMatch(/Training later$/)
    expect(lastWeek()).toHaveLength(1)
  })

  it("with no training coming up, Add a training opens Schedule's New event", async () => {
    eventsRead([])
    drillsTable([])
    renderApp('/coach/training')
    await userEvent.click(await screen.findByRole('button', { name: 'Add a training' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/schedule'))
    expect(await screen.findByRole('dialog', { name: 'New event' }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('a failed read says so with Retry, never "No training coming up"', async () => {
    server.use(tableError('coach_calendar_events', 500, { message: 'unavailable' }))
    drillsTable([])
    renderApp('/coach/training')
    const failure = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(failure).getByRole('button', { name: /Retry/ })).toBeInTheDocument()
    expect(screen.queryByText('No training coming up')).toBeNull()
  })

  it('with the switch off, the nav keeps Library and Training is parked', async () => {
    server.use(rpc('feature_on', ({ p_feature }) => p_feature === 'events'))
    eventsRead([])
    drillsTable([])
    renderApp('/coach/training')
    expect(await screen.findByRole('note', { name: 'This screen is coming soon' })).toBeInTheDocument()
    const nav = screen.getByRole('tablist', { name: 'Coach' })
    expect(within(nav).getByRole('tab', { name: 'Library' })).toBeInTheDocument()
    expect(within(nav).queryByRole('tab', { name: 'Training' })).toBeNull()
  })
})

describe('TRAK-294: My drills', { timeout: 20_000 }, () => {
  it('New drill saves a drill with its details, trimmed, and it shows first in My drills', async () => {
    const user = userEvent.setup()
    eventsRead([])
    const sent = drillsTable([drill('d-1', 'Rondos 4v1', { how: 'Four round one' })])
    renderApp('/coach/training/drills')
    await waitFor(() => expect(myDrills()).toEqual(['Rondos 4v1, 15 min. Edit']))

    await user.click(screen.getByRole('button', { name: 'New drill' }))
    const sheet = await screen.findByRole('dialog', { name: 'New drill' })
    await user.type(within(sheet).getByLabelText('Name'), '  1v1 in channels ')
    await user.click(within(sheet).getByRole('button', { name: '20' }))
    await user.type(within(sheet).getByLabelText('How it works'), 'Four channels, 10 m wide.')
    await user.click(within(sheet).getByText('Add details'))
    await user.type(within(sheet).getByLabelText('Area'), '10 × 20 m')
    await user.click(within(sheet).getByRole('button', { name: 'Save drill' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New drill' })).toBeNull())
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({
      name: '1v1 in channels', minutes: 20, how: 'Four channels, 10 m wide.', tell: '',
      area: '10 × 20 m', numbers: '', direction: '', targets: '', conditions: '',
    })
    await waitFor(() => expect(myDrills()).toEqual(['1v1 in channels, 20 min. Edit', 'Rondos 4v1, 15 min. Edit']))
  })

  it('a drill needs a name; a failed save keeps everything typed and says so', async () => {
    const user = userEvent.setup()
    eventsRead([])
    drillsTable([])
    server.use(http.post(`${SUPABASE_URL}/rest/v1/coach_drills`, () => HttpResponse.json({ message: 'offline' }, { status: 503 })))
    renderApp('/coach/training/drills')
    expect(await screen.findByText(/No drills yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New drill' }))
    const sheet = await screen.findByRole('dialog', { name: 'New drill' })
    await user.click(within(sheet).getByRole('button', { name: 'Save drill' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Give the drill a name.')

    await user.type(within(sheet).getByLabelText('Name'), 'Finishing 3v2')
    await user.click(within(sheet).getByRole('button', { name: 'Save drill' }))
    await waitFor(() => expect(within(sheet).getByRole('alert')).toHaveTextContent(/Couldn't save the drill/))
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Finishing 3v2')
  })

  it("a drill opens to change it, and Delete asks first; each write names the coach's own drill", async () => {
    const user = userEvent.setup()
    eventsRead([])
    const sent = drillsTable([drill('d-1', 'Rondos 4v1', { area: '10 × 10 m' }), drill('d-2', 'Possession 6v6 + 2')])
    renderApp('/coach/training/drills')
    await user.click(await screen.findByRole('button', { name: 'Rondos 4v1, 15 min. Edit' }))
    let sheet = await screen.findByRole('dialog', { name: 'Edit drill' })
    // A drill with details opens with them showing.
    expect(within(sheet).getByLabelText('Area')).toHaveValue('10 × 10 m')
    await user.click(within(sheet).getByRole('button', { name: '25' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save drill' }))
    await waitFor(() => expect(sent.map(s => s.method)).toEqual(['PATCH']))
    expect(sent[0].url.searchParams.get('id')).toBe('eq.d-1')
    expect(sent[0].url.searchParams.get('coach_user_id')).toBe(`eq.${COACH.id}`)
    expect(sent[0].body).toMatchObject({ name: 'Rondos 4v1', minutes: 25 })
    await waitFor(() => expect(myDrills()).toContain('Rondos 4v1, 25 min. Edit'))

    await user.click(screen.getByRole('button', { name: 'Possession 6v6 + 2, 15 min. Edit' }))
    sheet = await screen.findByRole('dialog', { name: 'Edit drill' })
    await user.click(within(sheet).getByRole('button', { name: 'Delete drill' }))
    expect(sent).toHaveLength(1) // asked first, nothing sent
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(sent.map(s => s.method)).toEqual(['PATCH', 'DELETE']))
    expect(sent[1].url.searchParams.get('id')).toBe('eq.d-2')
    expect(sent[1].url.searchParams.get('coach_user_id')).toBe(`eq.${COACH.id}`)
    await waitFor(() => expect(myDrills()).toEqual(['Rondos 4v1, 25 min. Edit']))
  })

  it("search finds drills by any word typed; the Library's tiles open each library", async () => {
    const user = userEvent.setup()
    eventsRead([])
    drillsTable([drill('d-1', 'Rondos 4v1', { how: 'Keep the ball' }), drill('d-2', '1v1 in channels', { how: 'Attack the front foot' })])
    renderApp('/coach/training/drills')
    await waitFor(() => expect(myDrills()).toHaveLength(2))
    await user.type(screen.getByRole('searchbox', { name: 'Search my drills' }), 'front')
    await waitFor(() => expect(myDrills()).toEqual(['1v1 in channels, 15 min. Edit']))
    await user.type(screen.getByRole('searchbox', { name: 'Search my drills' }), ' nothing')
    expect(await screen.findByText(/No drill matches/)).toBeInTheDocument()

    const tiles = within(screen.getByRole('region', { name: 'From the Library' })).getAllByRole('link')
    expect(tiles).toHaveLength(7)
    await user.click(within(screen.getByRole('region', { name: 'From the Library' })).getByRole('link', { name: /Defending/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/trainings/defending'))
  })

  it('Sessions and Drills switch the view', async () => {
    const user = userEvent.setup()
    eventsRead([])
    drillsTable([])
    renderApp('/coach/training')
    await screen.findByRole('region', { name: 'Coming up' })
    await user.click(screen.getByRole('button', { name: 'Drills' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training/drills'))
    expect(await screen.findByRole('region', { name: 'My drills' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training'))
  })
})
