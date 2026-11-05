/**
 * TRAK-69 (J5, second use-case test 25 Sep): a saved assessment could only be
 * looked at. The coach wanted to open one to see which words were the private
 * note and which were the message, and to add to it later. Tapping it on coach
 * home, on the player's latest assessment or in the player's history now opens
 * that exact row in the form, and saving updates it instead of adding another.
 * TRAK-368: the history is on the player's own page in Squad, every assessment a
 * card with Edit; the older /coach/player/:id page is gone.
 *
 * The real App, AuthProvider and SDK, with a small in-memory table behind MSW
 * that honours the filters the pages send, so "that exact row" is what the
 * database would have returned, not whatever a handler happened to hand back.
 */
import { setSlider, sliderValue, sliderDisabled } from '../../../../tests/support/slider'
import { assessStep, nextButton, saveAssessment } from '../../../../tests/support/assess-steps'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'

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
    squad_player_profiles: [],
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
      coach_assessment_notes: 1, coach_shared_feedback: 1, squad_player_profiles: 1 }).map(table =>
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
    // The player's own page in Squad (TRAK-368) also asks for the switches, the squad's season and birth dates.
    http.post(`${SUPABASE_URL}/rest/v1/rpc/feature_on`, () => HttpResponse.json(false)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_season`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_player_birth_dates`, () => HttpResponse.json([])),
    // The Feedback and assessment overview reads registers and "Can't make it" (TRAK-197); none here.
    ...['session_attendance', 'event_absences'].map(table => http.get(`${SUPABASE_URL}/rest/v1/${table}`, () => HttpResponse.json([]))),
  )
})
afterEach(() => cleanup())

// TRAK-182: one step per screen.
const toStep = assessStep
const sliderValues = () => screen.getAllByRole('slider').map(sliderValue)
const messageBox = () => screen.getByLabelText(/^Message to/i) as HTMLTextAreaElement
const noteBox = () => screen.getByLabelText(/^Private note/i) as HTMLTextAreaElement
const assessmentWrites = () => writes.filter(w => w.table === 'coach_assessments').map(w => [w.method, w.id])

// TRAK-182: walking the steps adds real interaction; CI under load needs more than 5 s.
// TRAK-200: the latest assessment is Arc's card; Edit sits behind its split button's chevron.
async function openLatest(user: ReturnType<typeof userEvent.setup>) {
  // The latest card comes first: on the player's own page (TRAK-351) every assessment is a card, newest first.
  const [card] = await screen.findAllByRole('article', { name: /assessment, / })
  await user.click(within(card).getByRole('button', { name: /more actions$/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
}
// TRAK-368: an older assessment is a card in the player's history too; the 20 Sep one is vs Olympiacos Academy.
// The date reads "20 Sep" or "20 Sept" depending on the runtime's English data.
const olderCard = () => screen.findByRole('article', { name: /assessment, .*20 Sept?$/ })
async function openOlder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await olderCard()).getByRole('button', { name: /more actions$/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
}

describe('TRAK-69: a coach opens a saved assessment and edits that row', { timeout: 20_000 }, () => {
  it("opens an older assessment from the player's history, with its scores, note and message", async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad/player/player-a')
    await openOlder(user)
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Academy/)).toBeInTheDocument()
    await toStep('Ratings')
    expect(sliderValues()).toEqual([3, 4, 5, 6, 7, 2])
    await toStep('Message')
    expect(messageBox().value).toBe('Great pressing, keep it up.')
    await toStep('Note')
    expect(noteBox().value).toBe('Talk to his dad about boots')
  })

  it('saving the opened assessment updates that row and adds none', async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad/player/player-a')
    await openOlder(user)
    await toStep('Ratings')
    expect(sliderValues()).toEqual([3, 4, 5, 6, 7, 2])
    setSlider(screen.getAllByRole('slider')[0], 9)
    await saveAssessment()
    await waitFor(() => expect(assessmentWrites()).toEqual([['patch', 'assess-old']]))
    expect(writes.find(w => w.table === 'coach_assessments')!.body).toMatchObject({ work_rate: 9, session_id: 'session-a' })
  })

  it("opens the player's latest assessment from its card", async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad/player/player-a')
    await openLatest(user)
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Youth/)).toBeInTheDocument()
    await toStep('Note')
    expect(noteBox().value).toBe('Assistant: strong first touch')
  })

  // TRAK-179 (live run 3, 16 Oct): a player on coach Home opens the player, not the editor.
  // TRAK-197: Recent assessments went; the overview row opens the profile (TRAK-211: on the Feedback tab).
  it("a player in the overview opens that player's profile, where the assessment opens", async () => {
    const user = userEvent.setup()
    renderApp('/coach/feedback')
    await user.click(await screen.findByRole('button', { name: /^Open Manos Synthetic's profile/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/player-a'))
    await openLatest(user)
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Youth/)).toBeInTheDocument()
  })

  // TRAK-179 (Kostas, 15 Oct): the way back is the screen the coach came from. TRAK-334: the trail, in place of Back.
  // TRAK-368: from the whole history, the way back keeps the whole history open.
  it("the trail from an assessment opened in the player's history goes back to that player", async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad/player/player-a?history=all')
    await openOlder(user)
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Academy/)).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Squad', 'Manos Synthetic', 'Assessment'])
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Manos Synthetic' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/player-a'))
    expect(window.location.search).toBe('?history=all')
    expect(await olderCard()).toBeInTheDocument()
  })

  it('the trail from an assessment reached from the overview goes back to that player', async () => {
    const user = userEvent.setup()
    renderApp('/coach/feedback')
    await user.click(await screen.findByRole('button', { name: /^Open Manos Synthetic's profile/ }))
    await openLatest(user)
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Youth/)).toBeInTheDocument()
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Manos Synthetic' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/player-a'))
  })

  it('the trail from an assessment opened directly, with nothing before it in Trak, starts at Home', async () => {
    const user = userEvent.setup()
    renderApp('/coach/assess?assessment=assess-new')
    expect(await screen.findByText(/Editing your assessment for vs Olympiacos Youth/)).toBeInTheDocument()
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/home'))
  })

  it('opens and saves in place an assessment made before sessions were required', async () => {
    const user = userEvent.setup()
    renderApp('/coach/assess?assessment=assess-legacy')
    expect(await screen.findByText(/Editing your assessment from 10 Sep/)).toBeInTheDocument()
    await saveAssessment()
    await waitFor(() => expect(assessmentWrites()).toEqual([['patch', 'assess-legacy']]))
    expect(writes.find(w => w.table === 'coach_assessments')!.body.session_id).toBeNull()
  })

  it("opens an assessment whose session is older than the picker's list", async () => {
    renderApp('/coach/assess?assessment=assess-preseason')
    expect(await screen.findByText(/Editing your assessment for Preseason friendly/)).toBeInTheDocument()
    await waitFor(() => expect(nextButton()).toBeEnabled())
  })

  it("does not open another coach's assessment", async () => {
    renderApp('/coach/assess?assessment=assess-foreign')
    expect(await screen.findByText(/couldn't open that assessment/i)).toBeInTheDocument()
    expect(screen.queryByText(/Editing your assessment/)).toBeNull()
    // Nothing opened: the steps past the player stay shut.
    expect(nextButton()).toBeDisabled()
  })

  // TRAK-368: the old history row's session, band and "Message sent" are the older card's band and its quick look.
  it("an older assessment's card shows its band, and its quick look the session, the message and the private note", async () => {
    renderApp('/coach/squad/player/player-a')
    const card = await olderCard()
    const band = scoreToBand((3 + 4 + 5 + 6 + 7 + 2) / 6)
    expect(within(card).getAllByText(BANDS.find(b => b.word.toLowerCase() === band)!.word).length).toBeGreaterThan(0)
    await userEvent.click(within(card).getByRole('heading').querySelector('button')!)
    const look = await screen.findByRole('dialog')
    expect(within(look).getByText('vs Olympiacos Academy')).toBeInTheDocument()
    expect(within(look).getByText('Great pressing, keep it up.')).toBeInTheDocument()
    expect(within(look).getByText(/Private note/i)).toBeInTheDocument()
    expect(within(look).getByText(/Talk to his dad about boots/)).toBeInTheDocument()
  })

  it("the latest card's quick look says no message went, and labels the note private", async () => {
    renderApp('/coach/squad/player/player-a')
    const [card] = await screen.findAllByRole('article', { name: /assessment, / })
    await userEvent.click(within(card).getByRole('heading').querySelector('button')!)
    const latest = await screen.findByRole('dialog')
    expect(within(latest).getByText(/No message/)).toBeInTheDocument()
    expect(within(latest).getByText(/Private note/i)).toBeInTheDocument()
    expect(within(latest).getByText(/Assistant: strong first touch/)).toBeInTheDocument()
  })
})
