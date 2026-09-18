import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { Session, User } from '@supabase/supabase-js'
import { server } from '../../../../tests/msw/server'
import { supabase } from '@/integrations/supabase/client'
import { AuthProvider } from '@/contexts/AuthContext'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import { RouteGuard } from '@/components/layout/RouteGuard'
import type { ParentDevelopment } from '@/lib/parent-data'
import ParentHome from '../ParentHome'
import ParentAlerts from '../ParentAlerts'

vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn(), trackEvent: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('https://test.supabase.co', 'test-anon-key', {
      auth: { storage: localStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_ANON_KEY: 'test-anon-key',
  }
})

const url = 'https://test.supabase.co'
const id = (suffix: number) => `91000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const parentId = id(1), alex = id(2), zara = id(3), coachA = id(4), coachB = id(5)
const account: User = { id: parentId, email: 'parent@synthetic.test.invalid', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-18T00:00:00Z' }
const session = (): Session => ({ user: account, access_token: 'synthetic-parent-token', refresh_token: 'synthetic-refresh',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 })
interface HistoryRow { id: string; coach_user_id: string | null; created_at: string }
interface Assessment extends HistoryRow { coach_rating: number; work_rate: number; tactical: number; attitude: number; technical: number; physical: number; coachability: number }
interface Award extends HistoryRow { award_type: string; awarded_for: string; note: null }
let assessments: Record<string, Assessment[]>
let awards: Record<string, Award[]>
let nameFilters: string[]
let hiddenNames: boolean
let failNames: boolean
let client: QueryClient
const table = (name: string) => `${url}/rest/v1/${name}`
const childFrom = (request: Request, field: string) => new URL(request.url).searchParams.get(field)?.includes(zara) ? zara : alex
const label = (child: string) => child === zara ? 'Zara' : 'Alex'
const names = [{ user_id: coachA, full_name: 'Synthetic Alex Coach' }, { user_id: coachB, full_name: 'Synthetic Zara Coach' }]

beforeEach(async () => {
  await supabase.auth.initialize()
  localStorage.setItem('sb-test-auth-token', JSON.stringify(session()))
  nameFilters = []; hiddenNames = false; failNames = false
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  assessments = Object.fromEntries([alex, zara].map((child, index) => [child, [0, 1].map(order => ({
    id: id(100 + index * 10 + order), coach_user_id: index ? coachB : coachA,
    created_at: `2026-09-${18 - order}T10:00:00Z`, coach_rating: 0,
    work_rate: 0, tactical: 0, attitude: 0, technical: 0, physical: 0, coachability: 0,
  }))]))
  awards = Object.fromEntries([alex, zara].map((child, index) => [child, [0, 1].map(order => ({
    id: id(200 + index * 10 + order), coach_user_id: index ? coachB : coachA,
    created_at: `2026-09-${18 - order}T09:00:00Z`, award_type: 'player_of_week',
    awarded_for: `${label(child)} recognition ${order + 1}`, note: null,
  }))]))
  server.use(
    http.get(`${url}/auth/v1/user`, () => HttpResponse.json(account)),
    http.get(table('player_parent_links'), ({ request }) => {
      expect(new URL(request.url).searchParams.get('parent_user_id')).toBe(`eq.${parentId}`)
      return HttpResponse.json([{ player_user_id: alex }, { player_user_id: zara }])
    }),
    http.get(table('profiles'), ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer synthetic-parent-token')
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      if (filter === `eq.${parentId}`) return HttpResponse.json({ id: id(9), user_id: parentId, role: 'parent', full_name: 'Synthetic Parent', nationality: null })
      if (filter.includes(alex) || filter.includes(zara)) return HttpResponse.json([{ user_id: alex, full_name: 'Alex' }, { user_id: zara, full_name: 'Zara' }])
      nameFilters.push(filter)
      // PostgreSQL UUID filters cannot parse the literal "null" emitted by
      // this SDK's .in() serializer. Do not let a permissive mock hide it.
      if (filter.includes('null')) return HttpResponse.json({ code: '22P02', message: 'invalid input syntax for type uuid: "null"' }, { status: 400 })
      if (failNames) return HttpResponse.json({ code: '42501', message: 'Synthetic denied name query' }, { status: 403 })
      return HttpResponse.json(hiddenNames ? [] : names.filter(row => filter.includes(row.user_id)))
    }),
    http.get(table('player_details'), () => HttpResponse.json([{ position: 'Midfielder', current_club: 'Synthetic Academy', age_group: 'Adult' }])),
    http.get(table('squad_players'), ({ request }) => HttpResponse.json([{ id: childFrom(request, 'linked_player_id') }])),
    http.get(table('coach_assessments'), ({ request }) => HttpResponse.json(assessments[childFrom(request, 'squad_player_id')])),
    http.get(table('recognition_awards'), ({ request }) => HttpResponse.json(awards[childFrom(request, 'squad_player_id')])),
    http.get(table('matches'), ({ request }) => HttpResponse.json([{ id: id(300), created_at: '2026-09-18T11:00:00Z', match_date: '2026-09-18', opponent: `${label(childFrom(request, 'user_id'))} opposition`,
      competition: 'League', venue: null, computed_rating: 0, team_score: 0, opponent_score: 0 }])),
    http.post(table('rpc/get_parent_match_summary'), async ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer synthetic-parent-token')
      const body = await request.json() as { p_child_id: string }
      expect([alex, zara]).toContain(body.p_child_id)
      return HttpResponse.json([{ total_count: 1, rated_count: 1, average_rating: 0, wins: 0, draws: 1, losses: 0 }])
    }),
    http.post(table('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
  )
})
afterEach(() => { cleanup(); client.clear() })
function mount() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/parent/home']}><AuthProvider>
    <ParentChildrenProvider><Routes>
      <Route path="/parent/home" element={<RouteGuard allowedRole="parent"><ParentHome /></RouteGuard>} />
      <Route path="/parent/alerts" element={<RouteGuard allowedRole="parent"><ParentAlerts /></RouteGuard>} />
    </Routes></ParentChildrenProvider>
  </AuthProvider></MemoryRouter></QueryClientProvider>)
}
function expectPreserved(child: string) {
  const cached = client.getQueryData<ParentDevelopment>(['parent', parentId, child, 'development'])!
  expect(cached.assessments).toEqual(assessments[child])
  expect(cached.awards).toEqual(awards[child])
}

describe('parent retained coach history through the real AuthProvider and SDK', () => {
  it.each(['mixed', 'all-null'] as const)('preserves %s assessment and award authors on Home and Alerts', async mode => {
    for (const rows of [assessments[alex], awards[alex]]) {
      rows[0].coach_user_id = null
      if (mode === 'all-null') rows[1].coach_user_id = null
    }
    mount()
    await screen.findByText('Alex opposition')
    expect(within(screen.getByRole('region', { name: 'Latest coach assessment' })).getByText('Coach')).toBeInTheDocument()
    expect(screen.getByText('Alex recognition 1')).toBeInTheDocument()
    expectPreserved(alex)
    expect(nameFilters).toEqual(mode === 'all-null' ? [] : [`in.(${coachA})`])
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }))
    await screen.findByText('vs Alex opposition · 0–0')
    expect(screen.getAllByText('New coach assessment')).toHaveLength(2)
    expect(screen.getAllByText('Player Of Week')).toHaveLength(2)
    expect(screen.getByText('Alex recognition 1 · by Coach')).toBeInTheDocument()
    expect(screen.getByText(`Alex recognition 2 · by ${mode === 'all-null' ? 'Coach' : 'Synthetic Alex Coach'}`)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectPreserved(alex)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: zara } })
    await screen.findByText('vs Zara opposition · 0–0')
    expect(screen.queryByText(/Alex recognition/)).not.toBeInTheDocument()
    expectPreserved(zara)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: alex } })
    await screen.findByText('vs Alex opposition · 0–0')
    expect(screen.getAllByText('New coach assessment')).toHaveLength(2)
    expect(screen.queryByText(/Zara recognition/)).not.toBeInTheDocument()
    expectPreserved(alex)
  })

  it.each([false, true])('retains live-coach records when names are hidden by RLS: %s', async hidden => {
    hiddenNames = hidden
    mount(); await screen.findByText('Alex opposition')
    expect(within(screen.getByRole('region', { name: 'Latest coach assessment' })).getByText(hidden ? 'Coach' : 'Synthetic Alex Coach')).toBeInTheDocument()
    expect(nameFilters).toEqual([`in.(${coachA})`])
    expectPreserved(alex)
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }))
    await screen.findByText(`Alex recognition 1 · by ${hidden ? 'Coach' : 'Synthetic Alex Coach'}`)
    expect(screen.getAllByText('New coach assessment')).toHaveLength(2)
  })

  it('keeps genuine name-query errors visible and recovers on retry without discarding history', async () => {
    failNames = true
    mount(); await screen.findByRole('alert')
    expect(screen.queryByText('No coach assessments yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    failNames = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Alex opposition')
    expectPreserved(alex)
    expect(nameFilters).toEqual([`in.(${coachA})`, `in.(${coachA})`])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not apply a late Alex coach-name response after switching to Zara', async () => {
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    let started = false
    server.use(http.get(table('profiles'), async ({ request }) => {
      if (new URL(request.url).searchParams.get('user_id') !== `in.(${coachA})`) return
      started = true; await delayed
      return HttpResponse.json([{ user_id: coachA, full_name: 'Late Alex Coach' }])
    }))
    mount()
    await waitFor(() => expect(started).toBe(true))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: zara } })
    await screen.findByText('Zara opposition')
    expect(screen.getByText('Synthetic Zara Coach')).toBeInTheDocument()
    await act(async () => { release(); await delayed; await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByText('Late Alex Coach')).not.toBeInTheDocument()
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue(zara)
    expectPreserved(zara)
  })
})
