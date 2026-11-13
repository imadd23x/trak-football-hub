import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

/**
 * TRAK-432: an empty Schedule day uses Arc's empty state, and its line names the button the coach sees: "+" on a phone,
 * Create on a laptop, never "Tap" on a laptop.
 */
const realMatchMedia = window.matchMedia
const asLaptop = (laptop: boolean) => {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
}

beforeEach(() => {
  localStorage.clear()
  signInAs({ id: 'coach-432' })
  server.use(
    table('profiles', [{ id: 'p', user_id: 'coach-432', role: 'coach', full_name: 'Dora', invite_code: 'ABCD' }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([])),
    table('coach_sessions', []),
    table('squad_players', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); window.matchMedia = realMatchMedia; vi.restoreAllMocks() })

describe('TRAK-432: an empty Schedule day', { timeout: 20_000 }, () => {
  it('on a phone says Nothing planned and points to the "+"', async () => {
    asLaptop(false)
    renderApp('/coach/schedule')
    expect(await screen.findByText('Nothing planned')).toBeInTheDocument()
    expect(screen.getByText('Use + to add an event.')).toBeInTheDocument()
    expect(screen.queryByText(/\bTap\b/)).toBeNull()
  })

  it('on a laptop points to Create, not a tap', async () => {
    asLaptop(true)
    renderApp('/coach/schedule')
    expect(await screen.findByText('Nothing planned')).toBeInTheDocument()
    expect(screen.getByText('Use Create to add an event.')).toBeInTheDocument()
    expect(screen.queryByText(/\bTap\b|Use \+/)).toBeNull()
  })
})
