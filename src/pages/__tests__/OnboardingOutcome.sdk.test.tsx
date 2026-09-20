import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { server } from '../../../tests/msw/server'
import OnboardingPage from '../OnboardingPage'
import { PASSWORD_HINT } from '@/lib/password'

const observed = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: observed.error, warning: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn() }))
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://test.supabase.co', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1', SUPABASE_ANON_KEY: 'test-anon-key' }
})
const url = 'https://test.supabase.co'
const email = 'existing@example.test'
const account = { id: 'synthetic-user', email, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' }
let client: QueryClient
let requests: string[]
let payload: Record<string, unknown>
function Identity() { const { user } = useAuth(); return <span data-testid="identity">{user?.id ?? 'signed out'}</span> }
beforeEach(() => {
  vi.clearAllMocks()
  requests = []; payload = {}
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  server.use(http.all(`${url}/*`, ({ request }) => {
    requests.push(new URL(request.url).pathname)
    return HttpResponse.json({ message: 'Unexpected request' }, { status: 400 })
  }))
})
afterEach(() => { cleanup(); client.clear() })
function mount(role: string) {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/onboarding/${role}`]}>
    <AuthProvider><Identity /><Routes><Route path="/onboarding/:role" element={<OnboardingPage />} /></Routes></AuthProvider>
  </MemoryRouter></QueryClientProvider>)
}
function input(placeholder: string, value: string) { fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } }) }
function choose(placeholder: string, value: string) {
  fireEvent.change(screen.getByRole('option', { name: placeholder }).closest('select')!, { target: { value } })
}
function submit(role: string) {
  input('Full name', 'Synthetic Tester'); input('Email', email)
  input(PASSWORD_HINT, 'SyntheticOnly1!'); input('Confirm password', 'SyntheticOnly1!')
  if (role === 'club') {
    input('Academy / club name', 'Synthetic Academy')
    fireEvent.click(screen.getByRole('button', { name: 'Create Administrator Account' })); return
  }
  choose('Select nationality', 'United Arab Emirates')
  if (role === 'player') {
    choose('Day', '1'); choose('Month', 'January'); choose('Year', String(new Date().getFullYear() - 12))
  }
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  if (role === 'player') {
    choose('Select position', 'Goalkeeper'); input('Current club', 'Synthetic Academy'); choose('Select age group', 'U13')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    input("Parent or guardian's email", 'parent@example.test')
  } else {
    input('Current club', 'Synthetic Academy'); choose('Select age group', 'U13'); choose('Select role', 'Head Coach')
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
}
function signup(identities: unknown[]) {
  server.use(http.post(`${url}/auth/v1/signup`, async ({ request }) => {
    requests.push('/auth/v1/signup'); payload = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...account, identities })
  }))
}

describe('signup outcome through the real AuthProvider and Supabase SDK', () => {
  it.each(['player', 'coach', 'club'].flatMap(role => ['new', 'obfuscated'].map(outcome => ({ role, outcome }))))(
    '$role $outcome response does not claim account or invitation creation', async ({ role, outcome }) => {
      signup(outcome === 'new' ? [{ id: 'identity', identity_id: 'identity', user_id: account.id, provider: 'email' }] : [])
      mount(role); submit(role)
      expect(await screen.findByRole('heading', { name: 'Check your email or sign in' })).toBeInTheDocument()
      expect(screen.getByText(/If this email is new to Trak/)).toBeInTheDocument()
      expect(screen.getByText(/already use Trak as a player, parent, coach or administrator/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/')
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument()
      expect(screen.queryByText(/Your account is created|We've asked your parent|We sent a confirmation link/i)).not.toBeInTheDocument()
      expect(screen.getByTestId('identity')).toHaveTextContent('signed out')
      expect(requests).toEqual(['/auth/v1/signup'])
      expect(payload).toMatchObject({ email, data: { trak_onboarding: { role } } })
      if (role === 'player') expect(screen.getByText(/review the invitation status for/)).toHaveTextContent('parent@example.test')
    },
  )

  it('keeps the form and a sign-in action for an explicit duplicate-account error', async () => {
    server.use(http.post(`${url}/auth/v1/signup`, () => HttpResponse.json({ code: 'user_already_exists', msg: 'User already registered' }, { status: 422 })))
    mount('club'); submit('club')
    await waitFor(() => expect(observed.error).toHaveBeenCalledWith('An account with this email already exists. Please sign in instead.'))
    expect(screen.getByPlaceholderText('Email')).toHaveValue(email)
    expect(screen.getByRole('link', { name: 'Sign in to an existing account' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('heading', { name: 'Check your email or sign in' })).not.toBeInTheDocument()
  })

  it('shows a failed resend and retries without asserting delivery', async () => {
    signup([]); let count = 0
    server.use(http.post(`${url}/auth/v1/resend`, async ({ request }) => {
      expect(await request.json()).toMatchObject({ type: 'signup', email })
      return ++count === 1 ? HttpResponse.json({ msg: 'Try again later' }, { status: 429 }) : HttpResponse.json({})
    }))
    mount('club'); submit('club')
    fireEvent.click(await screen.findByRole('button', { name: 'Resend confirmation email' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later')
    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If this account needs confirmation')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Email resent|email resent!/i)).not.toBeInTheDocument()
    expect(count).toBe(2)
  })

  it('requests password recovery for the entered email without changing identity', async () => {
    signup([]); let recovery: unknown
    server.use(http.post(`${url}/auth/v1/recover`, async ({ request }) => {
      recovery = { body: await request.json(), redirect: new URL(request.url).searchParams.get('redirect_to') }
      return HttpResponse.json({})
    }))
    mount('club'); submit('club')
    fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If this email has a Trak account')
    expect(recovery).toMatchObject({ body: { email }, redirect: `${window.location.origin}/reset-password` })
    expect(screen.getByTestId('identity')).toHaveTextContent('signed out')
  })
})
