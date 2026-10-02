/**
 * TRAK-88 (G6), through the real App, AuthProvider, family context and SDK with
 * MSW behind them: a guardian's open app notices that a linked child's consent
 * was withdrawn (by another guardian, or on another device) as soon as they
 * come back to the tab, and reloads so no screen keeps the child's records.
 * The interval half is covered in ParentConsentWatcher.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, table, rpc } from '../../../../tests/msw/supabase'

const reload = vi.hoisted(() => vi.fn())
vi.mock('@/lib/reload-page', () => ({ reloadPage: reload }))

const CHILD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let sequence = 0
let childNeedsConsent: boolean
let checks = 0

beforeEach(() => {
  reload.mockReset()
  checks = 0
  childNeedsConsent = false
  const account = `open-session-parent-${++sequence}`
  signInAs({ id: account })
  const profiles = [
    { id: 'p', user_id: account, role: 'parent', full_name: 'Open Session Parent' },
    { id: 'c', user_id: CHILD, role: 'player', full_name: 'Linked Child' },
  ]
  server.use(
    // The parent's own profile and the child's name come from the same table.
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(profiles.filter(row => filter.includes(row.user_id)))
    }),
    table('player_parent_links', [{ player_user_id: CHILD }]),
    table('matches', []),
    rpc('family_training_history', () => []),
    rpc('get_children_awaiting_consent', () => {
      checks++
      return childNeedsConsent ? [{ player_user_id: CHILD, full_name: 'Linked Child', age_years: 12 }] : []
    }),
  )
})
afterEach(() => cleanup())

function returnToTab() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('an open guardian session and a withdrawal (G6)', () => {
  it('reloads when the guardian returns to the tab after the child\'s consent was withdrawn', async () => {
    renderApp('/parent/matches')
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument()
    await waitFor(() => expect(checks).toBeGreaterThan(0))
    childNeedsConsent = true
    returnToTab()
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('CONTROL does not reload while consent stands', async () => {
    renderApp('/parent/matches')
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument()
    await waitFor(() => expect(checks).toBeGreaterThan(0))
    const before = checks
    returnToTab()
    await waitFor(() => expect(checks).toBeGreaterThan(before))
    expect(reload).not.toHaveBeenCalled()
  })
})
