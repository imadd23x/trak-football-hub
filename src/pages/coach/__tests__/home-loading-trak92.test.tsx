import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { registerAuthUser } from '../../../../tests/msw/auth-sessions'
import { supabase } from '@/integrations/supabase/client'

/**
 * TRAK-92 (J4): coach Home still loading is not a coach with nothing.
 *
 * Every count started at 0, so until the reads answered, Home told a coach
 * with 30 assessments and 8 sessions "0 total", "0 SESSIONS", "No assessments
 * yet" and "Your squad is being prepared" (seen live on coach.u15, 29 Sep).
 * Same class as #188's "No squad yet" while loading.
 *
 * TRAK-197 rebuilt Home around the Player overview; the counts went, the rule
 * stays: until the reads answer, no empty squad and no "on track"; a failed
 * read says so, and never shows an earlier answer as this one. TRAK-211 moved
 * the overview to the Feedback and assessment tab, and the rule with it.
 */
// A fresh coach each test: the app's query cache (squads, TRAK-176) outlives a test.
let n = 0
let COACH = { id: 'coach-92-0' }
const PLAYERS = [
  { id: 'sp-1', player_name: 'Ade Okafor', created_at: '2026-09-01T00:00:00Z' },
  { id: 'sp-2', player_name: 'Bo Lind', created_at: '2026-09-01T00:00:00Z' },
]
const ASSESSMENTS = [
  { id: 'a-1', squad_player_id: 'sp-1', coach_rating: 7, created_at: '2026-09-20T10:00:00Z' },
  { id: 'a-2', squad_player_id: 'sp-2', coach_rating: 6, created_at: '2026-09-19T10:00:00Z' },
]

const overview = () => screen.getByRole('region', { name: 'Feedback and assessment' })
// The first look waits for the lazy tab to load.
const region = () => screen.findByRole('region', { name: 'Feedback and assessment' }, { timeout: 5000 })

function coachHome() {
  return [
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, team: 'U15s', coach_role: 'Head Coach' }]),
    table('session_attendance', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
  ]
}

beforeEach(() => { COACH = { id: `coach-92-${++n}` } })
afterEach(() => cleanup())

describe('TRAK-92 coach Feedback and assessment while loading', { timeout: 20_000 }, () => {
  it('claims no empty squad and nobody on track until the reads answer, then shows the players', async () => {
    signInAs(COACH)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const asked = new Set<string>()
    const hold = (name: string, rows: unknown[]) =>
      http.get(`${SUPABASE_URL}/rest/v1/${name}`, async () => {
        asked.add(name)
        await held
        return HttpResponse.json(rows)
      })
    server.use(
      ...coachHome(),
      hold('squad_players', PLAYERS),
      hold('coach_assessments', ASSESSMENTS),
      hold('coach_sessions', []),
    )

    renderApp('/coach/feedback')
    // The squads come first (TRAK-176): until they answer, nothing else is asked.
    await waitFor(() => expect([...asked]).toEqual(['squad_players']), { timeout: 5000 })

    // Still loading: nothing on screen may claim the squad is empty or fine.
    // TRAK-335: Arc's skeleton, heard as what is loading.
    expect(within(await region()).getByRole('status', { name: 'Loading your players…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()
    expect(screen.queryByText(/On track/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    release()

    expect(await within(await region()).findByText('Ade Okafor')).toBeInTheDocument()
    expect(within(overview()).getByText('Bo Lind')).toBeInTheDocument()
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Imad's second and third #203 reviews: an empty first load, then a
  // same-account token refresh whose re-reads fail. What the first run showed
  // must not be printed as this run's answer, neither beside the failure nor
  // while the next refresh is still out.
  it('a failed re-read after a refresh says so, not the empty squad kept from the first load, and loads again on the next', async () => {
    signInAs(COACH)
    let mode = 'empty' as 'empty' | 'fail' | 'held'
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const failing = (name: string, recovered: unknown[]) =>
      http.get(`${SUPABASE_URL}/rest/v1/${name}`, async () => {
        if (mode === 'fail') return HttpResponse.json({ message: 'upstream unavailable' }, { status: 500 })
        if (mode === 'empty') return HttpResponse.json([])
        await held
        return HttpResponse.json(recovered)
      })
    server.use(
      ...coachHome(),
      table('coach_sessions', []),
      failing('squad_players', PLAYERS.slice(0, 1)),
      failing('coach_assessments', ASSESSMENTS.slice(0, 1)),
      http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
        const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
        const user = structuredClone(previous.user)
        return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
          expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
      }),
    )

    renderApp('/coach/feedback')
    // The first load answers: an empty squad.
    expect(await screen.findByText('Your squad is being prepared', {}, { timeout: 5000 })).toBeInTheDocument()

    mode = 'fail'
    await act(async () => { const { error } = await supabase.auth.refreshSession(); expect(error).toBeNull() })

    expect(await within(await region()).findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent("Couldn't load your players.")
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()

    // Another refresh, its re-reads held: still unknown, so no empty squad.
    mode = 'held'
    await act(async () => { const { error } = await supabase.auth.refreshSession(); expect(error).toBeNull() })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()
    expect(screen.queryByText(/On track/)).toBeNull()

    release()

    expect(await within(await region()).findByText('Ade Okafor')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed squad read says so and offers Retry, not "Loading" for good', async () => {
    signInAs(COACH)
    let squadFails = true
    server.use(
      ...coachHome(),
      table('coach_sessions', []),
      table('coach_assessments', []),
      http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => squadFails
        ? HttpResponse.json({ message: 'upstream unavailable' }, { status: 500 })
        : HttpResponse.json(PLAYERS)),
    )

    renderApp('/coach/feedback')
    const alert = await within(await region()).findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent("Couldn't load your players.")
    expect(screen.queryByRole('status', { name: 'Loading your players…' })).toBeNull()

    squadFails = false
    await act(async () => { within(alert).getByRole('button', { name: 'Retry' }).click() })
    expect(await within(await region()).findByText('Ade Okafor')).toBeInTheDocument()
  })
})
