import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../tests/msw/server'

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: notices }))
const api = 'https://recovery.test.supabase.co'
const storageKey = 'sb-recovery-auth-token'
const idA = '11111111-1111-4111-8111-111111111111'
const idB = '22222222-2222-4222-8222-222222222222'
const user = (id: string): User => ({ id, email: `${id === idA ? 'recovery-a' : 'ordinary-b'}@example.test`,
  aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
  email_confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' })
function session(id: string): Session {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify({ sub: id, exp: expiresAt, role: 'authenticated' })), 'synthetic'].join('.')
  return { user: user(id), access_token: token, refresh_token: `synthetic-refresh-${id}`,
    token_type: 'bearer', expires_in: 3600, expires_at: expiresAt }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
let client: SupabaseClient
let accountA: Session
let accountB: Session
let requests: Array<{ authorization: string | null; password: unknown }>
let releases: Array<() => void>
let disposeRecovery: (() => void) | undefined

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  accountA = session(idA); accountB = session(idB)
  requests = []; releases = []; disposeRecovery = undefined
  window.history.replaceState(null, '', '/reset-password')
  server.use(
    http.get(`${api}/auth/v1/user`, ({ request }) => HttpResponse.json(
      request.headers.get('authorization') === `Bearer ${accountB.access_token}` ? user(idB) : user(idA))),
    http.post(`${api}/auth/v1/token`, () => HttpResponse.json(accountB)),
    http.put(`${api}/auth/v1/user`, async ({ request }) => {
      requests.push({ authorization: request.headers.get('authorization'), password: (await request.json() as { password: unknown }).password })
      return HttpResponse.json(request.headers.get('authorization') === `Bearer ${accountB.access_token}` ? user(idB) : user(idA))
    }),
  )
  vi.stubEnv('VITE_SUPABASE_URL', api)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'synthetic-anon-key')
})
afterEach(async () => {
  releases.forEach(release => release())
  cleanup()
  disposeRecovery?.()
  await client?.auth.stopAutoRefresh()
  window.history.replaceState(null, '', '/')
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
function recoveryUrl() {
  window.history.replaceState(null, '', `/reset-password#${new URLSearchParams({
    access_token: accountA.access_token, refresh_token: accountA.refresh_token,
    token_type: 'bearer', expires_in: '3600', type: 'recovery',
  })}`)
}
async function mount(beforeRender?: () => Promise<void>) {
  const { default: Page } = await import('../ResetPassword')
  const runtime = await import('@/integrations/supabase/client')
  client = runtime.supabase
  disposeRecovery = runtime.passwordRecovery.dispose
  if (beforeRender) await beforeRender()
  render(<MemoryRouter initialEntries={['/reset-password']}><Page /></MemoryRouter>)
}
function fillPassword() {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Synthetic-Reset-9!' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Synthetic-Reset-9!' } })
}

describe('password recovery with the actual Auth SDK and synthetic network', () => {
  it('rejects a bare reset route even when another account is already signed in', async () => {
    localStorage.setItem(storageKey, JSON.stringify(accountB))
    await mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('does not accept a recovery event without this tab’s own callback URL', async () => {
    await mount()
    await client.auth.initialize()
    server.use(http.post(`${api}/auth/v1/verify`, () => HttpResponse.json(accountA)))
    // Public SDK recovery verification emits the same PASSWORD_RECOVERY event
    // that another tab can broadcast; the event alone must not open this form.
    await act(async () => { await client.auth.verifyOtp({ token_hash: 'synthetic-otp', type: 'recovery' }) })
    expect((await client.auth.getSession()).data.session?.user.id).toBe(idA)
    expect(screen.getByRole('alert')).toHaveTextContent('reset link')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('reports an expired/reused URL error without accepting the ordinary session the SDK preserves', async () => {
    localStorage.setItem(storageKey, JSON.stringify(accountB))
    window.history.replaceState(null, '', '/reset-password#error=access_denied&error_code=otp_expired&error_description=Expired')
    await mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect((await client.auth.getSession()).data.session?.user.id).toBe(idB)
    expect(requests).toEqual([])
  })

  it('finishes invalid-token verification with an actionable error instead of spinning forever', async () => {
    recoveryUrl()
    server.use(http.get(`${api}/auth/v1/user`, () => HttpResponse.json({ message: 'Synthetic expired token', code: 'bad_jwt' }, { status: 401 })))
    await mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link')
    expect(screen.queryByText('Verifying your reset link…')).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('retains a valid recovery event emitted before the route mounts and updates that account', async () => {
    recoveryUrl()
    await mount(async () => {
      await client.auth.initialize()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(window.location.hash).toBe('') // the SDK already consumed the URL
    })
    await screen.findByLabelText('New password')
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(notices.success).toHaveBeenCalled())
    expect(requests).toEqual([{ authorization: `Bearer ${accountA.access_token}`, password: 'Synthetic-Reset-9!' }])
  })

  it('removes recovery controls when the active account switches', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    fillPassword()
    await act(async () => { await client.auth.signInWithPassword({ email: user(idB).email!, password: 'Synthetic-Other-9!' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('account changed')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('does not submit when the account changes during server identity validation', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    const updating = vi.spyOn((await import('@/integrations/supabase/client')).passwordRecovery, 'updatePassword')
    const pending = deferred(); releases.push(pending.resolve)
    let checking = false
    server.use(http.get(`${api}/auth/v1/user`, async () => { checking = true; await pending.promise; return HttpResponse.json(user(idA)) }))
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(checking).toBe(true))
    await act(async () => { await client.auth.signInWithPassword({ email: user(idB).email!, password: 'Synthetic-Other-9!' }) })
    await act(async () => { pending.resolve(); await updating.mock.results[0].value })
    expect(await screen.findByRole('alert')).toHaveTextContent('account changed')
    expect(requests).toEqual([])
    expect(notices.success).not.toHaveBeenCalled()
  })

  it('pins an in-flight update to A and ignores its completion after switching to B', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    const updating = vi.spyOn((await import('@/integrations/supabase/client')).passwordRecovery, 'updatePassword')
    const pending = deferred(); releases.push(pending.resolve)
    server.use(http.put(`${api}/auth/v1/user`, async ({ request }) => {
      requests.push({ authorization: request.headers.get('authorization'), password: (await request.json() as { password: unknown }).password })
      await pending.promise
      return HttpResponse.json(user(idA))
    }))
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    await act(async () => { await client.auth.signInWithPassword({ email: user(idB).email!, password: 'Synthetic-Other-9!' }) })
    await act(async () => { pending.resolve(); await updating.mock.results[0].value })
    expect(await screen.findByRole('alert')).toHaveTextContent('previous account’s password may have changed')
    expect(requests).toEqual([{ authorization: `Bearer ${accountA.access_token}`, password: 'Synthetic-Reset-9!' }])
    expect((await client.auth.getSession()).data.session?.user.id).toBe(idB)
    expect(notices.success).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Continue to Trak' })).not.toBeInTheDocument()
  })

  it('clears the form on sign-out and does not reuse the link after an ordinary sign-in', async () => {
    recoveryUrl()
    server.use(http.post(`${api}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })))
    await mount()
    await screen.findByLabelText('New password')
    await act(async () => { await client.auth.signOut() })
    expect(await screen.findByRole('alert')).toHaveTextContent('account changed')
    await act(async () => { await client.auth.signInWithPassword({ email: user(idB).email!, password: 'Synthetic-Other-9!' }) })
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('allows a retry after a failed request without sending duplicate pending updates', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    const pending = deferred(); releases.push(pending.resolve)
    let attempts = 0
    server.use(http.put(`${api}/auth/v1/user`, async ({ request }) => {
      attempts++
      requests.push({ authorization: request.headers.get('authorization'), password: (await request.json() as { password: unknown }).password })
      if (attempts === 1) { await pending.promise; return HttpResponse.json({ message: 'Synthetic temporary failure' }, { status: 503 }) }
      return HttpResponse.json(user(idA))
    }))
    fillPassword()
    const submit = screen.getByRole('button', { name: 'Update password' })
    fireEvent.click(submit)
    await waitFor(() => expect(attempts).toBe(1))
    expect(submit).toBeDisabled()
    fireEvent.submit(submit.closest('form')!) // implicit/native submits must also be guarded
    await act(async () => { pending.resolve() })
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic temporary failure')
    expect(attempts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(notices.success).toHaveBeenCalledTimes(1))
    expect(requests).toHaveLength(2)
    expect(requests.every(request => request.authorization === `Bearer ${accountA.access_token}`)).toBe(true)
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('does not accept a server identity that differs from the recovery account', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    server.use(http.get(`${api}/auth/v1/user`, () => HttpResponse.json(user(idB))))
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link')
    expect(requests).toEqual([])
  })

  it('retries a temporary identity failure without consuming the recovery link or sending early', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    let lookups = 0
    server.use(http.get(`${api}/auth/v1/user`, () => {
      lookups++
      return lookups === 1 ? HttpResponse.json({ message: 'Synthetic temporary outage' }, { status: 503 }) : HttpResponse.json(user(idA))
    }))
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('try again')
    expect(requests).toEqual([])
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(notices.success).toHaveBeenCalledTimes(1))
    expect(lookups).toBe(2)
    expect(requests).toEqual([{ authorization: `Bearer ${accountA.access_token}`, password: 'Synthetic-Reset-9!' }])
  })

  it('invalidates a recovery session rejected by the server during submission', async () => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    server.use(http.get(`${api}/auth/v1/user`, () => HttpResponse.json({ message: 'Synthetic expired JWT', code: 'bad_jwt' }, { status: 401 })))
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('reset link')
    expect(screen.queryByRole('button', { name: 'Update password' })).not.toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it.each([{}, user(idB)])('does not report success for an unverified successful response %j', async body => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    server.use(http.put(`${api}/auth/v1/user`, () => HttpResponse.json(body)))
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed')
    expect(notices.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled()
  })

  it.each(['identity check', 'password request'])('times out a stalled %s and ignores its late completion', async stage => {
    recoveryUrl()
    await mount()
    await screen.findByLabelText('New password')
    // Advance only the application deadline; all SDK/network timing stays real.
    const originalTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) =>
      originalTimeout(callback, delay === 15000 ? 100 : delay, ...args))
    const pending = deferred(); releases.push(pending.resolve)
    if (stage === 'identity check') {
      server.use(http.get(`${api}/auth/v1/user`, async () => { await pending.promise; return HttpResponse.json(user(idA)) }))
    } else {
      server.use(http.put(`${api}/auth/v1/user`, async ({ request }) => {
        requests.push({ authorization: request.headers.get('authorization'), password: (await request.json() as { password: unknown }).password })
        await pending.promise
        return HttpResponse.json(user(idA))
      }))
    }
    const updating = vi.spyOn((await import('@/integrations/supabase/client')).passwordRecovery, 'updatePassword')
    fillPassword()
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('timed out')
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled()
    await act(async () => { pending.resolve(); await updating.mock.results[0].value })
    expect(notices.success).not.toHaveBeenCalled()
    if (stage === 'identity check') expect(requests).toEqual([])
    else expect(requests).toEqual([{ authorization: `Bearer ${accountA.access_token}`, password: 'Synthetic-Reset-9!' }])
  })

  it('offers a finite slow state but still accepts a late valid exchange', async () => {
    const pending = deferred(); releases.push(pending.resolve)
    recoveryUrl()
    server.use(http.get(`${api}/auth/v1/user`, async () => { await pending.promise; return HttpResponse.json(user(idA)) }))
    await mount()
    expect(screen.getByText('Verifying your reset link…')).toBeInTheDocument()
    expect(await screen.findByRole('status', {}, { timeout: 12000 })).toHaveTextContent('taking longer')
    await act(async () => { pending.resolve() })
    await screen.findByLabelText('New password')
    expect(requests).toEqual([])
  }, 15000)
})
