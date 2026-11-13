import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-162 (J8.6). The CSV import is parked (founders, J8 live run, 11 Oct):
 * it reads only its own template's columns, and we don't yet know how UAE
 * leagues send fixtures. Until it comes back, no coach is offered "Import
 * fixtures". The import itself stays built and tested
 * (schedule-import-j86.test.tsx switches it on).
 */

function fixtures(coachId: string, eventsOn: boolean) {
  server.use(
    table('profiles', [{ id: `p-${coachId}`, user_id: coachId, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([])),
    table('coach_sessions', []),
    table('squad_players', []),
    rpc('feature_on', () => eventsOn),
  )
}

describe('J8.6 parked: no "Import fixtures" on the coach schedule', () => {
  it('offers no import while events are on for the academy', async () => {
    signInAs({ id: 'coach-import-on' })
    fixtures('coach-import-on', true)
    renderApp('/coach/schedule')
    expect(await screen.findByRole('button', { name: 'Quick add' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Import fixtures' })).toBeNull()
  })

  it('offers no import while events are off either', async () => {
    // Its own coach: the app's query cache is shared across a file's tests.
    signInAs({ id: 'coach-import-off' })
    fixtures('coach-import-off', false)
    renderApp('/coach/schedule')
    expect(await screen.findByRole('note', { name: 'This screen is coming soon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quick add' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import fixtures' })).toBeNull()
  })
})
