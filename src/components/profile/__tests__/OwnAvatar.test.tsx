import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../tests/msw/server'
import { supabase } from '@/integrations/supabase/client'
import { OwnAvatar } from '../OwnAvatar'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'a' } }) }))
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
const user = { id: 'a', email: 'a@synthetic.test.invalid', aud: 'authenticated', app_metadata: {}, user_metadata: {},
  created_at: '2026-09-20T00:00:00Z', email_confirmed_at: '2026-09-20T00:00:00Z' }
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function captureDeadlines() {
  const callbacks: { expire: () => void; handle: ReturnType<typeof setTimeout> }[] = []
  const original = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => {
    const handle = original(handler, delay, ...args)
    if (delay === 20_000 && typeof handler === 'function') callbacks.push({ expire: () => handler(...args), handle })
    return handle
  })
  return callbacks
}
const mount = () => render(<OwnAvatar reference="avatars/a?v=1" fallback={<span>A</span>} />)
beforeEach(async () => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-private-photo')
  URL.revokeObjectURL = vi.fn()
  await supabase.auth.initialize()
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user, access_token: 'token-a', refresh_token: 'refresh-a',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 }))
  server.use(
    http.get(`${url}/auth/v1/user`, () => HttpResponse.json(user)),
    http.get(`${url}/storage/v1/object/avatars/a`, () => new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })),
  )
})
afterEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks()
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else delete (URL as Partial<typeof URL>).createObjectURL
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else delete (URL as Partial<typeof URL>).revokeObjectURL
})

describe('private photo request deadline', () => {
  it.each(['verification', 'download'] as const)('aborts a stalled %s, permits retry and ignores the expired attempt', async phase => {
    const held = deferred(); let started = false; let aborted = false; let fail = true
    const path = phase === 'verification' ? '/auth/v1/user' : '/storage/v1/object/avatars/a'
    server.use(http.get(`${url}${path}`, async ({ request }) => {
      if (fail) { started = true; request.signal.addEventListener('abort', () => { aborted = true }); await held.promise }
      return phase === 'verification' ? HttpResponse.json(user)
        : new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })
    }))
    const deadlines = captureDeadlines()
    mount()
    try {
      await waitFor(() => expect(started).toBe(true))
      expect(deadlines).toHaveLength(1)
      await act(async () => deadlines[0].expire())
      const retry = await screen.findByRole('button', { name: 'Retry profile photo' })
      expect(aborted).toBe(true)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      fail = false; fireEvent.click(retry)
      await screen.findByRole('img', { name: 'Profile' })
      await act(async () => { held.resolve(); deadlines[0].expire() })
      expect(screen.queryByRole('button', { name: 'Retry profile photo' })).not.toBeInTheDocument()
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    } finally { held.resolve() }
  })

  it('bounds a response body that never completes and ignores its eventual bytes', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>; let requestSignal: AbortSignal | undefined
    server.use(http.get(`${url}/storage/v1/object/avatars/a`, ({ request }) => {
      requestSignal = request.signal
      return new HttpResponse(new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new Uint8Array([1])) } }),
        { headers: { 'Content-Type': 'image/png' } })
    }))
    const deadlines = captureDeadlines(); mount()
    try {
      await waitFor(() => expect(requestSignal).toBeDefined())
      expect(deadlines).toHaveLength(1)
      await act(async () => deadlines[0].expire())
      await screen.findByRole('button', { name: 'Retry profile photo' })
      expect(requestSignal?.aborted).toBe(true)
      await act(async () => stream.close())
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    } finally { try { stream?.close() } catch { /* Already closed by the check or abort. */ } }
  })

  it('clears the request deadline after successful download', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const deadlines = captureDeadlines(); mount()
    await screen.findByRole('img', { name: 'Profile' })
    expect(deadlines).toHaveLength(1)
    expect(clear).toHaveBeenCalledWith(deadlines[0].handle)
    await act(async () => deadlines[0].expire())
    expect(screen.queryByRole('button', { name: 'Retry profile photo' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Profile' })).toBeVisible()
  })

  it('clears the deadline and aborts a pending read on unmount', async () => {
    const held = deferred(); let started = false; let aborted = false
    server.use(http.get(`${url}/storage/v1/object/avatars/a`, async ({ request }) => {
      started = true; request.signal.addEventListener('abort', () => { aborted = true }); await held.promise
      return new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })
    }))
    const clear = vi.spyOn(globalThis, 'clearTimeout'); const deadlines = captureDeadlines(); const view = mount()
    try {
      await waitFor(() => expect(started).toBe(true)); expect(deadlines).toHaveLength(1)
      view.unmount(); expect(aborted).toBe(true); expect(clear).toHaveBeenCalledWith(deadlines[0].handle)
      await act(async () => { deadlines[0].expire(); held.resolve() })
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    } finally { held.resolve() }
  })
})
