/**
 * TRAK-104 (J3), through the real App, AuthProvider and SDK with MSW behind
 * them: after a guardian resets a child's password, the child's sessions are
 * ended on the server (end_child_login_sessions). An app that is already open
 * on another device keeps a valid access token for up to an hour, so it asks
 * my_session_is_live() every 30 s and on returning to the tab, and signs out
 * the moment the answer is false. "Unknown" or a failed check changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, rpc } from '../../../../tests/msw/supabase'

let sequence = 0
let live: boolean | null | 'fail'
let checks: number
let role: 'player' | 'parent'
let logoutOffline: number

beforeEach(() => {
  const account = `session-watch-${++sequence}`
  live = true
  checks = 0
  role = 'player'
  logoutOffline = 0
  signInAs({ id: account })
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, () =>
      HttpResponse.json([{ id: 'p', user_id: account, role, full_name: 'Kai Synthetic' }])),
    rpc('my_session_is_live', () => {
      checks++
      return live === 'fail' ? { status: 503, body: { message: 'Synthetic unavailable', code: 'XX000', details: null, hint: null } } : live
    }),
    // What Auth answers for a session that was ended on the server.
    http.post(`${SUPABASE_URL}/auth/v1/logout`, () => logoutOffline-- > 0
      ? HttpResponse.error()
      : HttpResponse.json({ code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }, { status: 403 })),
    rpc('my_consent_status', () => ({ required: false, granted: true, invited_parent: null })),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('get_children_awaiting_consent', () => []),
    rpc('get_roster_children_awaiting_consent', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/:table`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/:name`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () => HttpResponse.json(null, { status: 201 })),
  )
})
afterEach(() => { cleanup(); vi.useRealTimers() })

function returnToTab() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
const storedSession = () => localStorage.getItem('sb-test-auth-token')

describe('an open player app after a guardian\'s password reset (TRAK-104)', () => {
  it('signs out when the server says its session is gone', async () => {
    renderApp('/player/home')
    await waitFor(() => expect(checks).toBeGreaterThan(0), { timeout: 4000 })
    expect(storedSession()).not.toBeNull()
    live = false
    returnToTab()
    await waitFor(() => expect(storedSession()).toBeNull(), { timeout: 4000 })
    await waitFor(() => expect(window.location.pathname).not.toMatch(/^\/player/))
  })

  it('checks again every 30 seconds while the app stays open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    renderApp('/player/home')
    await waitFor(() => expect(checks).toBeGreaterThan(0), { timeout: 4000 })
    const before = checks
    live = false
    await act(async () => { vi.advanceTimersByTime(30_000) })
    await waitFor(() => expect(checks).toBeGreaterThan(before))
    await waitFor(() => expect(storedSession()).toBeNull(), { timeout: 4000 })
  })

  it('keeps trying when the sign-out call itself fails, and signs out on the next check', async () => {
    renderApp('/player/home')
    await waitFor(() => expect(checks).toBeGreaterThan(0), { timeout: 4000 })
    live = false
    logoutOffline = 1
    returnToTab()
    await waitFor(() => expect(checks).toBeGreaterThan(1))
    expect(storedSession()).not.toBeNull()
    returnToTab()
    await waitFor(() => expect(storedSession()).toBeNull(), { timeout: 4000 })
  })

  it.each([
    ['an unknown answer (no session id in the token)', null],
    ['a failed check', 'fail'],
  ] as const)('stays signed in on %s', async (_what, answer) => {
    renderApp('/player/home')
    await waitFor(() => expect(checks).toBeGreaterThan(0), { timeout: 4000 })
    live = answer
    const before = checks
    returnToTab()
    await waitFor(() => expect(checks).toBeGreaterThan(before))
    expect(storedSession()).not.toBeNull()
  })

  it('CONTROL a guardian\'s app does not run the player check', async () => {
    role = 'parent'
    renderApp('/parent/home')
    expect(await screen.findByRole('heading', { name: 'Home' }, { timeout: 4000 })).toBeInTheDocument()
    returnToTab()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(checks).toBe(0)
  })
})
