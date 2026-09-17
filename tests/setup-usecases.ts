import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { server } from './msw/server'
import { resetAuthUsers } from './msw/auth-sessions'

// onUnhandledRequest: 'error' is deliberate. A Supabase call this suite does
// not model should fail loudly rather than silently reach the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  localStorage.clear()
  resetAuthUsers()
})
