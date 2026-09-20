import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { Session, User } from '@supabase/supabase-js'
import { server } from '../../../tests/msw/server'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'
import Settings from '../Settings'

const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: messages.success, error: messages.error, warning: vi.fn() } }))
vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn() }))
vi.mock('@/components/parent/ParentConnections', () => ({ ParentConnections: () => <p>Family connection boundary</p> }))
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('https://test.supabase.co', 'test-anon-key', {
      auth: { storage: localStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_ANON_KEY: 'test-anon-key',
  }
})

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const url = 'https://test.supabase.co'
const user = (id: string): User => ({ id, email: `${id}@synthetic.test.invalid`, aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-18T00:00:00Z', email_confirmed_at: '2026-09-18T00:00:00Z' })
const session = (id: string, token = `token-${id}`): Session => ({ user: user(id), access_token: token, refresh_token: `refresh-${id}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 })
interface Profile { id: string; user_id: string; role: 'parent' | 'coach' | 'player' | 'club'; full_name: string; nationality: null; avatar_url: string | null }
let profiles: Record<string, Profile>
let client: QueryClient
let requests: { method: string; path: string; authorization: string | null; body?: unknown }[]
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
const rowResponse = (request: Request, row: Record<string, unknown> | null) => request.headers.get('Accept')?.includes('vnd.pgrst.object')
  ? row ? HttpResponse.json(row) : HttpResponse.json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }, { status: 406 })
  : HttpResponse.json(row ? [row] : [])
function Controls() {
  const auth = useAuth()
  return <><output data-testid="identity">{auth.user?.id ?? '-'}:{auth.profile?.user_id ?? '-'}</output>
    <output data-testid="context-name">{auth.profile?.full_name}</output>
    <button onClick={() => { void auth.signIn('b@synthetic.test.invalid', 'Synthetic-only-Password123!') }}>Sign in B</button>
    <button onClick={() => { void auth.refreshProfile() }}>Refresh profile</button>
  </>
}
beforeEach(async () => {
  vi.clearAllMocks()
  let nextBlob = 0
  URL.createObjectURL = vi.fn(() => `blob:private-avatar-${++nextBlob}`)
  URL.revokeObjectURL = vi.fn()
  await supabase.auth.initialize()
  localStorage.setItem('sb-test-auth-token', JSON.stringify(session('a')))
  profiles = Object.fromEntries(['a', 'b'].map(id => [id, { id: `profile-${id}`, user_id: id, role: 'parent',
    full_name: `Synthetic Parent ${id.toUpperCase()}`, nationality: null, avatar_url: id === 'a' ? 'https://synthetic.invalid/avatar-a.png' : null }]))
  requests = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  server.use(
    http.get(`${url}/storage/v1/object/avatars/:id`, ({ request }) => {
      requests.push({ method: 'GET', path: 'avatar', authorization: request.headers.get('Authorization') })
      return new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
    }),
    http.get(`${url}/auth/v1/user`, ({ request }) => HttpResponse.json(user(request.headers.get('Authorization')?.includes('token-b') ? 'b' : 'a'))),
    http.post(`${url}/auth/v1/token`, () => HttpResponse.json(session('b'))),
    http.post(`${url}/auth/v1/logout`, ({ request }) => {
      requests.push({ method: 'POST', path: 'logout', authorization: request.headers.get('Authorization') })
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${url}/rest/v1/profiles`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      requests.push({ method: 'GET', path: 'profiles', authorization: request.headers.get('Authorization') })
      return rowResponse(request, profiles[id] ? { ...profiles[id] } : null)
    }),
    http.patch(`${url}/rest/v1/profiles`, async ({ request }) => {
      const id = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      const body = await request.json()
      requests.push({ method: 'PATCH', path: 'profiles', authorization: request.headers.get('Authorization'), body })
      Object.assign(profiles[id], body)
      return rowResponse(request, { ...profiles[id] })
    }),
    http.get(`${url}/rest/v1/coach_details`, ({ request }) => rowResponse(request, { current_club: 'Synthetic Academy', team: 'U15', coach_role: 'Head Coach' })),
    http.get(`${url}/rest/v1/player_details`, ({ request }) => rowResponse(request, { position: 'Midfielder', shirt_number: 0 })),
    http.get(`${url}/rest/v1/squad_players`, () => HttpResponse.json([])),
    http.get(`${url}/rest/v1/player_parent_links`, () => HttpResponse.json([])),
  )
})
afterEach(() => {
  cleanup(); client.clear(); vi.restoreAllMocks()
  for (const [key, descriptor] of [['createObjectURL', originalCreateObjectURL], ['revokeObjectURL', originalRevokeObjectURL]] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor)
    else Reflect.deleteProperty(URL, key)
  }
})

function mount() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/settings']}><AuthProvider>
    <Controls /><Routes><Route path="/settings" element={<Settings />} /><Route path="/" element={<h1>Signed out landing</h1>} /></Routes>
  </AuthProvider></MemoryRouter></QueryClientProvider>)
}
async function ready() { await screen.findByRole('button', { name: 'Synthetic Parent A' }) }
async function switchToB() {
  fireEvent.click(screen.getByRole('button', { name: 'Sign in B' }))
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('b:b'))
  await screen.findByRole('button', { name: 'Synthetic Parent B' })
}
const chooseName = (value: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic Parent A' }))
  fireEvent.change(screen.getByDisplayValue('Synthetic Parent A'), { target: { value } })
}

describe('Settings with real AuthProvider, route guard and Supabase SDK', () => {
  it('refreshes the visible/context name only after an acknowledged write', async () => {
    mount(); await ready(); chooseName(' Revised Synthetic A ')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Revised Synthetic A' })
    await waitFor(() => expect(screen.getByTestId('context-name')).toHaveTextContent('Revised Synthetic A'))
    expect(requests.filter(r => r.method === 'PATCH')).toEqual([{ method: 'PATCH', path: 'profiles', authorization: 'Bearer token-a', body: { full_name: 'Revised Synthetic A' } }])
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Name updated'))
  })

  it.each(['error', 'empty'])('keeps a %s name-save draft for a truthful retry', async outcome => {
    let fail = true
    server.use(http.patch(`${url}/rest/v1/profiles`, async ({ request }) => {
      if (fail) return outcome === 'error' ? HttpResponse.json({ message: 'offline' }, { status: 503 }) : rowResponse(request, null)
      Object.assign(profiles.a, await request.json())
      return rowResponse(request, { ...profiles.a })
    }))
    mount(); await ready(); chooseName('Retry Synthetic A')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith('Could not save name'))
    expect(screen.getByDisplayValue('Retry Synthetic A')).toBeInTheDocument()
    expect(messages.success).not.toHaveBeenCalled()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Retry Synthetic A' })
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Name updated'))
  })

  it('clears A photo and draft on a real SDK A-to-B transition, and clears same-account null avatars', async () => {
    mount(); await ready(); await waitFor(() => expect(screen.getByAltText('Profile').getAttribute('src')).toMatch(/^blob:/))
    profiles.a.avatar_url = null
    fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }))
    await waitFor(() => expect(screen.queryByAltText('Profile')).not.toBeInTheDocument())
    profiles.a.avatar_url = 'https://synthetic.invalid/avatar-a.png'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }))
    await screen.findByAltText('Profile')
    chooseName('Unsubmitted A draft')
    await switchToB()
    expect(screen.queryByAltText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Unsubmitted A draft')).not.toBeInTheDocument()
    expect(screen.getByText('b@synthetic.test.invalid')).toBeInTheDocument()
  })

  it('preserves name and coach drafts on a real same-user TOKEN_REFRESHED event', async () => {
    profiles.a.role = 'coach'
    let loads = 0
    server.use(http.get(`${url}/rest/v1/coach_details`, ({ request }) => { loads++; return rowResponse(request, { current_club: 'Synthetic Academy', team: 'U15', coach_role: 'Head Coach' }) }),
      http.post(`${url}/auth/v1/token`, () => HttpResponse.json(session('a', 'token-a-refreshed'))))
    mount(); await ready(); await screen.findByDisplayValue('Synthetic Academy')
    chooseName('Unsubmitted A name')
    fireEvent.change(screen.getByPlaceholderText('Club name'), { target: { value: 'Unsubmitted A academy' } })
    await act(async () => { const { error } = await supabase.auth.refreshSession(); expect(error).toBeNull() })
    expect(screen.getByDisplayValue('Unsubmitted A name')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Unsubmitted A academy')).toBeInTheDocument()
    expect(loads).toBe(1)
  })

  it('does not apply a delayed A role read to B and exposes mounted read failure with retry', async () => {
    profiles.a.role = 'coach'; profiles.b.role = 'coach'
    const held = deferred(); let started = false; let failB = true
    server.use(http.get(`${url}/rest/v1/coach_details`, async ({ request }) => {
      if (request.headers.get('Authorization') === 'Bearer token-a') { started = true; await held.promise; return rowResponse(request, { current_club: 'Late A academy' }) }
      return failB ? HttpResponse.json({ message: 'unavailable' }, { status: 403 }) : rowResponse(request, { current_club: 'B academy' })
    }))
    mount(); await ready(); await waitFor(() => expect(started).toBe(true))
    await switchToB(); await screen.findByRole('alert')
    await act(async () => { held.resolve(); await held.promise; await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByDisplayValue('Late A academy')).not.toBeInTheDocument()
    failB = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByDisplayValue('B academy')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('supports plural guardians/coaches without blocking the player profile or losing zero shirt numbers', async () => {
    profiles.a.role = 'player'
    const writes: unknown[] = []
    server.use(
      http.get(`${url}/rest/v1/player_parent_links`, () => HttpResponse.json([{ parent_user_id: 'guardian-1' }, { parent_user_id: 'guardian-2' }])),
      http.get(`${url}/rest/v1/squad_players`, () => HttpResponse.json([{ coach_user_id: 'coach-1' }, { coach_user_id: 'coach-2' }])),
      http.get(`${url}/rest/v1/profiles`, ({ request }) => {
        if (new URL(request.url).searchParams.get('user_id')?.startsWith('in.')) {
          return HttpResponse.json([{ user_id: 'guardian-1', full_name: 'Synthetic Guardian One' }, { user_id: 'guardian-2', full_name: 'Synthetic Guardian Two' }, { user_id: 'coach-1', full_name: 'Synthetic Coach One' }])
        }
        return rowResponse(request, { ...profiles.a })
      }),
      http.post(`${url}/rest/v1/player_details`, async ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer token-a')
        writes.push(await request.json()); return rowResponse(request, { user_id: 'a' })
      }),
    )
    mount(); await ready(); await screen.findByDisplayValue('0')
    await screen.findByText('Synthetic Guardian One, Synthetic Guardian Two')
    expect(screen.getByText('Synthetic Coach One, Linked coach')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Profile updated'))
    expect(writes).toEqual([{ user_id: 'a', position: 'Midfielder', shirt_number: 0 }])
  })

  it('shows only active coaches while retained departed roster history remains readable', async () => {
    profiles.a.role = 'player'
    const roster = [
      { linked_player_id: 'a', coach_user_id: 'active-coach', status: 'active' },
      { linked_player_id: 'a', coach_user_id: 'former-coach', status: 'coach_departed' },
      { linked_player_id: 'a', coach_user_id: 'archived-coach', status: 'archived' },
      { linked_player_id: 'a', coach_user_id: 'released-coach', status: 'released' },
    ]
    const selectedStatuses: (string | null)[] = []
    const names: Record<string, string> = {
      'active-coach': 'Synthetic Current Coach', 'former-coach': 'Synthetic Former Coach',
      'archived-coach': 'Synthetic Archived Coach', 'released-coach': 'Synthetic Released Coach',
    }
    server.use(
      http.get(`${url}/rest/v1/squad_players`, ({ request }) => {
        const params = new URL(request.url).searchParams
        expect(request.headers.get('Authorization')).toBe('Bearer token-a')
        expect(params.get('linked_player_id')).toBe('eq.a')
        const status = params.get('status'); selectedStatuses.push(status)
        return HttpResponse.json(roster.filter(row => !status || `eq.${row.status}` === status)
          .map(({ coach_user_id }) => ({ coach_user_id })))
      }),
      http.get(`${url}/rest/v1/profiles`, ({ request }) => {
        const filter = new URL(request.url).searchParams.get('user_id')
        if (filter?.startsWith('in.')) {
          const selected = filter.slice(4, -1).split(',')
          return HttpResponse.json(selected.map(id => ({ user_id: id, full_name: names[id] })))
        }
        return rowResponse(request, { ...profiles.a })
      }),
    )
    mount(); await ready(); await screen.findByText(/Synthetic Current Coach/)
    expect(selectedStatuses).toEqual(['eq.active'])
    expect(screen.queryByText(/Synthetic (Former|Archived|Released) Coach/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(roster).toHaveLength(4)
  })

  it('keeps player edits independent of connection failure and retries connections without resetting a draft', async () => {
    profiles.a.role = 'player'; let fail = true
    server.use(http.get(`${url}/rest/v1/player_parent_links`, () => fail
      ? HttpResponse.json({ message: 'unavailable' }, { status: 403 }) : HttpResponse.json([])))
    mount(); await ready(); const shirt = await screen.findByDisplayValue('0')
    await screen.findByRole('button', { name: 'Retry connections' })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    fireEvent.change(shirt, { target: { value: '9' } })
    fail = false; fireEvent.click(screen.getByRole('button', { name: 'Retry connections' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry connections' })).not.toBeInTheDocument())
    expect(screen.getByDisplayValue('9')).toBeInTheDocument()
  })

  it.each(['coach', 'player'] as const)('does not report a %s profile saved without a returned row, and allows retry', async role => {
    profiles.a.role = role; let empty = true
    server.use(http.post(`${url}/rest/v1/${role}_details`, ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer token-a')
      return rowResponse(request, empty ? null : { user_id: 'a' })
    }))
    mount(); await ready()
    await screen.findByDisplayValue(role === 'coach' ? 'Synthetic Academy' : '0')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith('Could not save profile'))
    expect(messages.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    empty = false; fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Profile updated'))
  })

  it('does not apply an A name response or success toast after B takes over', async () => {
    const held = deferred(); let started = false
    server.use(http.patch(`${url}/rest/v1/profiles`, async ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer token-a'); started = true
      await held.promise; return rowResponse(request, { ...profiles.a, full_name: 'Late A name' })
    }))
    mount(); await ready(); chooseName('Late A name'); fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(started).toBe(true)); await switchToB()
    await act(async () => { held.resolve(); await held.promise; await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.getByRole('button', { name: 'Synthetic Parent B' })).toBeInTheDocument()
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.error).not.toHaveBeenCalled()
  })

  it('binds upload to A and does not start its profile write after B signs in', async () => {
    const held = deferred(); let started = false
    server.use(http.post(`${url}/storage/v1/object/avatars/a`, async ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer token-a'); started = true
      await held.promise; return HttpResponse.json({ Key: 'avatars/a' })
    }))
    const { container } = mount(); await ready()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] } })
    await waitFor(() => expect(started).toBe(true)); await switchToB()
    await act(async () => { held.resolve(); await held.promise; await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(requests.filter(r => r.method === 'PATCH')).toEqual([])
    expect(screen.queryByAltText('Profile')).not.toBeInTheDocument()
    expect(messages.success).not.toHaveBeenCalled(); expect(messages.error).not.toHaveBeenCalled()
  })

  it('binds deletion to A, prevents repeat clicks, and never logs B out on late A completion', async () => {
    const held = deferred(); const deletes: string[] = []
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    server.use(http.post(`${url}/rest/v1/rpc/delete_my_account`, async ({ request }) => {
      deletes.push(request.headers.get('Authorization')!); await held.promise; return HttpResponse.json(null)
    }))
    mount(); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(deletes).toEqual(['Bearer token-a'])); await switchToB()
    await act(async () => { held.resolve(); await held.promise; await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(requests.filter(r => r.path === 'logout')).toEqual([])
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe('b')
    expect(screen.getByRole('button', { name: 'Synthetic Parent B' })).toBeInTheDocument()
    expect(messages.error).not.toHaveBeenCalled()
  })

  it('signs out the deleted current account after a successful same-account response', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    server.use(http.post(`${url}/rest/v1/rpc/delete_my_account`, ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer token-a'); return HttpResponse.json(null)
    }))
    mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await screen.findByRole('heading', { name: 'Signed out landing' })
    expect(requests.filter(r => r.path === 'logout')).toEqual([{ method: 'POST', path: 'logout', authorization: 'Bearer token-a' }])
  })

  it('keeps Settings and the session on a failed SDK sign-out, then signs out on retry', async () => {
    let fail = true
    server.use(http.post(`${url}/auth/v1/logout`, () => fail
      ? HttpResponse.json({ message: 'offline' }, { status: 500 }) : new HttpResponse(null, { status: 204 })))
    mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(messages.error).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Synthetic Parent A' })).toBeInTheDocument()
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe('a')
    fail = false; fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Signed out landing' })
    expect((await supabase.auth.getSession()).data.session).toBeNull()
  })

  it('hides Settings while Auth/profile is unavailable and redirects signed-out visitors', async () => {
    localStorage.removeItem('sb-test-auth-token')
    mount()
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Signed out landing' })
  })

  it('uses the existing missing-profile retry boundary instead of rendering Settings', async () => {
    const original = profiles.a
    delete profiles.a
    mount(); await screen.findByRole('button', { name: 'Retry setup' })
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument()
    profiles.a = original
    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }))
    await ready()
  })
})


describe('Settings reset email retains its account boundary', () => {
  it('requests the Auth-verified email and describes an acknowledgement truthfully', async () => {
    const emails: string[] = []
    mount(); await ready()
    server.use(http.get(`${url}/auth/v1/user`, () => HttpResponse.json({ ...user('a'), email: 'verified@family.test' })),
      http.post(`${url}/auth/v1/recover`, async ({ request }) => { emails.push((await request.json() as { email: string }).email); return HttpResponse.json({}) }))
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Password reset request' })).toHaveTextContent('If this email is registered'))
    expect(emails).toEqual(['verified@family.test']); expect(messages.success).not.toHaveBeenCalled()
  })
  it('does not send for A after switching to B during verification', async () => {
    const held = deferred(); let started = false; const emails: string[] = []
    mount(); await ready()
    server.use(http.get(`${url}/auth/v1/user`, async ({ request }) => {
      if (request.headers.get('Authorization') === 'Bearer token-a') { started = true; await held.promise; return HttpResponse.json(user('a')) }
      return HttpResponse.json(user('b'))
    }), http.post(`${url}/auth/v1/recover`, async ({ request }) => { emails.push((await request.json() as { email: string }).email); return HttpResponse.json({}) }))
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Send reset email' })); await waitFor(() => expect(started).toBe(true))
      await switchToB(); await act(async () => held.resolve()); expect(emails).toEqual([])
      expect(screen.getByRole('button', { name: 'Send reset email' })).toBeEnabled(); expect(messages.error).not.toHaveBeenCalled()
    } finally { held.resolve() }
  })
  it('bounds verification itself so a stalled Auth lookup does not lock every Settings action', async () => {
    const held = deferred(); let started = false; let aborted = false; let expire: (() => void) | undefined
    mount(); await ready()
    const timer = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, milliseconds, ...args) => {
      if (milliseconds === 20_000 && typeof handler === 'function') expire = () => handler(...args)
      return timer(handler, milliseconds, ...args)
    })
    const recover = vi.fn(() => HttpResponse.json({}))
    server.use(http.get(`${url}/auth/v1/user`, async ({ request }) => { started = true; request.signal.addEventListener('abort', () => { aborted = true; held.resolve() }); await held.promise; return HttpResponse.json(user('a')) }), http.post(`${url}/auth/v1/recover`, recover))
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Send reset email' })); await waitFor(() => expect(started).toBe(true)); expect(expire).toBeTypeOf('function')
      await act(async () => expire!()); expect(await screen.findByRole('alert')).toHaveTextContent('check your account'); expect(aborted).toBe(true)
      expect(screen.getByRole('button', { name: 'Send reset email' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Synthetic Parent A' })).toBeEnabled()
      await act(async () => held.resolve()); expect(recover).not.toHaveBeenCalled()
    } finally { held.resolve() }
  })
})

describe('private avatar regressions', () => {
  it.each(['parent', 'player', 'coach', 'club'] as const)('downloads the %s photo with its own token instead of rendering a public URL', async role => {
    profiles.a.role = role;
    mount(); await ready();
    await waitFor(() => expect(screen.getByAltText('Profile').getAttribute('src')).toMatch(/^blob:/));
    expect(requests.filter(r => r.path === 'avatar')).toEqual([{ method: 'GET', path: 'avatar', authorization: 'Bearer token-a' }]);
  });
  it('shows retry on a denied private read and recovers without hiding the failure as an empty avatar', async () => {
    let fail = true;
    server.use(http.get(`${url}/storage/v1/object/avatars/a`, () => fail
      ? HttpResponse.json({ message: 'denied' }, { status: 403 })
      : new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })));
    mount(); await ready();
    await screen.findByRole('button', { name: 'Retry profile photo' });
    expect(screen.queryByAltText('Profile')).not.toBeInTheDocument();
    fail = false; fireEvent.click(screen.getByRole('button', { name: 'Retry profile photo' }));
    await waitFor(() => expect(screen.getByAltText('Profile').getAttribute('src')).toMatch(/^blob:/));
  });
  it('ignores a delayed A image after switching to B and releases visible blob URLs', async () => {
    const held = deferred(); let started = false;
    server.use(http.get(`${url}/storage/v1/object/avatars/a`, async () => { started = true; await held.promise;
      return new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }); }));
    mount(); await ready(); await waitFor(() => expect(started).toBe(true));
    await switchToB(); await act(async () => { held.resolve(); await held.promise; });
    expect(screen.queryByAltText('Profile')).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('does not persist a public or signed URL after an acknowledged upload', async () => {
    server.use(http.post(`${url}/storage/v1/object/avatars/a`, () => HttpResponse.json({ Key: 'avatars/a' })));
    const { container } = mount(); await ready();
    await screen.findByAltText('Profile');
    const original = screen.getByAltText('Profile').getAttribute('src');
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(messages.success).toHaveBeenCalledWith('Profile photo updated'));
    expect(profiles.a.avatar_url).toMatch(/^avatars\/a\?v=\d+$/);
    await waitFor(() => expect(screen.getByAltText('Profile').getAttribute('src')).not.toBe(original));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(original);
  });
});


describe('private photo content and lifecycle', () => {
  it.each([
    ['empty', new Uint8Array(), 'image/png'],
    ['oversized', new Uint8Array(5 * 1024 * 1024 + 1), 'image/png'],
    ['unsupported', new Uint8Array([1]), 'image/svg+xml'],
  ] as const)('rejects %s downloads before displaying them', async (_label, bytes, mime) => {
    server.use(http.get(`${url}/storage/v1/object/avatars/a`, () =>
      new HttpResponse(bytes, { headers: { 'Content-Type': mime } })))
    mount(); await ready()
    await screen.findByRole('button', { name: 'Retry profile photo' })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByAltText('Profile')).not.toBeInTheDocument()
  })
  it('recovers from an image decode error and releases blobs on retry and unmount', async () => {
    const view = mount(); await ready()
    const first = await screen.findByAltText('Profile')
    const firstUrl = first.getAttribute('src')
    fireEvent.error(first)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry profile photo' }))
    const second = await screen.findByAltText('Profile')
    expect(second.getAttribute('src')).not.toBe(firstUrl)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl)
    const secondUrl = second.getAttribute('src')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(secondUrl)
  })
  it.each([
    ['unsupported', new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }), 'Choose a JPEG, PNG, WebP or GIF image'],
    ['empty', new File([], 'photo.png', { type: 'image/png' }), 'Choose a non-empty image'],
    ['oversized', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' }), 'Image must be under 5 MB'],
  ] as const)('rejects %s uploads before any storage write', async (_label, file, message) => {
    const uploads = vi.fn(() => HttpResponse.json({ Key: 'avatars/a' }))
    server.use(http.post(`${url}/storage/v1/object/avatars/a`, uploads))
    const { container } = mount(); await ready()
    const input = container.querySelector('input[type="file"]')!
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith(message))
    expect(uploads).not.toHaveBeenCalled()
    expect(requests.filter(r => r.method === 'PATCH')).toEqual([])
  })
})
