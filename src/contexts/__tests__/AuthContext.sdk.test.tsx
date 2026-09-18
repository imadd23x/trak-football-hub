import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { server } from '../../../tests/msw/server'
import { AuthProvider, useAuth } from '../AuthContext'
import { supabase } from '@/integrations/supabase/client'

const observations = vi.hoisted(() => ({ logout: vi.fn(), login: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn() }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: observations.error } }))
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    // Keep the real SDK's persistent session, lock and auth-event behavior.
    supabase: createClient('https://test.supabase.co', 'test-anon-key', {
      auth: { storage: localStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1',
    SUPABASE_ANON_KEY: 'test-anon-key',
  }
})

const url = 'https://test.supabase.co'
const user = (id: string): User => ({
  id, email: `${id}@example.test`, aud: 'authenticated', app_metadata: {}, user_metadata: {},
  created_at: '2026-09-18T00:00:00Z',
})
const session = (id: string): Session => ({
  user: user(id), access_token: `token-${id}`, refresh_token: `refresh-${id}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function Controls() {
  const { user: account, profile, signIn, signUp, signOut } = useAuth()
  return <>
    <output data-testid="identity">{account?.id ?? '-'}:{profile?.user_id ?? '-'}</output>
    <button onClick={async () => observations.logout(await signOut())}>Sign out</button>
    <button onClick={async () => observations.login(await signIn('b@example.test', 'password-b'))}>Sign in B</button>
    <button onClick={async () => {
      const { error } = await signUp('b@example.test', 'password-b')
      observations.login({ error })
    }}>Create B</button>
  </>
}
let queryClient: QueryClient
let replace: ReturnType<typeof vi.fn>
const subscriptions: { unsubscribe: () => void }[] = []
beforeEach(async () => {
  vi.clearAllMocks()
  await supabase.auth.initialize()
  localStorage.setItem('sb-test-auth-token', JSON.stringify(session('a')))
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  replace = vi.fn()
  vi.stubGlobal('location', { origin: 'http://localhost', pathname: '/parent-invite', search: '?token=invite-a', replace })
  server.use(
    http.get(`${url}/auth/v1/user`, ({ request }) => HttpResponse.json(user(request.headers.get('Authorization') === 'Bearer token-b' ? 'b' : 'a'))),
    http.get(`${url}/rest/v1/profiles`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('user_id')?.slice(3)
      return HttpResponse.json({ id: `profile-${id}`, user_id: id, role: 'parent', full_name: id, nationality: null })
    }),
  )
})
afterEach(() => {
  cleanup()
  subscriptions.splice(0).forEach(subscription => subscription.unsubscribe())
  queryClient.clear()
  vi.unstubAllGlobals()
})
async function mount() {
  render(<QueryClientProvider client={queryClient}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('a:a'))
}

describe('auth transitions with the real persistent Supabase SDK', () => {
  it.each(['Sign in B', 'Create B'])('finishes A logout before %s and leaves the invitation route intact', async action => {
    const logoutResponse = deferred<void>()
    const requests: string[] = []
    const events: AuthChangeEvent[] = []
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => { events.push(event) })
    subscriptions.push(subscription)
    server.use(
      http.post(`${url}/auth/v1/logout`, async ({ request }) => {
        requests.push(`logout:${request.headers.get('Authorization')}`)
        await logoutResponse.promise
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${url}/auth/v1/token`, () => { requests.push('login:b'); return HttpResponse.json(session('b')) }),
      http.post(`${url}/auth/v1/signup`, () => { requests.push('signup:b'); return HttpResponse.json(session('b')) }),
    )
    await mount()
    queryClient.setQueryData(['private-a'], { owner: 'a' })
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(requests).toContain('logout:Bearer token-a'))
    fireEvent.click(screen.getByText(action))
    // Allow a non-serialized password request to reach MSW before releasing logout.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    const requestsWhileLogoutPending = [...requests]
    await act(async () => { logoutResponse.resolve(); await logoutResponse.promise })
    await waitFor(() => expect(observations.logout).toHaveBeenCalledWith({ error: null }))
    await waitFor(() => expect(observations.login).toHaveBeenCalledWith({ error: null }))
    expect(requestsWhileLogoutPending).toEqual(['logout:Bearer token-a'])
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('b:b'))
    expect(JSON.parse(localStorage.getItem('sb-test-auth-token')!).user.id).toBe('b')
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe('b')
    expect(events.filter(event => event === 'SIGNED_OUT' || event === 'SIGNED_IN')).toEqual(['SIGNED_OUT', 'SIGNED_IN'])
    expect(queryClient.getQueryData(['private-a'])).toBeUndefined()
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/parent-invite')
    expect(window.location.search).toBe('?token=invite-a')
  })

  it('keeps A on logout failure, then allows a logout retry followed by queued B sign-in', async () => {
    let logoutAttempts = 0
    server.use(
      http.post(`${url}/auth/v1/logout`, () => ++logoutAttempts === 1
        ? HttpResponse.json({ message: 'logout unavailable' }, { status: 500 })
        : new HttpResponse(null, { status: 204 })),
      http.post(`${url}/auth/v1/token`, () => HttpResponse.json(session('b'))),
    )
    await mount()
    queryClient.setQueryData(['private-a'], { owner: 'a' })
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(observations.logout).toHaveBeenCalledWith({ error: expect.any(Error) }))
    expect(screen.getByTestId('identity')).toHaveTextContent('a:a')
    expect(JSON.parse(localStorage.getItem('sb-test-auth-token')!).user.id).toBe('a')
    expect(queryClient.getQueryData(['private-a'])).toEqual({ owner: 'a' })
    fireEvent.click(screen.getByText('Sign out'))
    fireEvent.click(screen.getByText('Sign in B'))
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('b:b'))
    expect(JSON.parse(localStorage.getItem('sb-test-auth-token')!).user.id).toBe('b')
    expect(queryClient.getQueryData(['private-a'])).toBeUndefined()
    expect(replace).not.toHaveBeenCalled()
  })
})
