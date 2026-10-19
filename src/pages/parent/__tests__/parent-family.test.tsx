import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentHome from '../ParentHome'
import ParentMatches from '../ParentMatches'
import ParentAlerts from '../ParentAlerts'
import ParentProfilePage from '../ParentProfilePage'
import Settings from '@/pages/Settings'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const auth = vi.hoisted(() => ({ parentId: 'parent-a' }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: auth.parentId, email: `${auth.parentId}@test.invalid` },
    profile: { full_name: 'Test Parent', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const fail = () => HttpResponse.json({ code: '42501', message: 'permission denied' }, { status: 403 })
const match = (child: string, rating: number | null = 0) => ({
  id: `match-${child}`, user_id: child, opponent: `${child} opposition`, competition: 'League',
  venue: null, created_at: '2026-09-18T10:00:00Z', match_date: '2026-09-01',
  team_score: 0, opponent_score: 0, computed_rating: rating,
})
const assessment = (child: string) => ({
  id: `assessment-${child}`, squad_player_id: `squad-${child}`, coach_user_id: `coach-${child}`,
  created_at: '2026-09-17T10:00:00Z', coach_rating: 0,
  work_rate: 0, tactical: 0, attitude: 0, technical: 0, physical: 0, coachability: 0,
})

function installFamily() {
  server.use(
    http.get(endpoint('player_parent_links'), ({ request }) => {
      const parent = new URL(request.url).searchParams.get('parent_user_id')
      return HttpResponse.json((parent === 'eq.parent-a' ? ['Alex', 'Zara'] : ['Sam'])
        .map(player_user_id => ({ player_user_id })))
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam', 'coach-Alex', 'coach-Zara', 'coach-Sam']
        .filter(id => filter.includes(id)).map(user_id => ({ user_id, full_name: user_id })))
    }),
    http.get(endpoint('matches'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      return HttpResponse.json([match(child)])
    }),
    http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([{
      total_count: 1, rated_count: 1, average_rating: 0, wins: 0, draws: 1, losses: 0,
    }])),
    http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      const { p_child_id } = await request.json() as { p_child_id: string }
      return HttpResponse.json([match(p_child_id)])
    }),
    http.get(endpoint('player_details'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3)
      return HttpResponse.json([{ position: 'mid', current_club: `${child} academy`, age_group: 'U15' }])
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.slice(3)
      return HttpResponse.json([{ id: `squad-${child}` }])
    }),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam'].filter(id => ids.includes(id)).map(assessment))
    }),
    http.get(endpoint('recognition_awards'), ({ request }) => {
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam'].filter(id => ids.includes(id)).map(child => ({
        id: `award-${child}`, coach_user_id: `coach-${child}`, created_at: '2026-09-16T10:00:00Z',
        award_type: 'player_of_week', awarded_for: `${child} teamwork`, note: null,
      })))
    }),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
  )
}

const clients: QueryClient[] = []
function renderFamily(route = '/parent/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  const tree = () => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[route]}>
      <ParentChildrenProvider>
        <Routes>
          <Route path="/parent/home" element={<ParentHome />} />
          <Route path="/parent/matches" element={<ParentMatches />} />
          <Route path="/parent/alerts" element={<ParentAlerts />} />
          <Route path="/parent/profile" element={<ParentProfilePage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </ParentChildrenProvider>
    </MemoryRouter>
  </QueryClientProvider>
  return { ...render(tree()), tree, client }
}

beforeEach(() => { auth.parentId = 'parent-a'; installFamily() })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true) })

describe('parent family navigation', () => {
  it('keeps the selected child across all parent views and lists both children in Settings', async () => {
    const user = userEvent.setup()
    renderFamily()
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Following' }), 'Zara')
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    expect(screen.getByText('mid · Zara academy · U15')).toBeInTheDocument()
    expect(screen.getByText('Zara teamwork')).toBeInTheDocument()
    expect(screen.queryByText('Alex teamwork')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Matches' }))
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Zara')
    await user.click(screen.getByRole('button', { name: 'Alerts' }))
    expect(await screen.findByText('vs Zara opposition · 0–0')).toBeInTheDocument()
    expect(screen.queryByText(/vs Alex opposition/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('Following Zara · 2 children linked')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Zara')
    await user.click(screen.getByRole('button', { name: /settings account settings/i }))
    const connections = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(connections).getByText('Alex')).toBeInTheDocument()
    expect(within(connections).getByText('Zara')).toBeInTheDocument()
  })

  it('does not carry child names or match data into another parent account', async () => {
    const view = renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    auth.parentId = 'parent-b'
    view.rerender(view.tree())
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('Sam opposition')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Sam')
    expect(screen.queryByRole('option', { name: 'Alex' })).not.toBeInTheDocument()
  })

  it('rejects an old child response after switching to a faster child', async () => {
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      const { p_child_id: child } = await request.json() as { p_child_id: string }
      if (child === 'Alex') { requested = true; await pending }
      return HttpResponse.json([match(child)])
    }))
    renderFamily('/parent/matches')
    const selector = await screen.findByRole('combobox')
    await waitFor(() => expect(requested).toBe(true))
    await userEvent.selectOptions(selector, 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(screen.getByText('Zara opposition')).toBeInTheDocument()
  })

  it('reconciles the selection when a link is removed and never shows that child again', async () => {
    const view = renderFamily('/parent/matches')
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['parent', 'parent-a', 'children'] }) })
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    expect(screen.queryByText('Zara opposition')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Zara' })).not.toBeInTheDocument()
  })

  it('picks up a newly linked second child on navigation without signing in again', async () => {
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('option', { name: 'Zara' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    expect(screen.getByText('Following Zara · 2 children linked')).toBeInTheDocument()
  })
})

describe('parent loading, empty and error states', () => {
  it('shows loading until links resolve, then a genuine empty family', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(endpoint('player_parent_links'), async () => { await pending; return HttpResponse.json([]) }))
    renderFamily('/parent/matches')
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('No child linked yet')).not.toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(await screen.findByText('No child linked yet')).toBeInTheDocument()
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
  })

  it('shows a links failure rather than claiming there is no child, then retries', async () => {
    server.use(http.get(endpoint('player_parent_links'), fail))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your linked children")
    expect(screen.queryByText('No child linked yet')).not.toBeInTheDocument()
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it.each(['player_details', 'squad_players', 'coach_assessments', 'recognition_awards'])(
    'does not turn a %s subquery failure into empty development data', async table => {
      server.use(http.get(endpoint(table), fail))
      renderFamily()
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this child's information")
      expect(screen.queryByText('No coach assessments yet.')).not.toBeInTheDocument()
      expect(screen.queryByText(/No matches yet/)).not.toBeInTheDocument()
    },
  )

  it('clears the previous child when the selected child has no records', async () => {
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), async ({ request }) => {
      const { p_child_id } = await request.json() as { p_child_id: string }
      return HttpResponse.json([{ total_count: p_child_id === 'Alex' ? 1 : 0, rated_count: p_child_id === 'Alex' ? 1 : 0,
        average_rating: p_child_id === 'Alex' ? 0 : null, wins: 0, draws: p_child_id === 'Alex' ? 1 : 0, losses: 0 }])
    }))
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      const { p_child_id } = await request.json() as { p_child_id: string }
      return HttpResponse.json(p_child_id === 'Alex' ? [match('Alex')] : [])
    }))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument()
  })

  it('shows a matches failure and can recover without changing child', async () => {
    server.use(http.post(endpoint('rpc/get_parent_match_page'), fail))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load matches")
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it('reports an offline failure instead of leaving a paused loading screen forever', async () => {
    onlineManager.setOnline(false)
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.error()))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your linked children")
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('truthful parent ratings', () => {
  it('requests recently recorded matches independently of match dates and caps the combined feed', async () => {
    const queries: URLSearchParams[] = []
    const latest = [
      { ...match('Backfilled'), match_date: '2020-01-01', created_at: '2026-09-21T10:00:00Z' },
      ...Array.from({ length: 19 }, (_, index) => ({
        ...match(`Fixture ${index + 1}`), created_at: '2026-09-18T10:00:00Z',
      })),
    ]
    server.use(http.get(endpoint('matches'), ({ request }) => {
      const query = new URL(request.url).searchParams
      queries.push(query)
      return HttpResponse.json(query.get('limit') === '20' ? latest : [match('Recent match date')])
    }))
    renderFamily('/parent/alerts')
    expect(await screen.findByText('vs Backfilled opposition · 0–0')).toBeInTheDocument()
    const alerts = screen.getAllByText('Match logged')
    expect(alerts).toHaveLength(20)
    expect(alerts[0].parentElement).toHaveTextContent('vs Backfilled opposition')
    expect(screen.queryByText('Coach assessment added')).not.toBeInTheDocument()
    expect(queries[0].get('limit')).toBe('20')
    expect(queries[0].get('order')).toBe('created_at.desc.nullslast,id.desc')
    expect(queries[0].get('user_id')).toBe('eq.Alex')
    await userEvent.click(screen.getByRole('button', { name: 'Matches' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it('shows zero as Difficult, null as Not rated, and uses the match date', async () => {
    server.use(http.post(endpoint('rpc/get_parent_match_page'), () => HttpResponse.json([
      match('Zero', 0), { ...match('Unknown', null), team_score: null, opponent_score: null },
    ])))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Difficult')).toBeInTheDocument()
    expect(screen.getByText('Not rated')).toBeInTheDocument()
    expect(screen.getByText('Score not recorded')).toBeInTheDocument()
    expect(screen.getByText('D 0–0')).toBeInTheDocument()
    expect(screen.getAllByText('1 Sept · League')).toHaveLength(2)
  })

  it('does not replace a missing rating in the average and preserves zero assessment categories', async () => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([match('Zero', 0), match('Unknown', null)])))
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([{
      total_count: 2, rated_count: 1, average_rating: 0, wins: 0, draws: 2, losses: 0,
    }])))
    renderFamily()
    const summary = await screen.findByRole('region', { name: 'Recorded matches summary' })
    expect(within(summary).getByText('Difficult')).toBeInTheDocument()
    const development = screen.getByRole('region', { name: 'Latest coach assessment' })
    expect(within(development).getAllByText('Difficult')).toHaveLength(7)
    expect(screen.queryByText('Steady')).not.toBeInTheDocument()
  })
})


describe('bounded parent match history', () => {
  const history = Array.from({ length: 101 }, (_, index) => ({
    ...match(`History ${index + 1}`), id: `history-${index + 1}`,
  }))
  const summary = { total_count: 1001, rated_count: 1000, average_rating: 8, wins: 1000, draws: 0, losses: 1 }

  it('uses complete server totals while requesting only five recent records', async () => {
    let recentQuery: URLSearchParams | undefined
    server.use(
      http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([summary])),
      http.get(endpoint('matches'), ({ request }) => {
        recentQuery = new URL(request.url).searchParams
        return HttpResponse.json(history.slice(0, 5))
      }),
    )
    renderFamily()
    const region = await screen.findByRole('region', { name: 'Recorded matches summary' })
    expect(within(region).getByText('1001')).toBeInTheDocument()
    expect(recentQuery?.get('limit')).toBe('5')
    expect(recentQuery?.get('order')).toBe('match_date.desc.nullslast,created_at.desc.nullslast,id.desc')
    expect(screen.getAllByText(/History \d+ opposition/)).toHaveLength(5)
  })

  it('does not claim empty history when the separate recent query is empty', async () => {
    server.use(
      http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([summary])),
      http.get(endpoint('matches'), () => HttpResponse.json([])),
    )
    renderFamily()
    expect(await screen.findByText('No recent matches available.')).toBeInTheDocument()
    expect(screen.getByText('1001')).toBeInTheDocument()
    expect(screen.queryByText(/No matches yet/)).not.toBeInTheDocument()
  })

  it('retains the current 50 rows on a failed next page and retries without skipping', async () => {
    const requests: Record<string, unknown>[] = []
    let failNext = true
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      requests.push(body)
      if (!body.p_after_id) return HttpResponse.json(history.slice(0, 51))
      if (failNext) return fail()
      return HttpResponse.json(body.p_after_id === 'history-50' ? history.slice(50, 101) : history.slice(100))
    }))
    renderFamily('/parent/matches')
    expect(await screen.findByText('History 1 opposition')).toBeInTheDocument()
    expect(screen.getAllByText(/History \d+ opposition/)).toHaveLength(50)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/load/i)
    expect(screen.getByText('History 1 opposition')).toBeInTheDocument()
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
    failNext = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('History 51 opposition')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Match history · page 2' })).toHaveFocus()
    expect(screen.queryByText('History 1 opposition')).not.toBeInTheDocument()
    expect(screen.getAllByText(/History \d+ opposition/)).toHaveLength(50)
    expect(requests.slice(1, 3).map(request => request.p_after_id)).toEqual(['history-50', 'history-50'])
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('History 101 opposition')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('History 51 opposition')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Match history · page 2' })).toHaveFocus()
    expect(screen.queryByText('History 101 opposition')).not.toBeInTheDocument()
    expect(requests.every(request => request.p_child_id === 'Alex' && request.p_limit === 51)).toBe(true)
  })

  it.each(['child', 'account'] as const)('ignores a late next page after switching %s', async switchKind => {
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      const body = await request.json() as { p_child_id: string; p_after_id?: string }
      if (body.p_child_id !== 'Alex') return HttpResponse.json([match(body.p_child_id)])
      if (body.p_after_id) { requested = true; await pending; return HttpResponse.json(history.slice(50)) }
      return HttpResponse.json(history.slice(0, 51))
    }))
    const view = renderFamily('/parent/matches')
    expect(await screen.findByText('History 1 opposition')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(requested).toBe(true))
    if (switchKind === 'child') await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    else { auth.parentId = 'parent-b'; view.rerender(view.tree()) }
    const nextName = switchKind === 'child' ? 'Zara' : 'Sam'
    expect(await screen.findByText(`${nextName} opposition`)).toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(screen.queryByText(/History \d+ opposition/)).not.toBeInTheDocument()
    expect(screen.getByText(`${nextName} opposition`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('does not advance after returning A -> B -> A while the original next-page response is pending', async () => {
    let release!: () => void
    let requested = false
    let responseFinished = false
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      const body = await request.json() as { p_child_id: string; p_after_id: string | null }
      if (body.p_child_id !== 'Alex') return HttpResponse.json([match(body.p_child_id)])
      if (body.p_after_id) {
        requested = true
        await pending
        responseFinished = true
        return HttpResponse.json(history.slice(50))
      }
      return HttpResponse.json(history.slice(0, 51))
    }))
    const { client } = renderFamily('/parent/matches')
    try {
      expect(await screen.findByText('History 1 opposition')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      await waitFor(() => expect(requested).toBe(true))
      await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
      expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
      await userEvent.selectOptions(screen.getByRole('combobox'), 'Alex')
      expect(await screen.findByText('History 1 opposition')).toBeInTheDocument()
      expect(screen.getByRole('combobox')).toHaveFocus()
      await act(async () => { release(); await pending })
      await waitFor(() => expect(responseFinished).toBe(true))
      expect(screen.getByText('Page 1')).toBeInTheDocument()
      expect(screen.getByText('History 1 opposition')).toBeInTheDocument()
      expect(screen.queryByText('History 51 opposition')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
      expect(client.getQueryData<{ pages: unknown[] }>(['parent', 'parent-a', 'Alex', 'match-history'])?.pages).toHaveLength(1)
    } finally {
      release()
    }
  })

  it('allows Previous when the remaining records are deleted before loading the next page', async () => {
    let remainingDeleted = false
    server.use(
      http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([{
        total_count: 101, rated_count: 101, average_rating: 0, wins: 0, draws: 101, losses: 0,
      }])),
      http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
        const body = await request.json() as { p_after_id: string | null }
        return HttpResponse.json(body.p_after_id ? (remainingDeleted ? [] : history.slice(50)) : history.slice(0, 51))
      }),
    )
    renderFamily('/parent/matches')
    expect(await screen.findByText('History 1 opposition')).toBeInTheDocument()
    remainingDeleted = true
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('No matches on this page.')).toBeInTheDocument()
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No child linked yet')).not.toBeInTheDocument()
    expect(screen.queryByText('End of match history.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('History 1 opposition')).toBeInTheDocument()
    expect(screen.queryByText('No matches on this page.')).not.toBeInTheDocument()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('fails closed on a missing summary instead of claiming empty history', async () => {
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([])))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent(/load/i)
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
  })
})


describe('parent record details from user testing', () => {
  const detail = (child: string) => ({ ...match(child), goals: 0, assists: 0,
    minutes_played: 73, position: 'mid', age_group: 'U15' })
  const requests: URL[] = []
  function detailsHandler(reply: (child: string) => Response | Promise<Response> = child => HttpResponse.json([detail(child)])) {
    server.use(http.get(endpoint('matches'), ({ request }) => {
      const url = new URL(request.url)
      const child = url.searchParams.get('user_id')?.slice(3) ?? ''
      if (!url.searchParams.has('id')) return HttpResponse.json([match(child)])
      requests.push(url)
      return reply(child)
    }))
  }
  beforeEach(() => { requests.length = 0; detailsHandler() })

  it.each(['/parent/home', '/parent/matches', '/parent/alerts'])(
    'opens a child-scoped match from %s and restores keyboard focus on close', async route => {
      const user = userEvent.setup()
      renderFamily(route)
      const trigger = await screen.findByRole('button', { name: /View match.*Alex opposition/ })
      trigger.focus()
      await user.keyboard('{Enter}')
      const dialog = await screen.findByRole('dialog', { name: 'Match details' })
      expect(await within(dialog).findByText('73')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Goals')).toHaveTextContent('0')
      expect(within(dialog).getByLabelText('Assists')).toHaveTextContent('0')
      expect(within(dialog).getByText('0–0')).toBeInTheDocument()
      expect(within(dialog).getByText('Difficult')).toBeInTheDocument()
      expect(requests).toHaveLength(1)
      expect(requests[0].searchParams.get('user_id')).toBe('eq.Alex')
      expect(requests[0].searchParams.get('id')).toBe('eq.match-Alex')
      const projection = requests[0].searchParams.get('select')!
      expect(projection).not.toContain('*')
      expect(projection).not.toMatch(/self_rating|body_condition|card_received|notes/)
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    },
  )

  it('opens the exact assessment in an alert, preserving zero and missing scores', async () => {
    server.use(http.get(endpoint('coach_assessments'), () => HttpResponse.json([
      { ...assessment('Alex'), work_rate: null, tactical: 8 },
      { ...assessment('Alex'), id: 'older', coach_rating: 9, created_at: '2026-09-10T10:00:00Z' },
    ])))
    renderFamily('/parent/alerts')
    const triggers = await screen.findAllByRole('button', { name: /View coach assessment/ })
    await userEvent.click(triggers[1])
    let dialog = screen.getByRole('dialog', { name: 'Coach assessment' })
    expect(within(dialog).getByText('10 Sept')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Overall assessment')).toHaveTextContent('Exceptional')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(triggers[0])
    dialog = screen.getByRole('dialog', { name: 'Coach assessment' })
    expect(within(dialog).getByLabelText('Overall assessment')).toHaveTextContent('Difficult')
    expect(within(dialog).getByLabelText('Work Rate')).toHaveTextContent('Not assessed')
    expect(within(dialog).getByLabelText('Tactical')).toHaveTextContent('Standout')
  })

  it('opens recognition from an alert', async () => {
    renderFamily('/parent/alerts')
    await userEvent.click(await screen.findByRole('button', { name: /View recognition/ }))
    expect(within(screen.getByRole('dialog', { name: 'Recognition' })).getByText('Alex teamwork')).toBeInTheDocument()
  })

  it('retries a failed detail query without showing invented or stale facts', async () => {
    detailsHandler(() => fail())
    renderFamily('/parent/matches')
    await userEvent.click(await screen.findByRole('button', { name: /View match/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't load match details")
    expect(within(dialog).queryByLabelText('Goals')).not.toBeInTheDocument()
    detailsHandler()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByLabelText('Goals')).toHaveTextContent('0')
  })

  it.each(['absent', 'wrong child', 'wrong match', 'malformed'])(
    'does not show detail data when the response is %s', async variant => {
      detailsHandler(() => HttpResponse.json(variant === 'absent' ? [] : [{ ...detail('Alex'),
        ...(variant === 'wrong child' ? { user_id: 'Zara' } : {}),
        ...(variant === 'wrong match' ? { id: 'other' } : {}),
        ...(variant === 'malformed' ? { goals: '2' } : {}),
      }]))
      renderFamily('/parent/matches')
      await userEvent.click(await screen.findByRole('button', { name: /View match/ }))
      const dialog = screen.getByRole('dialog')
      expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
      expect(within(dialog).queryByLabelText('Goals')).not.toBeInTheDocument()
    },
  )

  it('preserves unknown match facts instead of converting them to zero', async () => {
    detailsHandler(() => HttpResponse.json([{ ...detail('Alex'), goals: null, assists: null,
      minutes_played: null, computed_rating: null, team_score: null, opponent_score: null }]))
    renderFamily('/parent/matches')
    await userEvent.click(await screen.findByRole('button', { name: /View match/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByLabelText('Goals')).toHaveTextContent('Not recorded')
    expect(within(dialog).getByLabelText('Assists')).toHaveTextContent('Not recorded')
    expect(within(dialog).getByText('Score not recorded')).toBeInTheDocument()
    expect(within(dialog).getByText('Not rated')).toBeInTheDocument()
  })

  it('closes details immediately when the account changes during a delayed request', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    detailsHandler(async child => { await pending; return HttpResponse.json([detail(child)]) })
    const view = renderFamily('/parent/matches')
    await userEvent.click(await screen.findByRole('button', { name: /View match/ }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.getByRole('dialog')).toHaveTextContent('Loading')
    auth.parentId = 'parent-b'
    view.rerender(view.tree())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(await screen.findByText('Sam opposition')).toBeInTheDocument()
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the detail when the selected child link is removed', async () => {
    const view = renderFamily('/parent/matches')
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Zara')
    await userEvent.click(await screen.findByRole('button', { name: /View match.*Zara opposition/ }))
    expect(await within(screen.getByRole('dialog')).findByText('73')).toBeInTheDocument()
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['parent', 'parent-a', 'children'] }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it('removes previously visible details after a failed permission refresh', async () => {
    const view = renderFamily('/parent/matches')
    await userEvent.click(await screen.findByRole('button', { name: /View match/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('73')).toBeInTheDocument()
    detailsHandler(() => fail())
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['parent', 'parent-a', 'Alex', 'match-detail'] }) })
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(within(dialog).queryByText('73')).not.toBeInTheDocument()
  })
})
