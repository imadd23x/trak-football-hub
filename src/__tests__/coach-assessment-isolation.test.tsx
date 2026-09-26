import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachAssessPage from '@/pages/coach/CoachAssessPage'
import { server } from '../../tests/msw/server'
import { SUPABASE_URL } from '../../tests/msw/supabase'

const auth = vi.hoisted(() => ({ user: { id: 'coach-a' }, profile: { full_name: 'Coach A' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn(), startTimer: () => () => 100 }))

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const assessmentA = { id: 'assessment-a', work_rate: 8, tactical: 8, attitude: 8,
  technical: 8, physical: 8, coachability: 8, appearance: 'sub', session_id: 'session-1' }
interface Write { table: string; method: string; id: string | null; body: Record<string, unknown> }
let writes: Write[]
let reads: string[]
let releases: (() => void)[]

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  releases.push(release)
  return { promise, release }
}

function showForm() {
  return render(<MemoryRouter initialEntries={['/coach/assess']}><Routes>
    <Route path="/coach/assess" element={<CoachAssessPage />} />
    <Route path="/coach/home" element={<p>Coach home</p>} />
  </Routes></MemoryRouter>)
}

const selector = () => screen.getAllByRole('combobox')[0]
const noteBox = () => screen.getByPlaceholderText(/First touch under pressure/)
const feedbackBox = () => screen.getByPlaceholderText(/Great week/)
const save = () => screen.getByRole('button', { name: /Save Assessment/ })

// TRAK-68: an assessment needs a past session. It stays chosen across players.
async function chooseSessionIfNone() {
  await screen.findByRole('option', { name: /vs Synthetic FC/ })
  const session = screen.getByRole('combobox', { name: 'Session' }) as HTMLSelectElement
  if (session.value === '') await userEvent.selectOptions(session, 'session-1')
}

async function selectPlayer(player: string) {
  await screen.findByRole('option', { name: 'Alex Synthetic' })
  await userEvent.selectOptions(selector(), player)
  await chooseSessionIfNone()
  await waitFor(() => expect(reads).toContain(player))
}

beforeEach(() => {
  writes = []; reads = []; releases = []
  auth.user = { id: 'coach-a' }
  server.use(
    http.get(endpoint('squad_players'), () => HttpResponse.json([
      { id: 'player-a', player_name: 'Alex Synthetic' },
      { id: 'player-b', player_name: 'Bella Synthetic' },
    ])),
    http.get(endpoint('coach_sessions'), () => HttpResponse.json([{ id: 'session-1', title: 'vs Synthetic FC', session_date: '2026-09-20' }])),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const player = new URL(request.url).searchParams.get('squad_player_id')?.replace('eq.', '') ?? ''
      reads.push(player)
      return HttpResponse.json(player === 'player-a' ? [assessmentA] : [])
    }),
    http.get(endpoint('coach_shared_feedback'), () => HttpResponse.json([
      { body: 'Published feedback for Alex', published_at: '2026-09-19T12:00:00Z' },
    ])),
    http.get(endpoint('coach_assessment_notes'), () => HttpResponse.json([])),
    ...['coach_assessments', 'coach_assessment_notes', 'coach_shared_feedback'].flatMap(table =>
      ['post', 'patch'].map(method => http[method as 'post' | 'patch'](endpoint(table), async ({ request }) => {
        const body = await request.json() as Record<string, unknown>
        writes.push({ table, method, id: new URL(request.url).searchParams.get('id'), body })
        const id = new URL(request.url).searchParams.get('id')?.replace('eq.', '')
        return HttpResponse.json(table === 'coach_assessments' ? [{ id: method === 'post' ? 'assessment-b' : id }] : [])
      }))),
  )
})

afterEach(() => {
  cleanup()
  for (const release of releases) release()
})

describe('full assessment player boundaries', () => {
  it('does not reassign Alex’s existing assessment while Bella’s load is pending', async () => {
    const pending = gate()
    server.use(http.get(endpoint('coach_assessments'), async ({ request }) => {
      const player = new URL(request.url).searchParams.get('squad_player_id')!.replace('eq.', '')
      reads.push(player)
      if (player === 'player-b') await pending.promise
      return HttpResponse.json(player === 'player-a' ? [assessmentA] : [])
    }))
    showForm()
    await selectPlayer('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await selectPlayer('player-b')
    await userEvent.click(save())
    expect(writes).toEqual([])
    expect(save()).toBeDisabled()
  })

  it('ignores Alex’s late shared-feedback response after selecting Bella', async () => {
    const pending = gate()
    let started = false
    server.use(http.get(endpoint('coach_shared_feedback'), async () => {
      started = true
      await pending.promise
      return HttpResponse.json([{ body: 'Late private-to-Alex feedback', published_at: '2026-09-19T12:00:00Z' }])
    }))
    showForm()
    await selectPlayer('player-a')
    await waitFor(() => expect(started).toBe(true))
    await selectPlayer('player-b')
    await act(async () => { pending.release(); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(feedbackBox()).toHaveValue('')
    // J5: with no message there is nothing to publish, so no Publish action is offered.
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull()
    await waitFor(() => expect(save()).toBeEnabled())
    await userEvent.click(save())
    await screen.findByText('Coach home')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ table: 'coach_assessments', method: 'post', body: { squad_player_id: 'player-b' } })
  })

  it('clears the previous player’s scores and private draft before saving a new assessment', async () => {
    showForm()
    await selectPlayer('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await userEvent.type(noteBox(), 'Private draft for Alex only')
    await selectPlayer('player-b')
    await waitFor(() => expect(feedbackBox()).toHaveValue(''))
    expect(noteBox()).toHaveValue('')
    for (const slider of screen.getAllByRole('slider')) expect(slider).toHaveValue('5')
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '6' } })
    await userEvent.click(save())
    await screen.findByText('Coach home')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ method: 'post', body: { squad_player_id: 'player-b', work_rate: 6, tactical: 5 } })
  })

  it('does not treat failed shared-feedback reads as an empty saved draft', async () => {
    let fail = true
    server.use(http.get(endpoint('coach_shared_feedback'), () => fail
      ? HttpResponse.json({ message: 'Synthetic feedback access denied' }, { status: 403 })
      : HttpResponse.json([{ body: 'Published feedback for Alex', published_at: '2026-09-19T12:00:00Z' }])))
    showForm()
    await selectPlayer('player-a')
    expect(await screen.findByRole('alert')).toHaveTextContent(/load/i)
    expect(save()).toBeDisabled()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByDisplayValue('Published feedback for Alex')
    await waitFor(() => expect(save()).toBeEnabled())
  })

  it('preserves an unsaved draft when the same account receives a refreshed user object', async () => {
    const view = showForm()
    await selectPlayer('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    await userEvent.clear(feedbackBox())
    await userEvent.type(feedbackBox(), 'Coach’s unfinished edit')
    auth.user = { id: 'coach-a' }
    view.rerender(<MemoryRouter><Routes>
      <Route path="/coach/assess" element={<CoachAssessPage />} />
      <Route path="/coach/home" element={<p>Coach home</p>} />
    </Routes></MemoryRouter>)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(feedbackBox()).toHaveValue('Coach’s unfinished edit')
    expect(reads.filter(player => player === 'player-a')).toHaveLength(1)
  })

  it('keeps a failed private-note save retryable without inserting a second assessment', async () => {
    let attempts = 0
    server.use(http.post(endpoint('coach_assessment_notes'), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      writes.push({ table: 'coach_assessment_notes', method: 'post', id: null, body })
      attempts++
      return attempts === 1
        ? HttpResponse.json({ message: 'Synthetic note rejection' }, { status: 403 })
        : HttpResponse.json([])
    }))
    showForm()
    await selectPlayer('player-b')
    await waitFor(() => expect(save()).toBeEnabled())
    await userEvent.type(noteBox(), 'Keep this private draft for Bella')
    await userEvent.click(save())
    await waitFor(() => expect(attempts).toBe(1))
    expect(screen.queryByText('Coach home')).not.toBeInTheDocument()
    expect(noteBox()).toHaveValue('Keep this private draft for Bella')
    await waitFor(() => expect(save()).toBeEnabled())
    await userEvent.click(save())
    await screen.findByText('Coach home')
    const assessmentWrites = writes.filter(write => write.table === 'coach_assessments')
    expect(assessmentWrites.map(write => write.method)).toEqual(['post', 'patch'])
    expect(assessmentWrites[1].id).toBe('eq.assessment-b')
    expect(writes.filter(write => write.table === 'coach_assessment_notes')
      .every(write => write.body.assessment_id === 'assessment-b')).toBe(true)
  })

  it('loads and clears a private note independently of published feedback', async () => {
    server.use(http.get(endpoint('coach_assessment_notes'), () => HttpResponse.json([{ note: 'Existing private note' }])))
    showForm()
    await selectPlayer('player-a')
    await screen.findByDisplayValue('Existing private note')
    expect(feedbackBox()).toHaveValue('Published feedback for Alex')
    await userEvent.clear(noteBox())
    await userEvent.click(save())
    await screen.findByText('Coach home')
    expect(writes.find(write => write.table === 'coach_assessment_notes')?.body)
      .toMatchObject({ assessment_id: 'assessment-a', note: '' })
    // J5: the published message is unchanged, so it is left alone. Rewriting
    // it would re-stamp published_at and mark it "new" for the family again.
    expect(writes.find(write => write.table === 'coach_shared_feedback')).toBeUndefined()
  })

  it('clears the roster selection and draft when another coach signs in', async () => {
    const pending = gate()
    server.use(http.get(endpoint('squad_players'), async ({ request }) => {
      if (new URL(request.url).searchParams.get('coach_user_id') === 'eq.coach-b') {
        await pending.promise
        return HttpResponse.json([])
      }
      return HttpResponse.json([{ id: 'player-a', player_name: 'Alex Synthetic' }])
    }))
    const view = showForm()
    await selectPlayer('player-a')
    await screen.findByDisplayValue('Published feedback for Alex')
    auth.user = { id: 'coach-b' }
    view.rerender(<MemoryRouter><Routes>
      <Route path="/coach/assess" element={<CoachAssessPage />} />
      <Route path="/coach/home" element={<p>Coach home</p>} />
    </Routes></MemoryRouter>)
    expect(selector()).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Alex Synthetic' })).not.toBeInTheDocument()
    expect(feedbackBox()).toHaveValue('')
    expect(save()).toBeDisabled()
    expect(writes).toEqual([])
  })
})
