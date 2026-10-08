import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { parseTrainingNotes, parseTrainingTitle, trainingNotes, trainingTitle } from '@/lib/session-form'

/**
 * TRAK-102 (J4). coach.u15 saved a training without its note and had no way to
 * add it afterwards; tapping a history row did nothing. Now a row opens the
 * session, and a training's date, focus, notes and attendance can be corrected.
 * Attendance adds go through the same consent gate as creating the session; a
 * player assessed on the session stays present (TRAK-100); a failed save keeps
 * what was typed. Driven through the rendered app and the real SDK.
 */

const COACH = { id: 'coach-1' }
const TRAINING = {
  id: 'session-1', coach_user_id: COACH.id, session_type: 'training',
  title: 'Finishing Training', training_type: 'Finishing', session_date: '2026-10-01',
  notes: '60 min', competition: null, venue: null, created_at: '2026-10-01T13:04:00Z',
}
const MATCH = {
  id: 'match-1', coach_user_id: COACH.id, session_type: 'match',
  title: 'vs Live Check United', training_type: null, session_date: '2026-09-30',
  notes: '2-1', competition: 'League', venue: 'Home', created_at: '2026-09-30T01:00:00Z',
}
const player = (id: string, player_name: string) => ({ id, coach_user_id: COACH.id, player_name })
const ANNA = player('anna', 'Anna Added')        // ready, not at the session
const REMI = player('remi', 'Remi Removed')      // ready, present
const ASA = player('asa', 'Asa Assessed')        // ready, present, assessed on it
const ABE = player('abe', 'Abe Absent')          // ready, an old 'absent' row
const WES = player('wes', 'Wes Waiting')         // no consent, not at the session

type Write = { table: string; method: string; query: string; body: unknown }
let writes: Write[]
let sessionPatch: () => Response

function fixtures(over: { attendanceInsert?: (body: { squad_player_id: string }) => Response } = {}) {
  writes = []
  sessionPatch = () => HttpResponse.json([{ id: TRAINING.id }])
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.replace(/^eq\./, '')
      const rows = [TRAINING, MATCH].filter(s => !id || s.id === id)
      return HttpResponse.json(rows)
    }),
    table('squad_players', [ANNA, ABE, ASA, REMI, WES]),
    http.get(`${SUPABASE_URL}/rest/v1/session_attendance`, ({ request }) => {
      const sid = new URL(request.url).searchParams.get('session_id')?.replace(/^eq\./, '')
      return HttpResponse.json(sid === MATCH.id
        ? [{ squad_player_id: 'remi', status: 'present' }]
        : [
            { squad_player_id: 'remi', status: 'present' },
            { squad_player_id: 'asa', status: 'present' },
            { squad_player_id: 'abe', status: 'absent' },
          ])
    }),
    table('coach_assessments', [{ squad_player_id: 'asa' }]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'wes'),
    http.patch(`${SUPABASE_URL}/rest/v1/coach_sessions`, async ({ request }) => {
      writes.push({ table: 'coach_sessions', method: 'patch', query: new URL(request.url).search, body: await request.json() })
      return sessionPatch()
    }),
    http.post(`${SUPABASE_URL}/rest/v1/session_attendance`, async ({ request }) => {
      const body = await request.json() as { squad_player_id: string }
      writes.push({ table: 'session_attendance', method: 'post', query: '', body })
      return over.attendanceInsert?.(body) ?? HttpResponse.json([{ id: `att-${body.squad_player_id}` }], { status: 201 })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/session_attendance`, async ({ request }) => {
      writes.push({ table: 'session_attendance', method: 'patch', query: new URL(request.url).search, body: await request.json() })
      return HttpResponse.json([{ id: 'att-abe' }])
    }),
    http.delete(`${SUPABASE_URL}/rest/v1/session_attendance`, ({ request }) => {
      writes.push({ table: 'session_attendance', method: 'delete', query: new URL(request.url).search, body: null })
      return HttpResponse.json([{ id: 'att-x' }])
    }),
  )
}

const tile = (name: RegExp) => screen.getByRole('button', { name })
const attendanceWrites = () => writes.filter(w => w.table === 'session_attendance')
// TRAK-119: "Edit session" shows while the saved session is still loading, so
// wait until the form holds it (the saved focus is pressed), not for the heading.
async function openSaved() {
  renderApp('/coach/sessions/session-1')
  await screen.findByRole('button', { name: /^Finishing/, pressed: true }, { timeout: 5000 })
}

describe('TRAK-102: a coach opens and corrects a saved training session', () => {
  beforeEach(() => { signInAs(COACH); fixtures() })

  it('a history row opens its session, filled in as saved', async () => {
    const user = userEvent.setup()
    renderApp('/coach/sessions/list')
    await user.click(await screen.findByRole('button', { name: /Finishing Training/ }, { timeout: 5000 }))

    expect(await screen.findByText('Edit session')).toBeInTheDocument()
    // TRAK-119: the heading shows while the saved session still loads; wait for the form.
    expect(await screen.findByRole('button', { name: /^Finishing/, pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '60 min', pressed: true })).toBeInTheDocument()
    expect(screen.getByLabelText('Session date')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Notes')).toHaveValue('')
    expect(tile(/Remi Removed/)).toHaveAttribute('aria-pressed', 'true')
    expect(tile(/Anna Added/)).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves the missed note, a new date and focus, without touching attendance', async () => {
    const user = userEvent.setup()
    await openSaved()

    await user.type(screen.getByLabelText('Notes'), 'Good first touch')
    await user.click(screen.getByRole('button', { name: /^Set Pieces/ }))
    await user.clear(screen.getByLabelText('Session date'))
    await user.type(screen.getByLabelText('Session date'), '2026-09-30')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Session updated')).toBeInTheDocument()
    const patch = writes.find(w => w.table === 'coach_sessions')!
    expect(patch.query).toContain('id=eq.session-1')
    expect(patch.query).toContain('coach_user_id=eq.coach-1')
    expect(patch.body).toEqual({
      session_date: '2026-09-30',
      title: 'Finishing / Set Pieces Training',
      training_type: 'Finishing,Set Pieces',
      notes: '60 min\nGood first touch',
    })
    expect(attendanceWrites()).toEqual([])
  })

  it('adds and removes attendance one player at a time; assessed and unconsented players are not offered', async () => {
    const user = userEvent.setup()
    await openSaved()

    // TRAK-100: assessed on this session, so it stays present.
    expect(tile(/Asa Assessed/)).toBeDisabled()
    expect(screen.getByText('Assessed on this session')).toBeInTheDocument()
    // The consent gate, as when creating: named, not offered.
    expect(screen.queryByRole('button', { name: /Wes Waiting/ })).toBeNull()
    expect(screen.getByText(/Not recorded until a parent approves: Wes Waiting \(waiting for a parent\)/)).toBeInTheDocument()

    await user.click(tile(/Anna Added/))
    await user.click(tile(/Remi Removed/))
    await user.click(tile(/Abe Absent/))
    await user.click(tile(/Asa Assessed/)) // disabled: nothing happens
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Session updated')).toBeInTheDocument()
    const att = attendanceWrites()
    expect(att).toHaveLength(3)
    expect(att).toContainEqual(expect.objectContaining({ method: 'post', body: { session_id: 'session-1', squad_player_id: 'anna', status: 'present' } }))
    // The old 'absent' row becomes present rather than gaining a twin.
    expect(att).toContainEqual(expect.objectContaining({ method: 'patch', body: { status: 'present' } }))
    expect(att.find(w => w.method === 'patch')!.query).toContain('squad_player_id=eq.abe')
    expect(att.find(w => w.method === 'delete')!.query).toContain('squad_player_id=eq.remi')
    expect(att.some(w => w.query.includes('asa') || JSON.stringify(w.body).includes('asa'))).toBe(false)
  })

  it('a failed save keeps what was typed and stays on the screen', async () => {
    sessionPatch = () => HttpResponse.json({ message: 'network down', code: 'XX000' }, { status: 500 })
    const user = userEvent.setup()
    await openSaved()

    await user.type(screen.getByLabelText('Notes'), 'Do not lose me')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/Could not save/)).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toHaveValue('Do not lose me')
    expect(screen.getByText('Edit session')).toBeInTheDocument()
  })

  it('an update that changes no row is a failure, not a save', async () => {
    sessionPatch = () => HttpResponse.json([])
    const user = userEvent.setup()
    await openSaved()

    await user.type(screen.getByLabelText('Notes'), 'Still here')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/Could not save this session/)).toBeInTheDocument()
    expect(screen.queryByText('Session updated')).toBeNull()
    expect(screen.getByLabelText('Notes')).toHaveValue('Still here')
  })

  it('a refused attendance add is named, and pressing save again retries only that one', async () => {
    let refuse = true
    fixtures({
      attendanceInsert: () => refuse
        ? HttpResponse.json({ code: '42501', message: 'new row violates row-level security policy' }, { status: 403 })
        : HttpResponse.json([{ id: 'att-anna' }], { status: 201 }),
    })
    const user = userEvent.setup()
    await openSaved()

    await user.click(tile(/Anna Added/))
    await user.click(tile(/Remi Removed/))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/attendance didn't change for: Anna Added/)).toBeInTheDocument()
    expect(screen.getByText('Edit session')).toBeInTheDocument()
    expect(attendanceWrites().filter(w => w.method === 'delete')).toHaveLength(1)

    refuse = false
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Session updated')).toBeInTheDocument()
    // Remi's removal already landed; only Anna was sent again.
    expect(attendanceWrites().filter(w => w.method === 'delete')).toHaveLength(1)
    expect(attendanceWrites().filter(w => w.method === 'post')).toHaveLength(2)
  })

  it('a future date blocks the save', async () => {
    const user = userEvent.setup()
    await openSaved()

    await user.clear(screen.getByLabelText('Session date'))
    await user.type(screen.getByLabelText('Session date'), '2099-01-01')
    expect(screen.getByText(/can't be dated in the future/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('a logged match opens read-only', async () => {
    renderApp('/coach/sessions/match-1')
    expect(await screen.findByText(/A logged match can't be edited yet/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('vs Live Check United')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('a failed load says so and offers a retry; it is never "isn\'t available"', async () => {
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () =>
      HttpResponse.json({ message: 'unavailable', code: 'XX000' }, { status: 500 })))
    renderApp('/coach/sessions/session-1')
    expect(await screen.findByRole('button', { name: /retry|try again/i }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText(/isn't available/)).toBeNull()
  })

  it('a session that is not the coach\'s reads as not available', async () => {
    renderApp('/coach/sessions/someone-elses')
    expect(await screen.findByText(/This session isn't available/, undefined, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull())
  })
})

describe('session-form: what the add screen stores reads back for editing', () => {
  it('round-trips the training notes, with or without the meta line', () => {
    expect(parseTrainingNotes(trainingNotes(60, 'High', 'Line one\nLine two')))
      .toEqual({ duration: 60, intensity: 'High', notes: 'Line one\nLine two' })
    expect(parseTrainingNotes(trainingNotes(45, '', ''))).toEqual({ duration: 45, intensity: '', notes: '' })
    expect(parseTrainingNotes(trainingNotes(null, 'Light', 'x'))).toEqual({ duration: null, intensity: 'Light', notes: 'x' })
    expect(trainingNotes(null, '', '')).toBeNull()
    // Notes that never had the meta line stay notes.
    expect(parseTrainingNotes('Worked on crossing')).toEqual({ duration: null, intensity: '', notes: 'Worked on crossing' })
    expect(parseTrainingNotes(null)).toEqual({ duration: null, intensity: '', notes: '' })
  })

  it('reads focus and theme back from the title the add screen writes', () => {
    expect(parseTrainingTitle(trainingTitle(['Technical', 'Set Pieces'], 'Coach theme'), 'Technical,Set Pieces'))
      .toEqual({ focus: ['Technical', 'Set Pieces'], theme: 'Coach theme' })
    expect(parseTrainingTitle('Finishing Training', 'Finishing')).toEqual({ focus: ['Finishing'], theme: '' })
    // Saved before TRAK-75: no training_type, so the focus comes from the title.
    expect(parseTrainingTitle('Tactical / Possession Training', null)).toEqual({ focus: ['Tactical', 'Possession'], theme: '' })
    // Not our shape at all: the words are kept as the theme.
    expect(parseTrainingTitle('Gym session', null)).toEqual({ focus: [], theme: 'Gym session' })
  })
})
