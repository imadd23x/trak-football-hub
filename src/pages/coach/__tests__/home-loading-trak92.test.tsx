import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
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
 */
const COACH = { id: 'coach-1' }
const PLAYERS = [
  { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', created_at: '2026-09-01T00:00:00Z' },
  { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bo Lind', created_at: '2026-09-01T00:00:00Z' },
]
const ASSESSMENTS = [
  { id: 'a-1', coach_user_id: COACH.id, squad_player_id: 'sp-1', coach_rating: 7, created_at: '2026-09-20T10:00:00Z', squad_players: { player_name: 'Ade Okafor' } },
  { id: 'a-2', coach_user_id: COACH.id, squad_player_id: 'sp-2', coach_rating: 6, created_at: '2026-09-19T10:00:00Z', squad_players: { player_name: 'Bo Lind' } },
]
const SESSIONS = [{ id: 's-1' }, { id: 's-2' }, { id: 's-3' }]

// The number printed just above the hero's "Players in squad" label.
const heroCount = () => screen.getByText('Players in squad').previousElementSibling?.textContent?.trim()
// The number on a quick-action tile. The bottom nav also says "Sessions", so
// the tile is the button whose name is a value followed by the label.
const tileCount = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^\\S+\\s*${label}$`) }).querySelector('p')?.textContent?.trim()

afterEach(() => cleanup())

describe('TRAK-92 coach Home while loading', () => {
  it('claims no zeros and no empty squad until the reads answer, then shows the real counts', async () => {
    signInAs(COACH)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const asked = new Set<string>()
    const hold = (name: string, answer: (url: URL) => Response) =>
      http.get(`${SUPABASE_URL}/rest/v1/${name}`, async ({ request }) => {
        asked.add(name)
        await held
        return answer(new URL(request.url))
      })
    server.use(
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
      table('coach_details', [{ user_id: COACH.id, team: 'U15s', coach_role: 'Head Coach' }]),
      table('session_attendance', []),
      rpc('coach_squad_player_consent_required', () => false),
      hold('squad_players', () => HttpResponse.json(PLAYERS)),
      hold('coach_assessments', () => HttpResponse.json(ASSESSMENTS)),
      // The count read gets PostgREST's Content-Range; the last-training read
      // (limit=1) finds none, so nobody is flagged as missing it.
      hold('coach_sessions', url => url.searchParams.get('limit') === '1'
        ? HttpResponse.json([])
        : HttpResponse.json(SESSIONS, { headers: { 'Content-Range': `0-2/${SESSIONS.length}` } })),
    )

    renderApp('/coach/home')
    await waitFor(() => expect([...asked].sort()).toEqual(['coach_assessments', 'coach_sessions', 'squad_players']), { timeout: 5000 })

    // Still loading: nothing on screen may claim the squad is empty.
    expect(heroCount()).not.toBe('0')
    expect(tileCount('Players?')).not.toBe('0')
    expect(tileCount('Sessions')).not.toBe('0')
    expect(screen.queryByText(/^0 total$/)).toBeNull()
    expect(screen.queryByText('No assessments yet')).toBeNull()
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    release()

    expect(await screen.findByText('2 total')).toBeInTheDocument()
    await waitFor(() => expect(tileCount('Sessions')).toBe('3'))
    expect(heroCount()).toBe('2')
    expect(tileCount('Players')).toBe('2')
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Imad's #203 review: one shared failure flag was cleared by the next read
  // that succeeded, so a failed session count turned back into "…" for good
  // and its banner went away.
  it('a failed session count stays failed after the assessments arrive', async () => {
    signInAs(COACH)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let assessAsked = false
    server.use(
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
      table('coach_details', [{ user_id: COACH.id, team: 'U15s', coach_role: 'Head Coach' }]),
      table('session_attendance', []),
      rpc('coach_squad_player_consent_required', () => false),
      table('squad_players', PLAYERS),
      http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () =>
        HttpResponse.json({ message: 'upstream unavailable' }, { status: 500 })),
      http.get(`${SUPABASE_URL}/rest/v1/coach_assessments`, async () => {
        assessAsked = true
        await held
        return HttpResponse.json(ASSESSMENTS)
      }),
    )

    renderApp('/coach/home')
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(assessAsked).toBe(true))
    expect(tileCount('Sessions')).toBe('—')

    release()

    expect(await screen.findByText('2 total')).toBeInTheDocument()
    expect(tileCount('Sessions')).toBe('—')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(heroCount()).toBe('2')
  })

  // Imad's second #203 review: an empty first load, then a same-account token
  // refresh whose re-reads fail. The 0s kept from the first run were printed
  // ahead of the failure, so Home said "0" and "0 total" under the error.
  // Imad's third #203 review adds the next refresh: while its re-reads are
  // still out, the failed run's 0s must not come back as answers.
  it('a failed re-read after a refresh shows "—", not the 0 kept from the first load, and "…" while the next refresh loads', async () => {
    signInAs(COACH)
    let mode = 'empty' as 'empty' | 'fail' | 'held'
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const failing = (name: string, recovered: unknown[]) =>
      http.get(`${SUPABASE_URL}/rest/v1/${name}`, async () => {
        if (mode === 'fail') return HttpResponse.json({ message: 'upstream unavailable' }, { status: 500 })
        if (mode === 'empty') return HttpResponse.json([], { headers: { 'Content-Range': '*/0' } })
        await held
        return HttpResponse.json(recovered)
      })
    server.use(
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
      table('coach_details', [{ user_id: COACH.id, team: 'U15s', coach_role: 'Head Coach' }]),
      table('coach_sessions', []),
      table('session_attendance', []),
      rpc('coach_squad_player_consent_required', () => false),
      failing('squad_players', PLAYERS.slice(0, 1)),
      failing('coach_assessments', ASSESSMENTS.slice(0, 1)),
      http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
        const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
        const user = structuredClone(previous.user)
        return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
          expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
      }),
    )

    renderApp('/coach/home')
    // The first load answers: an empty squad with no assessments.
    expect(await screen.findByText('0 total', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(heroCount()).toBe('0')
    expect(screen.queryByRole('alert')).toBeNull()

    mode = 'fail'
    await act(async () => { const { error } = await supabase.auth.refreshSession(); expect(error).toBeNull() })

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText('Not available')).toBeInTheDocument()
    expect(screen.queryByText(/^0 total$/)).toBeNull()
    expect(heroCount()).toBe('—')
    expect(tileCount('Players?')).toBe('—')
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()

    // Another refresh, its re-reads held: still unknown, so no 0s and no empty squad.
    mode = 'held'
    await act(async () => { const { error } = await supabase.auth.refreshSession(); expect(error).toBeNull() })
    await waitFor(() => expect(screen.queryByText('Not available')).toBeNull())
    expect(heroCount()).not.toBe('0')
    expect(tileCount('Players?')).not.toBe('0')
    expect(screen.queryByText(/^0 total$/)).toBeNull()
    expect(screen.queryByText('No assessments yet')).toBeNull()
    expect(screen.queryByText('Your squad is being prepared')).toBeNull()

    release()

    expect(await screen.findByText('1 total')).toBeInTheDocument()
    expect(heroCount()).toBe('1')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('assessments say "Not available", not "Loading…", when the squad read failed', async () => {
    // The all-assessments read only starts after the squad answers, so a
    // failed squad read means it never runs: it must not wait forever.
    signInAs(COACH)
    server.use(
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
      table('coach_details', []),
      table('coach_sessions', []),
      http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () =>
        HttpResponse.json({ message: 'upstream unavailable' }, { status: 500 })),
      table('coach_assessments', []),
    )

    renderApp('/coach/home')
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText('Not available')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(heroCount()).toBe('—')
  })
})
