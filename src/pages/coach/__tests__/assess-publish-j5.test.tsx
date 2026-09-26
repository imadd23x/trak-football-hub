/**
 * J5 (MVP Requirements): everything on one screen. Six sliders produce the
 * band, then "Message to [first name]: only [first name] sees this." (TRAK-63)
 * and an optional "Private note: only you can see this." Nothing reaches the
 * family until the coach presses Publish. A waiting-for-parent player cannot be
 * opened, and a consent withdrawal mid-edit fails the save and keeps the values.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachAssessPage from '@/pages/coach/CoachAssessPage'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const auth = vi.hoisted(() => ({ user: { id: 'coach-a' }, profile: { full_name: 'Coach A' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn(), startTimer: () => () => 100 }))

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const RLS_REFUSAL = { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy' }
const existing = { id: 'assessment-a', work_rate: 8, tactical: 8, attitude: 8,
  technical: 8, physical: 8, coachability: 8, appearance: 'sub', session_id: 'session-1' }

interface Write { table: string; method: 'post' | 'patch'; body: Record<string, unknown> }
let writes: Write[]
// refuseNote: the private-note write is refused. sharedGone: an update to the
// shared message matches no row (removed, or no longer this coach's).
let faults: { refuseNote: boolean; sharedGone: boolean }
let consent: { required: boolean; afterRefusal: boolean; refuseInsert: boolean; refused: boolean }

function showForm() {
  render(<MemoryRouter initialEntries={['/coach/assess']}><Routes>
    <Route path="/coach/assess" element={<CoachAssessPage />} />
    <Route path="/coach/home" element={<p>Coach home</p>} />
  </Routes></MemoryRouter>)
}

async function choose(player: 'player-a' | 'player-b') {
  const option = await screen.findByRole('option', { name: 'Alex Synthetic' })
  await userEvent.selectOptions(option.closest('select') as HTMLSelectElement, player)
  await chooseSessionIfNone()
}

// TRAK-68: an assessment needs a past session. It stays chosen across players.
async function chooseSessionIfNone() {
  await screen.findByRole('option', { name: /vs Synthetic FC/ })
  const session = screen.getByRole('combobox', { name: 'Session' }) as HTMLSelectElement
  if (session.value === '') await userEvent.selectOptions(session, 'session-1')
}

const messageBox = () => screen.getByLabelText(/^Message to/i)
const noteBox = () => screen.getByLabelText(/^Private note/i)
const shared = () => writes.filter(w => w.table === 'coach_shared_feedback').map(w => w.body)

beforeEach(() => {
  writes = []
  consent = { required: false, afterRefusal: false, refuseInsert: false, refused: false }
  faults = { refuseNote: false, sharedGone: false }
  server.use(
    http.get(endpoint('squad_players'), () => HttpResponse.json([
      { id: 'player-a', player_name: 'Alex Synthetic' },
      { id: 'player-b', player_name: 'Bella Synthetic' },
    ])),
    http.get(endpoint('coach_sessions'), () => HttpResponse.json([{ id: 'session-1', title: 'vs Synthetic FC', session_date: '2026-09-20' }])),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const player = new URL(request.url).searchParams.get('squad_player_id')?.replace('eq.', '')
      return HttpResponse.json(player === 'player-a' ? [existing] : [])
    }),
    http.get(endpoint('coach_shared_feedback'), () => HttpResponse.json([
      { body: 'Published feedback for Alex', published_at: '2026-09-19T12:00:00Z' },
    ])),
    http.get(endpoint('coach_assessment_notes'), () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () =>
      HttpResponse.json(consent.refused ? consent.afterRefusal : consent.required)),
    ...['coach_assessments', 'coach_assessment_notes', 'coach_shared_feedback'].flatMap(table =>
      (['post', 'patch'] as const).map(method => http[method](endpoint(table), async ({ request }) => {
        if (table === 'coach_assessments' && consent.refuseInsert) {
          consent.refused = true
          return HttpResponse.json(RLS_REFUSAL, { status: 403 })
        }
        if (table === 'coach_assessment_notes' && faults.refuseNote) {
          return HttpResponse.json(RLS_REFUSAL, { status: 403 })
        }
        writes.push({ table, method, body: await request.json() as Record<string, unknown> })
        const params = new URL(request.url).searchParams
        const id = params.get('id')?.replace('eq.', '')
        if (table === 'coach_assessments') return HttpResponse.json([{ id: method === 'post' ? 'assessment-b' : id }])
        if (table === 'coach_shared_feedback' && method === 'patch' && !faults.sharedGone) {
          return HttpResponse.json([{ assessment_id: params.get('assessment_id')?.replace('eq.', '') }])
        }
        return HttpResponse.json([])
      }))),
  )
})

afterEach(() => cleanup())

describe('J5: one screen, message to the player, private note, publish', () => {
  it('labels the message for the player only, and the note as private, message first', async () => {
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    // TRAK-63 (25 Sep): parents see bands only, never the coach's message.
    expect(screen.getByText('Only Bella sees this.')).toBeInTheDocument()
    expect(screen.queryByText(/parents/i)).toBeNull()
    expect(screen.getByText('Only you can see this.')).toBeInTheDocument()
    expect(screen.getByText(/Message to Bella/)).toBeInTheDocument()
    // Message box comes before the private note.
    expect(messageBox().compareDocumentPosition(noteBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // TRAK-64 (Imad, 25 Sep): Save and Publish are the same action, one button.
  it('Save sends a new message to the player', async () => {
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    await userEvent.type(messageBox(), 'Good pressing today')
    expect(screen.getByText(/Not sent yet\. Saving sends it to Bella/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))
    await screen.findByText('Coach home')
    expect(shared()).toHaveLength(1)
    expect(shared()[0]).toMatchObject({ body: 'Good pressing today' })
    expect(typeof shared()[0].published_at).toBe('string')
  })

  // J7 (TRAK-10): the pilot count is distinct assessments per coach, so the
  // event must name the row the database returned, new or edited.
  it('the save event names the saved assessment, for a new one and an edit', async () => {
    const { trackEvent } = await import('@/lib/telemetry')
    const saves = () => vi.mocked(trackEvent).mock.calls.filter(([type]) => type === 'assessment_submitted')
    vi.mocked(trackEvent).mockClear()
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))
    await screen.findByText('Coach home')
    expect(saves()).toHaveLength(1)
    expect(saves()[0][1]).toMatchObject({ assessment_id: 'assessment-b', updated: false })

    cleanup()
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))
    await screen.findByText('Coach home')
    expect(saves()).toHaveLength(2)
    expect(saves()[1][1]).toMatchObject({ assessment_id: 'assessment-a', updated: true })
  })

  it('an edited published message is sent again on Save', async () => {
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    expect(screen.getByText(/Published\. Alex can read it now/)).toBeInTheDocument()
    await userEvent.type(messageBox(), ' and more')
    expect(screen.getByText(/Edited\. Saving sends Alex the new version/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))
    await screen.findByText('Coach home')
    expect(shared()).toHaveLength(1)
    expect(shared()[0]).toMatchObject({ body: 'Published feedback for Alex and more' })
    expect(typeof shared()[0].published_at).toBe('string')
  })

  it('an unchanged published message is not sent again', async () => {
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await waitFor(() => expect(noteBox()).toBeEnabled())
    await userEvent.type(noteBox(), 'Private follow-up')
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))
    await screen.findByText('Coach home')
    expect(shared()).toEqual([])
  })

  it('an empty message box sends nothing', async () => {
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))
    await screen.findByText('Coach home')
    expect(shared()).toEqual([])
  })

  it('has one save button and no separate Publish', async () => {
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    await userEvent.type(messageBox(), 'Good pressing today')
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /save assessment/i })).toHaveLength(1)
  })

  it('Unpublish retracts a published message at once, and writes nothing else', async () => {
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpublish message' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish message' }))
    await screen.findByText(/Not sent yet\. Saving sends it to Alex/)
    expect(writes).toEqual([{ table: 'coach_shared_feedback', method: 'patch', body: { published_at: null } }])
    expect(screen.queryByRole('button', { name: 'Unpublish message' })).toBeNull()
    expect(messageBox()).toHaveValue('Published feedback for Alex')
  })
})

describe('J5: consent', () => {
  it('a player waiting for a parent cannot be opened: the whole form is locked', async () => {
    consent.required = true
    showForm()
    await choose('player-b')
    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
    await waitFor(() => expect(messageBox()).toBeDisabled())
    for (const slider of screen.getAllByRole('slider')) expect(slider).toBeDisabled()
    expect(noteBox()).toBeDisabled()
    expect(screen.getByRole('button', { name: /save assessment/i })).toBeDisabled()
  })

  // Control for the test above: the lock is caused by consent, not by the form.
  it('the form is open when no consent is needed', async () => {
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    for (const slider of screen.getAllByRole('slider')) expect(slider).toBeEnabled()
  })

  it('withdrawal while the form is open fails the save and keeps what the coach entered', async () => {
    consent.refuseInsert = true
    consent.afterRefusal = true
    showForm()
    await choose('player-b')
    await waitFor(() => expect(messageBox()).toBeEnabled())
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '9' } })
    await userEvent.type(messageBox(), 'Great week')
    await userEvent.type(noteBox(), 'Watch the left foot')
    await userEvent.click(screen.getByRole('button', { name: /save assessment/i }))

    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
    expect(screen.queryByText('Coach home')).toBeNull()
    expect(writes).toEqual([])
    expect(messageBox()).toHaveValue('Great week')
    expect(noteBox()).toHaveValue('Watch the left foot')
    expect(screen.getAllByRole('slider')[0]).toHaveValue('9')
    expect(messageBox()).toBeDisabled()
  })
})

// Tarek's #117 review: Unpublish used to run the whole save first, so a
// retraction depended on unrelated writes succeeding.
describe('J5: Unpublish is a retraction and nothing else', () => {
  it('does not save edited scores or a private draft', async () => {
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await waitFor(() => expect(noteBox()).toBeEnabled())
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '3' } })
    await userEvent.type(noteBox(), 'Private draft')
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish message' }))
    await screen.findByText(/Not sent yet\. Saving sends it to Alex/)
    expect(writes.map(w => w.table)).toEqual(['coach_shared_feedback'])
    // The unsaved edits are still on screen, still unsaved.
    expect(screen.getAllByRole('slider')[0]).toHaveValue('3')
    expect(noteBox()).toHaveValue('Private draft')
  })

  it('still retracts when the private note would have been refused', async () => {
    faults.refuseNote = true
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await waitFor(() => expect(noteBox()).toBeEnabled())
    await userEvent.type(noteBox(), 'Private draft')
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish message' }))
    await screen.findByText(/Not sent yet\. Saving sends it to Alex/)
    expect(shared()).toEqual([{ published_at: null }])
  })

  it('stays available after consent is withdrawn, while everything else is locked', async () => {
    consent.required = true
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpublish message' })).toBeEnabled())
    expect(messageBox()).toBeDisabled()
    expect(screen.getByRole('button', { name: /save assessment/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish message' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unpublish message' })).toBeNull())
    expect(writes).toEqual([{ table: 'coach_shared_feedback', method: 'patch', body: { published_at: null } }])
  })

  it('says so when the retraction matched no row, and keeps offering it', async () => {
    faults.sharedGone = true
    showForm()
    await choose('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpublish message' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish message' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpublish message' })).toBeEnabled())
    expect(screen.getByText(/Published\. Alex can read it now/)).toBeInTheDocument()
  })
})
