/**
 * TRAK-13 (G6) / TRAK-6 (J6), through the real App, AuthProvider and SDK with
 * MSW behind them: a player's open session notices a withdrawal as soon as
 * they come back to the tab, and reloads so every screen re-reads. The
 * interval half is covered in PlayerConsentWatcher.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const reload = vi.hoisted(() => vi.fn())
vi.mock('@/lib/reload-page', () => ({ reloadPage: reload }))

let sequence = 0
let status: { required: boolean; granted: boolean }
let checks = 0

beforeEach(() => {
  reload.mockReset()
  checks = 0
  status = { required: false, granted: true }
  const account = `open-session-player-${++sequence}`
  signInAs({ id: account })
  server.use(
    table('profiles', [{ id: 'p', user_id: account, role: 'player', full_name: 'Open Session Player' }]),
    table('matches', []),
    rpc('family_training_history', () => []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => { checks++; return { ...status, invited_parent: null } }),
  )
})
afterEach(() => cleanup())

function returnToTab() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('an open player session and a withdrawal (G6)', () => {
  it('reloads when the player returns to the tab after their parent withdrew', async () => {
    renderApp('/player/matches')
    expect(await screen.findByText('No training recorded yet.')).toBeInTheDocument()
    await waitFor(() => expect(checks).toBeGreaterThan(0))
    status = { required: true, granted: false }
    returnToTab()
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('CONTROL does not reload while consent stands', async () => {
    renderApp('/player/matches')
    expect(await screen.findByText('No training recorded yet.')).toBeInTheDocument()
    await waitFor(() => expect(checks).toBeGreaterThan(0))
    const before = checks
    returnToTab()
    await waitFor(() => expect(checks).toBeGreaterThan(before))
    expect(reload).not.toHaveBeenCalled()
  })
})
