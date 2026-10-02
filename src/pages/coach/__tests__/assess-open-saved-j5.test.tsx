/**
 * TRAK-69 (J5, second use-case test 25 Sep): a saved assessment could only be
 * looked at. The coach wanted to open one to see which words were the private
 * note and which were the message, and to add to it later. Tapping it on coach
 * home, on the player's latest assessment or in the player's history now opens
 * that exact row in the form, and saving updates it instead of adding another.
 *
 * The real App, AuthProvider and SDK, with a small in-memory table behind MSW
 * that honours the filters the pages send, so "that exact row" is what the
 * database would have returned, not whatever a handler happened to hand back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

type Row = Record<string, unknown>
const COACH = { id: 'coach-1' }
const scores = (work_rate: number, tactical: number, attitude: number, technical: number, physical: number, coachability: number) =>
  ({ work_rate, tactical, attitude, technical, physical, coachability })

let db: Record<string, Row[]>
let writes: { table: string; method: string; id: string | null; body: Row }[]

function seed() {
  // Twenty recent sessions push the preseason friendly out of the picker's list.
  const filler = Array.from({ length: 20 }, (_, i) => ({ id: `filler-${i}`, coach_user_id: COACH.id,
    title: `Training ${i}`, session_type: 'training', session_date: `2026-09-${String(i + 1).padStart(2, '0')}` }))
  db = {
    profiles: [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Synthetic', invite_code: 'ABCD' }],
    coach_details: [],
    squad_players: [
      { id: 'player-a', coach_user_id: COACH.id, player_name: 'Manos Synthetic', position: 'Midfielder' },
      { id: 'player-b', coach_user_id: COACH.id, player_name: 'Bella Synthetic', position: 'Defender' },
    ],
    coach_sessions: [
      ...filler,
      { id: 'session-a', coach_user_id: COACH.id, title: 'vs Olympiacos Academy', session_type: 'match', session_date: '2026-09-20' },
      { id: 'session-b', coach_user_id: COACH.id, title: 'vs Olympiacos Youth', session_type: 'match', session_date: '2026-09-21' },
      { id: 'session-old', coach_user_id: COACH.id, title: 'Preseason friendly', session_type: 'match', session_date: '2026-08-01' },
    ],
    coach_assessments: [
      { id: 'assess-old', coach_user_id: COACH.id, squad_player_id: 'player-a', session_id: 'session-a',
        created_at: '2026-09-20T18:00:00Z', appearance: 'started', coach_rating: 4.5, ...scores(3, 4, 5, 6, 7, 2) },
      { id: 'assess-new', coach_user_id: COACH.id, squad_player_id: 'player-a', session_id: 'session-b',
        created_at: '2026-09-21T18:00:00Z', appearance: 'started', coach_rating: 8, ...scores(8, 8, 8, 8, 8, 8) },
      { id: 'assess-legacy', coach_user_id: COACH.id, squad_player_id: 'player-b', session_id: null,
        created_at: '2026-09-10T18:00:00Z', appearance: 'training', coach_rating: 6, ...scores(6, 6, 6, 6, 6, 6) },
      { id: 'assess-preseason', coach_user_id: COACH.id, squad_player_id: 'player-b', session_id: 'session-old',
        created_at: '2026-08-01T18:00:00Z', appearance: 'started', coach_rating: 5, ...scores(5, 5, 5, 5, 5, 5) },
      { id: 'assess-foreign', coach_user_id: 'coach-2', squad_player_id: 'player-x', session_id: null,
        created_at: '2026-09-22T18:00:00Z', appearance: 'started', coach_rating: 9, ...scores(9, 9, 9, 9, 9, 9) },
    ],
    coach_assessment_notes: [
      { assessment_id: 'assess-old', coach_user_id: COACH.id, note: 'Talk to his dad about boots' },
      { assessment_id: 'assess-new', coach_user_id: COACH.id, note: 'Assistant: strong first touch' },
    ],
    coach_shared_feedback: [
      { assessment_id: 'assess-old', coach_user_id: COACH.id, body: 'Great pressing, keep it up.', published_at: '2026-09-20T19:00:00Z' },
    ],
  }
  writes = []
}

// PostgREST's filter grammar, as far as these pages use it.
function matches(value: unknown, cond: string): boolean {
  if (cond.startsWith('eq.')) return value != null && String(value) === cond.slice(3)
  if (cond.startsWith('in.(')) return cond.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(value))
  if (cond === 'is.null') return value == null
  if (cond === 'not.is.null') return value != null
  if (cond.startsWith('lte.')) return value != null && String(value) <= cond.slice(4)
  if (cond.startsWith('gte.')) return value != null && String(value) >= cond.slice(4)
  throw new Error(`fake PostgREST: unsupported filter ${cond}`)
}
function read(table: string, url: URL): Row[] {
  const p = url.searchParams
  let rows = db[table].filter(row => [...p.entries()].every(([key, cond]) =>
    ['select', 'order', 'limit', 'offset'].includes(key) || matches(row[key], cond)))
  const order = p.get('order')
  if (order) {
    const [col, dir] = order.split('.')
    rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1))
  }
  if (p.get('limit')) rows = rows.slice(0, Number(p.get('limit')))
  const select = p.get('select') ?? ''
  return rows.map(row => ({
    ...row,
    ...(select.includes('squad_players(') && { squad_players: db.squad_players.find(s => s.id === row.squad_player_id) ?? null }),
    ...(select.includes('coach_sessions(') && { coach_sessions: db.coach_sessions.find(s => s.id === row.session_id) ?? null }),
  }))
}

beforeEach(() => {
  seed()
  signInAs(COACH)
  server.use(
    ...Object.keys({ profiles: 1, coach_details: 1, squad_players: 1, coach_sessions: 1, coach_assessments: 1,
      coach_assessment_notes: 1, coach_shared_feedback: 1 }).map(table =>
      http.get(`${SUPABASE_URL}/rest/v1/${table}`, ({ request }) => HttpResponse.json(read(table, new URL(request.url))))),
    http.patch(`${SUPABASE_URL}/rest/v1/coach_assessments`, async ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.replace(/^eq\./, '') ?? null
      const body = await request.json() as Row
      writes.push({ table: 'coach_assessments', method: 'patch', id, body })
      return HttpResponse.json([{ id }])
    }),
    http.post(`${SUPABASE_URL}/rest/v1/coach_assessments`, async ({ request }) => {
      writes.push({ table: 'coach_assessments', method: 'post', id: null, body: await request.json() as Row })
      return HttpResponse.json([{ id: 'assess-created' }])
    }),
    ...['coach_assessment_notes', 'coach_shared_feedback'].map(table =>
      http.post(`${SUPABASE_URL}/rest/v1/${table}`, async ({ request }) => {
        writes.push({ table, method: 'post', id: null, body: await request.json() as Row })
        return HttpResponse.json([])
      })),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
  )
})
afterEach(() => cleanup())

const sliderValues = () => screen.getAllByRole('slider').map(s => Number((s as HTMLInputElement).value))
const messageBox = () => screen.getByLabelText(/^Message to/i) as HTMLTextAreaElement
const noteBox = () => screen.getByLabelText(/^Private note/i) as HTMLTextAreaElement
const saveButton = () => screen.getByRole('button', { name: /Save Assessment/ })
const assessmentWrites = () => writes.filter(w => w.table === 'coach_assessments').map(w => [w.method, w.id])

describe('TRAK-69: a coach opens a saved assessment and edits that row', () => {
  it("opens an older assessment from the player's history, with its scores, note and message", async () => {
    const user = userEvent.setup()
    renderApp('/coach/player/player-a')
    await user.click(await screen.findByRole('button', { name: /Open assessment .*vs Olympiacos Academy/ }))
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Academy/)).toBeInTheDocument()
    await waitFor(() => expect(sliderValues()).toEqual([3, 4, 5, 6, 7, 2]))
    expect(messageBox().value).toBe('Great pressing, keep it up.')
    expect(noteBox().value).toBe('Talk to his dad about boots')
  })

  it('saving the opened assessment updates that row and adds none', async () => {
    const user = userEvent.setup()
    renderApp('/coach/player/player-a')
    await user.click(await screen.findByRole('button', { name: /Open assessment .*vs Olympiacos Academy/ }))
    await waitFor(() => expect(sliderValues()).toEqual([3, 4, 5, 6, 7, 2]))
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '9' } })
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(assessmentWrites()).toEqual([['patch', 'assess-old']]))
    expect(writes.find(w => w.table === 'coach_assessments')!.body).toMatchObject({ work_rate: 9, session_id: 'session-a' })
  })

  it("opens the player's latest assessment from its card", async () => {
    const user = userEvent.setup()
    renderApp('/coach/player/player-a')
    await user.click(await screen.findByRole('button', { name: /Open latest assessment/ }))
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Youth/)).toBeInTheDocument()
    await waitFor(() => expect(noteBox().value).toBe('Assistant: strong first touch'))
  })

  it('opens a recent assessment from coach home', async () => {
    const user = userEvent.setup()
    renderApp('/coach/home')
    // Manos has two recent assessments; the 21 Sep one belongs to the Youth match.
    await user.click(await screen.findByRole('button', { name: /Open assessment .*Manos Synthetic, 21 Sep/ }))
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Youth/)).toBeInTheDocument()
  })

  it('opens and saves in place an assessment made before sessions were required', async () => {
    const user = userEvent.setup()
    renderApp('/coach/assess?assessment=assess-legacy')
    expect(await screen.findByText(/Editing your assessment from 10 Sep/)).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(assessmentWrites()).toEqual([['patch', 'assess-legacy']]))
    expect(writes.find(w => w.table === 'coach_assessments')!.body.session_id).toBeNull()
  })

  it("opens an assessment whose session is older than the picker's list", async () => {
    renderApp('/coach/assess?assessment=assess-preseason')
    expect(await screen.findByText(/Editing your assessment for Preseason friendly/)).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it("does not open another coach's assessment", async () => {
    renderApp('/coach/assess?assessment=assess-foreign')
    expect(await screen.findByText(/couldn't open that assessment/i)).toBeInTheDocument()
    expect(screen.queryByText(/Editing your assessment/)).toBeNull()
    expect(sliderValues().every(v => v === 5)).toBe(true)
  })

  it('history shows session, band and whether a message was sent; the note is labelled private', async () => {
    renderApp('/coach/player/player-a')
    const row = await screen.findByRole('button', { name: /Open assessment .*vs Olympiacos Academy/ })
    expect(within(row).getByText('vs Olympiacos Academy')).toBeInTheDocument()
    expect(within(row).getByText('Message sent')).toBeInTheDocument()
    const latest = screen.getByRole('button', { name: /Open latest assessment/ })
    expect(within(latest).getByText(/No message/)).toBeInTheDocument()
    expect(within(latest).getByText(/Private note/i)).toBeInTheDocument()
    expect(within(latest).getByText(/Assistant: strong first touch/)).toBeInTheDocument()
  })
})
