/**
 * TRAK-72: coach Home, Profile and player page cleanup from the 25 Sep
 * use-case test (Imad + Tarek, as coach.u15). Rendered through the real app
 * and router, with MSW standing in for Supabase.
 *
 *   1  no coach invite code on Home or Profile, and nothing writes one
 *   2  the squad tile says "Players"
 *   3  the Sessions tile opens session history
 *   5  no assessment count under a player's name
 *   9  the coach's age group sits next to their role
 *  10  "How Trak works", not "Coach manual"
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, table } from '../../../../tests/msw/supabase'
import { http, HttpResponse } from 'msw'

const COACH = { id: 'coach-72' }

function signedInCoach() {
  signInAs(COACH)
  server.use(
    // No invite_code: the old pages generated and wrote one in that case.
    table('profiles', [{ id: 'p-72', user_id: COACH.id, role: 'coach', full_name: 'Coach Synthetic', invite_code: null }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U15s', current_club: null, organization_id: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Alex Synthetic', linked_player_id: 'child-1', position: 'Midfielder', shirt_number: 8 },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bella Synthetic', linked_player_id: 'child-2', position: null, shirt_number: null },
    ]),
    table('coach_assessments', [
      { id: 'a-1', squad_player_id: 'sp-1', coach_user_id: COACH.id, coach_rating: 7, created_at: '2026-09-20T10:00:00Z',
        work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7, squad_players: { player_name: 'Alex Synthetic' } },
    ]),
    table('coach_sessions', [{ id: 's-1', coach_user_id: COACH.id }]),
    table('coach_assessment_notes', []),
    table('organizations', []),
  )
}

// Every non-GET to profiles, so "shows no code" cannot pass while a code is
// still being generated and stored behind the screen.
function profileWrites() {
  const writes: string[] = []
  server.events.on('request:start', ({ request }) => {
    if (request.url.includes('/rest/v1/profiles') && request.method !== 'GET') writes.push(request.method)
  })
  return writes
}

afterEach(() => { cleanup(); server.events.removeAllListeners() })

describe('TRAK-72 coach Home', () => {
  it('says Players, shows no invite code, and writes none', async () => {
    signedInCoach()
    const writes = profileWrites()
    renderApp('/coach/home')
    const tile = await screen.findByRole('button', { name: /^2\s*Players$/i })
    expect(tile).toBeInTheDocument()
    expect(screen.queryByText(/TRK-/)).toBeNull()
    expect(screen.queryByText(/tap to copy/i)).toBeNull()
    // Give any code generator the time it used to take, then check nothing wrote.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(writes).toEqual([])
  })

  it('the Sessions tile opens session history, not the log-a-session chooser', async () => {
    signedInCoach()
    renderApp('/coach/home')
    // The tile, not the nav bar's Sessions tab: its name starts with the count.
    await userEvent.click(await screen.findByRole('button', { name: /^\d+\s*Sessions$/i }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/sessions/list'))
  })
})

describe('TRAK-72 coach Profile', () => {
  it('shows role and age group, "How Trak works", and no invite code', async () => {
    signedInCoach()
    const writes = profileWrites()
    renderApp('/coach/profile')
    expect(await screen.findByText('Head Coach')).toBeInTheDocument()
    expect(await screen.findByText('U15s')).toBeInTheDocument()
    expect(screen.getByText('HOW TRAK WORKS')).toBeInTheDocument()
    expect(screen.queryByText(/coach manual/i)).toBeNull()
    expect(screen.queryByText(/invite code/i)).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(writes).toEqual([])
  })
})

describe('TRAK-72 player page', () => {
  it('keeps position and shirt number, and drops the assessment count', async () => {
    signedInCoach()
    // The page reads one roster row by id (maybeSingle), so serve exactly one.
    server.use(
      table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Alex Synthetic', linked_player_id: 'child-1', position: 'Midfielder', shirt_number: 8 }]),
      table('coach_shared_feedback', []),
    )
    renderApp('/coach/player/sp-1')
    expect(await screen.findByText('Midfielder')).toBeInTheDocument()
    expect(screen.getByText('#8')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+ assessments?$/)).toBeNull()
  })
})

describe('TRAK-72 item 4: one Player overview', () => {
  const ROSTER = [
    { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Alex Synthetic', linked_player_id: 'child-1', created_at: '2026-09-01T10:00:00Z' },
    { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bella Synthetic', linked_player_id: 'child-2', created_at: '2026-09-01T10:00:00Z' },
    { id: 'sp-3', coach_user_id: COACH.id, player_name: 'Cara Waiting', linked_player_id: 'child-3', created_at: '2026-09-01T10:00:00Z' },
  ]
  function withLastTraining(consent: (id: string) => Response) {
    signedInCoach()
    server.use(
      table('squad_players', ROSTER),
      table('coach_sessions', [{ id: 's-1', coach_user_id: COACH.id, session_date: '2026-09-20', session_type: 'training' }]),
      table('session_attendance', [{ squad_player_id: 'sp-1' }]),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
        const { p_squad_player_id } = await request.json() as { p_squad_player_id: string }
        return consent(p_squad_player_id)
      }),
    )
  }

  it('flags the consented child who missed training, never the one waiting for a parent', async () => {
    withLastTraining(id => HttpResponse.json(id === 'sp-3'))
    renderApp('/coach/home')
    const overview = await screen.findByRole('region', { name: 'Player overview' })
    // Exactly one "missed" flag, on Bella's row. Cara may still be listed for
    // another reason (no assessments yet), but never as missing a session she
    // could not be ticked into; Alex was there.
    await waitFor(() => expect(within(overview).getAllByText('Missed the last session')).toHaveLength(1))
    const missedRow = within(overview).getByText('Missed the last session').closest('li') as HTMLElement
    expect(within(missedRow).getByText('Bella Synthetic')).toBeInTheDocument()
    // The two old cards are one list now.
    expect(screen.queryByText(/^Needs Attention$/i)).toBeNull()
    expect(screen.queryByText(/^Most Improved$/i)).toBeNull()
  })

  it('says it could not check, rather than flagging nobody, when a consent check fails', async () => {
    withLastTraining(() => HttpResponse.json({ message: 'unavailable' }, { status: 500 }))
    renderApp('/coach/home')
    expect(await screen.findByText(/Couldn't check the last session's attendance/)).toBeInTheDocument()
    expect(screen.queryByText('Missed the last session')).toBeNull()
  })
})

// Item 11: every staff account Trak sets up has current_club = NULL, so a chip
// that needed it never showed, and a stale typed club must not contradict the
// academy.
describe('TRAK-72 item 11: the club comes from the academy', () => {
  function coachInAcademy(typedClub: string | null) {
    signedInCoach()
    server.use(
      table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U15s', current_club: typedClub, organization_id: 'org-72' }]),
      table('organizations', [{ id: 'org-72', name: 'Synthetic Academy FC' }]),
    )
  }

  it('Home shows the age group even though no club name was typed', async () => {
    coachInAcademy(null)
    renderApp('/coach/home')
    expect(await screen.findByText('U15s')).toBeInTheDocument()
  })

  it('Profile names the academy and never shows a stale typed club', async () => {
    coachInAcademy('Old Typed Club')
    renderApp('/coach/profile')
    expect(await screen.findByText('Synthetic Academy FC')).toBeInTheDocument()
    expect(screen.getByText('U15s')).toBeInTheDocument()
    expect(screen.queryByText('Old Typed Club')).toBeNull()
  })

  it('Home never shows a stale typed club either', async () => {
    coachInAcademy('Old Typed Club')
    renderApp('/coach/home')
    expect(await screen.findByText('U15s')).toBeInTheDocument()
    expect(screen.queryByText(/Old Typed Club/)).toBeNull()
  })
})
