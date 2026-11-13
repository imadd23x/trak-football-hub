import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { toInstant } from '@/lib/event-time'

// TRAK-162: the import is parked for coaches (schedule-import-parked-j86).
// These tests switch it on, so the flow stays proven for when it comes back.
vi.mock('@/lib/fixture-import', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/fixture-import')>()),
  FIXTURE_IMPORT_ENABLED: true,
}))

/**
 * TRAK-129 (J8.6). League fixtures from a CSV on the coach's schedule: the
 * coach drops the file, checks every row, confirms. The fixtures land as
 * drafts (Imad's publish step, 9 Oct) in ONE insert, so an import saves whole
 * or not at all, and fixtures already on the schedule are skipped, so the
 * same file twice adds nothing. Driven through the rendered app and the SDK.
 */

const COACH = { id: 'coach-1' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const HEADER = 'Date,Kickoff,Meet time,Opponent,Home or away,Venue,Kit'
const csv = (...lines: string[]) => new File([[HEADER, ...lines].join('\n')], 'fixtures.csv', { type: 'text/csv' })

const EXISTING = {
  id: 'ev-existing', coach_user_id: COACH.id, title: 'vs Rivals FC', event_type: 'match',
  starts_at: toInstant('2099-11-14', '10:00'), ends_at: null, event_date: '2099-11-14', start_time: '10:00:00',
  venue: 'Rivals Park', opponent: 'Rivals FC', notes: null, published: true, source: 'manual',
  meet_time: null, kit: null, home_away: 'away', status: 'scheduled', cancel_reason: null,
}

let inserts: Record<string, unknown>[][]
let insertFails: boolean
let parkedEvents: boolean

function fixtures(rows: Record<string, unknown>[] = []) {
  inserts = []
  insertFails = false
  parkedEvents = false
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json(rows)),
    table('coach_sessions', []),
    // The schedule also reads the squad label for Share to WhatsApp (TRAK-139).
    table('squad_players', []),
    rpc('feature_on', () => !parkedEvents),
    http.post(EVENTS, async ({ request }) => {
      const body = await request.json()
      const batch = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
      inserts.push(batch)
      if (insertFails) return HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })
      return HttpResponse.json(batch.map((_, i) => ({ id: `new-${i}` })), { status: 201 })
    }),
  )
}

async function openImport() {
  const user = userEvent.setup({ applyAccept: false })
  renderApp('/coach/schedule')
  await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
  await user.click(await screen.findByRole('button', { name: 'Import fixtures' }))
  const dialog = await screen.findByRole('dialog', { name: 'Import fixtures' })
  return { user, dialog }
}

describe('J8.6: league fixtures from a CSV on the schedule', () => {
  beforeEach(() => signInAs(COACH))

  it('imports every fixture as a draft, in one insert, exactly as in the file', async () => {
    fixtures()
    const { user, dialog } = await openImport()
    await user.upload(within(dialog).getByLabelText(/choose a csv file/i),
      csv('2099-11-21,10:00,09:15,Al Wasl FC,Home,Main pitch,Green', '2099-11-24,17:30,,,,Main pitch,'))
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 fixtures' }))

    await waitFor(() => expect(inserts).toHaveLength(1))
    const [match, training] = inserts[0]
    expect(match).toMatchObject({
      coach_user_id: COACH.id, published: false, source: 'csv', event_type: 'match',
      // 10:00 in Dubai whatever the device's zone (#263's pin, through formToRow).
      starts_at: '2099-11-21T06:00:00.000Z',
      event_date: '2099-11-21', start_time: '10:00:00', meet_time: '09:15:00',
      opponent: 'Al Wasl FC', home_away: 'home', venue: 'Main pitch', kit: 'Green', title: 'vs Al Wasl FC',
    })
    expect(training).toMatchObject({
      coach_user_id: COACH.id, published: false, source: 'csv', event_type: 'training',
      event_date: '2099-11-24', start_time: '17:30:00', opponent: null, home_away: null, kit: null, title: 'Training',
    })
    expect(match).not.toHaveProperty('notes')
    expect(match).not.toHaveProperty('sequence')
    expect(await screen.findByText(/added 2 fixtures as drafts/i)).toBeInTheDocument()
  })

  it('skips a fixture already on the schedule, so importing the same file twice adds nothing new', async () => {
    fixtures([EXISTING])
    const { user, dialog } = await openImport()
    await user.upload(within(dialog).getByLabelText(/choose a csv file/i),
      csv('2099-11-14,10:00,,Rivals FC,Away,,', '2099-11-21,10:00,,Al Wasl FC,Home,,'))
    const known = await within(dialog).findByRole('listitem', { name: 'Line 2' })
    expect(within(known).getByText(/already in your events/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 fixture' }))
    await waitFor(() => expect(inserts).toHaveLength(1))
    expect(inserts[0].map(r => r.opponent)).toEqual(['Al Wasl FC'])
  })

  it('a failed save adds nothing, says so, and keeps every row', async () => {
    fixtures()
    const { user, dialog } = await openImport()
    insertFails = true
    await user.upload(within(dialog).getByLabelText(/choose a csv file/i), csv('2099-11-21,10:00,,Al Wasl FC,Home,,'))
    await user.click(await within(dialog).findByRole('button', { name: 'Add 1 fixture' }))
    expect(await within(dialog).findByText(/couldn't save the fixtures/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('listitem', { name: 'Line 2' })).toBeInTheDocument()
    expect(screen.queryByText(/added 1 fixture as drafts/i)).not.toBeInTheDocument()
  })

  it('says "Couldn\'t save" when the database confirms fewer fixtures than were sent, never "Added"', async () => {
    // J4's no-silent-loss rule: an answer short of the rows sent (RLS hiding a
    // row from the returned list) must not read as a whole import. Kostas's
    // #265 review: the guard survived every test before this one.
    fixtures()
    server.use(http.post(EVENTS, () => HttpResponse.json([{ id: 'new-0' }], { status: 201 })))
    const { user, dialog } = await openImport()
    await user.upload(within(dialog).getByLabelText(/choose a csv file/i),
      csv('2099-11-21,10:00,,Al Wasl FC,Home,,', '2099-11-24,17:30,,,,Main pitch,'))
    await user.click(await within(dialog).findByRole('button', { name: 'Add 2 fixtures' }))
    expect(await within(dialog).findByText(/couldn't save the fixtures/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('listitem', { name: 'Line 2' })).toBeInTheDocument()
    expect(screen.queryByText(/added 2 fixtures as drafts/i)).not.toBeInTheDocument()
  })

  it('offers no AI or PDF reading: the import takes a CSV only', async () => {
    fixtures()
    const { user, dialog } = await openImport()
    await user.upload(within(dialog).getByLabelText(/choose a csv file/i), new File(['%PDF'], 'league.pdf', { type: 'application/pdf' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/not a csv file/i)
    expect(inserts).toHaveLength(0)
  })

  it('says "Coming soon" and opens nothing while events are off for the academy', async () => {
    // Its own coach: the app's query cache is shared across a file's tests, and
    // the tests above already cached "events on" for coach-1.
    const OFF = { id: 'coach-off' }
    signInAs(OFF)
    fixtures()
    parkedEvents = true
    server.use(table('profiles', [{ id: 'p-off', user_id: OFF.id, role: 'coach', full_name: 'Coach Off', invite_code: 'EFGH' }]))
    const user = userEvent.setup()
    renderApp('/coach/schedule')
    expect(await screen.findByRole('note', { name: 'This screen is coming soon' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Import fixtures' }))
    expect(screen.queryByRole('dialog', { name: 'Import fixtures' })).toBeNull()
    expect(inserts).toHaveLength(0)
  })
})
