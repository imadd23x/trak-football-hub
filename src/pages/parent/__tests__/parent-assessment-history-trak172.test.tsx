/** TRAK-172: parent history is bands-only, child-scoped, and reaches older records. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import { followChild } from '@/test/follow-child'
import ParentHome from '../ParentHome'
import ParentMatches from '../ParentMatches'
import ParentAssessments from '../ParentAssessments'
import ParentAssessment from '../ParentAssessment'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'parent-history', email: 'parent@synthetic.test.invalid' },
  profile: { full_name: 'Synthetic Parent', role: 'parent' },
  signOut: vi.fn(), refreshProfile: vi.fn(),
}) }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const makeAssessment = (child: string, index: number) => ({
  id: `${child}-assessment-${index}`, squad_player_id: `${child}-squad`,
  session_id: `${child}-session-${index}`, coach_user_id: `${child}-coach-${index}`,
  created_at: new Date(Date.UTC(2026, 9, 14 - index, 10)).toISOString(),
  coach_rating: index === 1 ? 0 : 8, work_rate: index === 1 ? 0 : 8,
  tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8,
  private_notes: `PRIVATE ${child} ${index}`, feedback: `PRIVATE FEEDBACK ${child} ${index}`,
})
let assessments: ReturnType<typeof makeAssessment>[]
let failAssessments: boolean
let hiddenAssessments: boolean
let assessmentRequests: URLSearchParams[]
let feedbackReads: number
const clients: QueryClient[] = []
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')

// jsdom has no scrolling/layout; browser checks exercise actual swipe movement.
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }))
afterAll(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

beforeEach(() => {
  assessments = [...Array.from({ length: 24 }, (_, i) => makeAssessment('Alex', i + 1)), makeAssessment('Zara', 1)]
  failAssessments = false; hiddenAssessments = false; assessmentRequests = []; feedbackReads = 0
  server.use(
    // TRAK-286: no shared game plan.
    http.get(endpoint('game_for_family'), () => HttpResponse.json([])),
    http.get(endpoint('game_for_player'), () => HttpResponse.json([])),
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }, { player_user_id: 'Zara' }])),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      const profiles = ['Alex', 'Zara'].map(user_id => ({ user_id, full_name: user_id }))
        .concat(assessments.map(row => ({ user_id: row.coach_user_id, full_name: `Coach ${row.id}` })))
      return HttpResponse.json(profiles.filter(row => filter.includes(row.user_id)))
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.replace(/^eq\./, '')
      return HttpResponse.json(child ? [{ id: `${child}-squad` }] : [])
    }),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const params = new URL(request.url).searchParams
      assessmentRequests.push(params)
      if (failAssessments) return HttpResponse.json({ code: 'XX000', message: 'Synthetic unavailable' }, { status: 500 })
      let rows = (hiddenAssessments ? [] : assessments).filter(row => {
        const squad = params.get('squad_player_id')
        const id = params.get('id')
        const session = params.get('session_id')
        return (!squad || squad.includes(row.squad_player_id)) && (!id || id === `eq.${row.id}`)
          // TRAK-439: the training history asks which of its sessions have an assessment with in.(a,b).
          && (!session || session === `eq.${row.session_id}` || (session.startsWith('in.(') && session.slice(4, -1).replace(/"/g, '').split(',').includes(row.session_id)))
      })
      if (params.get('order')?.startsWith('created_at.desc')) {
        rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      }
      const range = request.headers.get('range')?.split('-').map(Number)
      const offset = Number(params.get('offset') ?? range?.[0] ?? 0)
      const limit = Number(params.get('limit') ?? (range ? range[1] - range[0] + 1 : rows.length))
      const count = rows.length
      rows = rows.slice(offset, offset + limit)
      const fields = params.get('select')?.split(',').map(field => field.trim()) ?? ['*']
      const projected = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes('*') || fields.includes(key))))
      return HttpResponse.json(projected, { headers: { 'Content-Range': `${offset}-${offset + rows.length - 1}/${count}` } })
    }),
    http.get(endpoint('coach_shared_feedback'), () => { feedbackReads++; return HttpResponse.json([{ body: 'COACH MESSAGE' }]) }),
    http.get(endpoint('player_details'), () => HttpResponse.json([])),
    http.get(endpoint('matches'), () => HttpResponse.json([])),
    http.get(endpoint('recognition_awards'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_roster_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/child_events'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/family_training_history'), async ({ request }) => {
      const { p_player_user_id: child } = await request.json() as { p_player_user_id: string }
      return HttpResponse.json([{ session_id: `${child}-session-1`, session_date: '2026-10-13', focus: [`${child} first touch`], attendance: 'present' }])
    }),
  )
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

function renderAt(path = '/parent/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <ParentChildrenProvider><Routes>
      <Route path="/parent/home" element={<ParentHome />} />
      <Route path="/parent/matches" element={<ParentMatches />} />
      <Route path="/parent/assessments" element={<ParentAssessments />} />
      <Route path="/parent/assessment/:id" element={<ParentAssessment />} />
      <Route path="/parent/session/:sessionId/assessment" element={<ParentAssessment />} />
    </Routes></ParentChildrenProvider>
  </MemoryRouter></QueryClientProvider>)
}

// TRAK-194: cards and rows lead with the date and never name the coach; each links to its own assessment.
const href = (id: string) => `/parent/assessment/${id}`
const findLinkTo = (id: string) => waitFor(() => {
  const link = document.querySelector(`a[href="${href(id)}"]`)
  expect(link).not.toBeNull()
  return link!
})

function expectBandsOnlyReads() {
  expect(assessmentRequests.length).toBeGreaterThan(0)
  for (const params of assessmentRequests) {
    expect(params.get('select')).not.toMatch(/\*|private_notes|feedback/)
    expect(params.get('squad_player_id')).toBeTruthy()
  }
  expect(feedbackReads).toBe(0)
  expect(screen.queryByText(/PRIVATE|COACH MESSAGE/)).not.toBeInTheDocument()
}

describe('TRAK-172 parent assessment history', () => {
  it('lets a parent move through exactly the last five band cards, then All assessments', async () => {
    const user = userEvent.setup()
    renderAt()
    const region = await screen.findByRole('region', { name: 'Latest coach assessment' })
    const first = await within(region).findByRole('group', { name: 'Assessment 1 of 5' })
    expect(within(first).getByRole('link', { name: 'Open assessment' })).toHaveAttribute('href', href('Alex-assessment-1'))
    expect(within(first).queryByText(/^Coach /)).not.toBeInTheDocument()
    expect(within(first).getAllByText('Work Rate')).toHaveLength(1)
    expect(within(region).getByRole('button', { name: 'Previous assessment' })).toBeDisabled()
    for (let index = 2; index <= 5; index++) {
      await user.click(within(region).getByRole('button', { name: 'Next assessment' }))
      const card = within(region).getByRole('group', { name: `Assessment ${index} of 5` })
      expect(within(card).getByRole('link', { name: 'Open assessment' })).toHaveAttribute('href', href(`Alex-assessment-${index}`))
      expect(within(region).queryByRole('group', { name: `Assessment ${index - 1} of 5` })).not.toBeInTheDocument()
      expect(within(card).getAllByText('Work Rate')).toHaveLength(1)
    }
    await user.click(within(region).getByRole('button', { name: 'Next assessment' }))
    expect(within(region).getByRole('link', { name: /All assessments/i })).toHaveAttribute('href', '/parent/assessments')
    expect(within(region).queryByRole('group', { name: /^Assessment \d/ })).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Next assessment' })).toBeDisabled()
    await user.click(within(region).getByRole('button', { name: 'Previous assessment' }))
    expect(within(within(region).getByRole('group', { name: 'Assessment 5 of 5' })).getByRole('link', { name: 'Open assessment' })).toHaveAttribute('href', href('Alex-assessment-5'))
    expectBandsOnlyReads()
  })

  it('resets the visible assessment when switching children and never shows sibling bands', async () => {
    renderAt()
    const region = await screen.findByRole('region', { name: 'Latest coach assessment' })
    await within(region).findByRole('group', { name: 'Assessment 1 of 5' })
    await userEvent.click(within(region).getByRole('button', { name: 'Next assessment' }))
    await followChild('Zara')
    await findLinkTo('Zara-assessment-1')
    const siblingRegion = screen.getByRole('region', { name: 'Latest coach assessment' })
    expect(siblingRegion.querySelector('a[href^="/parent/assessment/Alex"]')).toBeNull()
    expect(within(siblingRegion).getByRole('button', { name: 'Previous assessment' })).toBeDisabled()
    expectBandsOnlyReads()
  })

  it('opens the exact training session assessment from the parent match list', async () => {
    renderAt('/parent/matches')
    const training = await screen.findByRole('region', { name: 'Training' })
    expect(await within(training).findByRole('link', { name: /Alex first touch/ })).toHaveAttribute('href', '/parent/session/Alex-session-1/assessment')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Following' }), 'Zara')
    expect(await screen.findByRole('link', { name: /Zara first touch/ })).toHaveAttribute('href', '/parent/session/Zara-session-1/assessment')
    expect(screen.queryByText('Alex first touch')).not.toBeInTheDocument()
  })

  // TRAK-204 (Kostas, 19 Oct, live check on iPhone): an event opened by mistake needs a way straight back.
  it('Back on an assessment returns to the screen it was opened from', async () => {
    renderAt('/parent/matches')
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Training' })).findByRole('link', { name: /Alex first touch/ }))
    await screen.findByRole('heading', { name: 'Coach assessment' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('region', { name: 'Training' })).toBeInTheDocument()

    cleanup()
    renderAt()
    const region = await screen.findByRole('region', { name: 'Latest coach assessment' })
    await userEvent.click(within(await within(region).findByRole('group', { name: 'Assessment 1 of 5' })).getByRole('link', { name: 'Open assessment' }))
    await screen.findByRole('heading', { name: 'Coach assessment' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('region', { name: 'Latest coach assessment' })).toBeInTheDocument()
  })

  it('Back on an assessment opened with nothing behind it goes to Events', async () => {
    renderAt('/parent/assessment/Alex-assessment-1')
    await screen.findByRole('heading', { name: 'Coach assessment' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('region', { name: 'Training' })).toBeInTheDocument()
  })

  it('reaches assessments older than the old ten-record limit and loads the next page', async () => {
    renderAt('/parent/assessments')
    expect(await screen.findByRole('heading', { name: 'Assessments' })).toBeInTheDocument()
    await findLinkTo('Alex-assessment-11')
    expect(document.querySelector(`a[href="${href('Alex-assessment-24')}"]`)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await findLinkTo('Alex-assessment-24')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Coach /)).not.toBeInTheDocument() // TRAK-194: rows lead with the date, no coach name
    expectBandsOnlyReads()
  })

  it('shows a failed history read with Retry and recovers rather than claiming no assessments', async () => {
    failAssessments = true
    renderAt('/parent/assessments')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No assessments are available for this child.')).not.toBeInTheDocument()
    failAssessments = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await findLinkTo('Alex-assessment-1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectBandsOnlyReads()
  })

  it('clears previously visible bands when consent is withdrawn before loading more', async () => {
    renderAt('/parent/assessments')
    await findLinkTo('Alex-assessment-20')
    hiddenAssessments = true // Current permission checks now make all Alex records inaccessible.
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('No assessments are available for this child.')).toBeInTheDocument()
    expect(document.querySelector('a[href^="/parent/assessment/Alex"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expectBandsOnlyReads()
  })

  it('clears the expanded history when changing to a sibling', async () => {
    renderAt('/parent/assessments')
    await findLinkTo('Alex-assessment-11')
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await findLinkTo('Alex-assessment-24')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Following' }), 'Zara')
    await findLinkTo('Zara-assessment-1')
    expect(document.querySelector('a[href^="/parent/assessment/Alex"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expectBandsOnlyReads()
  })

  it.each([
    ['/parent/assessment/Alex-assessment-12', 'id', 'eq.Alex-assessment-12'],
    ['/parent/session/Alex-session-12/assessment', 'session_id', 'eq.Alex-session-12'],
  ])('opens only the exact selected-child assessment at %s', async (path, field, filter) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Coach assessment' })).toBeInTheDocument()
    expect(await screen.findByText('2 Oct')).toBeInTheDocument() // Alex-assessment-12's date
    expect(screen.getAllByText('Work Rate')).toHaveLength(1)
    expect(screen.queryByText('13 Oct')).not.toBeInTheDocument() // Alex-assessment-1's date
    expect(assessmentRequests.every(params => params.get(field) === filter)).toBe(true)
    expectBandsOnlyReads()
  })

  it('opens the newest assessment when one training has two, instead of failing to load', async () => {
    assessments.push({ ...makeAssessment('Alex', 12), id: 'Alex-assessment-12b', coach_user_id: 'Alex-coach-12b',
      created_at: '2026-10-14T12:00:00.000Z' })
    renderAt('/parent/session/Alex-session-12/assessment')
    expect(await screen.findByText('14 Oct')).toBeInTheDocument() // 12b, the newer one
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectBandsOnlyReads()
  })

  it.each([
    ['/parent/assessment/Zara-assessment-1', "This assessment isn't available for Alex."],
    ['/parent/session/Zara-session-1/assessment', "Alex hasn't been assessed for this session yet."],
  ])(
    'does not disclose sibling bands through a direct URL at %s', async (path, message) => {
      renderAt(path)
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.queryByText('13 Oct')).not.toBeInTheDocument() // Zara-assessment-1's date
      expect(screen.queryByText('Work Rate')).not.toBeInTheDocument()
      expect(assessmentRequests.every(params => params.get('squad_player_id') === 'in.(Alex-squad)')).toBe(true)
      expectBandsOnlyReads()
    },
  )
})
