import { afterEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../msw/server'
import { signInAs } from './session'
import { supabase } from '@/integrations/supabase/client'

afterEach(() => vi.useRealTimers())

// A test that fakes the clock signs in on that clock. Once the real clock is
// back, its session must not look expired: supabase-js would refresh it, the
// harness refuses every refresh, and the failure wipes whatever session is
// stored by then, even the next test's (TRAK-70 flake, 26 Sep).
it('a session seeded on a faked past clock is still valid on the real clock', async () => {
  let refreshes = 0
  server.use(http.post('https://test.supabase.co/auth/v1/token', () => {
    refreshes++
    return HttpResponse.json({ error: 'not_implemented' }, { status: 400 })
  }))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T09:15:00Z'))
  signInAs({ id: 'clock-check' })
  vi.useRealTimers()

  const { data } = await supabase.auth.getSession()

  expect(refreshes).toBe(0)
  expect(data.session?.user.id).toBe('clock-check')
})
