/**
 * TRAK-72: coach Home, Profile and player page cleanup from the 25 Sep
 * use-case test (Imad + Tarek, as coach.u15). Rendered through the real app
 * and router, with MSW standing in for Supabase.
 *
 *   1  no coach invite code on Home or Profile, and nothing writes one
 *   2, 3  the squad and Sessions tiles went with TRAK-197's Home rebuild
 *   5  no assessment count under a player's name
 *   9  the coach's age group sits next to their role
 *  10  "How Trak works", not "Coach manual", and it no longer tells coaches
 *      to share an invite code
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, rpc, rpcRows, table } from '../../../../tests/msw/supabase'
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
    // Feedback and assessment asks per child (TRAK-197, TRAK-211); everyone is confirmed here.
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
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
  it('shows no invite code, and writes none', async () => {
    signedInCoach()
    const writes = profileWrites()
    renderApp('/coach/home')
    // The file's first render loads coach Home cold; on a busy CI runner that
    // took over the default 1 s (run 36394909944, Imad on TRAK-72).
    expect(await screen.findByRole('region', { name: 'Squad shape' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText(/TRK-/)).toBeNull()
    expect(screen.queryByText(/tap to copy/i)).toBeNull()
    // Give any code generator the time it used to take, then check nothing wrote.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(writes).toEqual([])
  })
})

// TRAK-418 (12 Nov): the old Profile and the old coach manual are gone. Their addresses land on Settings and on the
// coach's own How Trak works, which still never mention an invite code and write nothing.
describe('TRAK-72 / TRAK-418 the old Profile and manual addresses', () => {
  it('the old Profile opens Settings, with role and age group, no invite code, and no write', async () => {
    signedInCoach()
    const writes = profileWrites()
    renderApp('/coach/profile')
    await waitFor(() => expect(window.location.pathname).toBe('/settings'))
    // Settings shows the role twice (the header line and the Club section), and the age group once.
    expect((await screen.findAllByText('Head Coach')).length).toBeGreaterThan(0)
    expect(await screen.findByText('U15s')).toBeInTheDocument()
    expect(screen.queryByText(/invite code/i)).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(writes).toEqual([])
  })

  it("the old manual opens the coach's How Trak works, which never tells the coach to share an invite code", async () => {
    signedInCoach()
    renderApp('/coach/manual')
    await waitFor(() => expect(window.location.pathname).toBe('/coach/how-trak-works'))
    expect(await screen.findByRole('heading', { level: 1, name: 'How Trak works' })).toBeInTheDocument()
    expect(screen.queryByText(/invite code|your code|TRK-/i)).toBeNull()
  })
})

describe('TRAK-72 player page', () => {
  it('keeps position and shirt number, and drops the assessment count', async () => {
    // TRAK-368: the player's own page in Squad, with the reads Squad makes. Its header line is "#8 · Midfielder · U16".
    // A coach of its own: the app's query cache outlives a test, and the other tests here sign in as COACH.
    const OWN = { id: 'coach-72-player-page' }
    signInAs(OWN)
    server.use(
      table('profiles', [{ id: 'p-72b', user_id: OWN.id, role: 'coach', full_name: 'Coach Synthetic', invite_code: null }]),
      table('coach_details', [{ user_id: OWN.id, coach_role: 'Head Coach', team: 'U16s', current_club: null, organization_id: null }]),
      table('notification_settings', []),
      table('squad_players', [{ id: 'sp-1', coach_user_id: OWN.id, player_name: 'Alex Synthetic', linked_player_id: 'child-1', position: 'Midfielder', shirt_number: 8, age_group: 'U16', status: 'active' }]),
      table('coach_shared_feedback', []),
      table('coach_assessments', []),
      table('coach_assessment_notes', []),
      table('coach_sessions', []),
      table('squad_player_profiles', []),
      rpc('coach_squad_player_consent_required', () => false),
      rpc('feature_on', () => false),
      rpc('coach_squad_season', () => []),
      rpcRows('coach_player_birth_dates', []),
    )
    renderApp('/coach/squad/player/sp-1')
    const page = await screen.findByRole('article', { name: /^Alex Synthetic/ })
    expect(page).toHaveTextContent('#8 · Midfielder · U16')
    expect(screen.queryByText(/^\d+ assessments?$/)).toBeNull()
  })
})

describe('TRAK-72 item 4: one Player overview (TRAK-211: in Feedback and assessment)', () => {
  const ROSTER = [
    { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Alex Synthetic', linked_player_id: 'child-1', created_at: '2026-09-01T10:00:00Z' },
    { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bella Synthetic', linked_player_id: 'child-2', created_at: '2026-09-01T10:00:00Z' },
    { id: 'sp-3', coach_user_id: COACH.id, player_name: 'Cara Waiting', linked_player_id: 'child-3', created_at: '2026-09-01T10:00:00Z' },
  ]
  function withLastTraining(consent: (id: string) => Response) {
    signedInCoach()
    server.use(
      table('squad_players', ROSTER),
      table('coach_sessions', [{ id: 's-1', coach_user_id: COACH.id, session_date: '2026-09-20', session_type: 'training', event_id: null, squad: null }]),
      table('session_attendance', [{ session_id: 's-1', squad_player_id: 'sp-1' }]),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
        const { p_squad_player_id } = await request.json() as { p_squad_player_id: string }
        return consent(p_squad_player_id)
      }),
    )
  }

  // TRAK-197: the flag reads "Missed the last training", and a child waiting
  // for a parent isn't listed at all (they can't be ticked or assessed).
  it('flags the consented child who missed training, never the one waiting for a parent', async () => {
    withLastTraining(id => HttpResponse.json(id === 'sp-3'))
    renderApp('/coach/feedback')
    const overview = await screen.findByRole('region', { name: 'Feedback and assessment' })
    await waitFor(() => expect(within(overview).getAllByText('Missed the last training')).toHaveLength(1))
    const missedRow = within(overview).getByText('Missed the last training').closest('li') as HTMLElement
    expect(within(missedRow).getByText('Bella Synthetic')).toBeInTheDocument()
    expect(within(overview).queryByText('Cara Waiting')).toBeNull()
    // The two old cards are one list.
    expect(screen.queryByText(/^Needs Attention$/i)).toBeNull()
    expect(screen.queryByText(/^Most Improved$/i)).toBeNull()
  })

  it('says it could not load, rather than flagging nobody, when a consent check fails', async () => {
    withLastTraining(() => HttpResponse.json({ message: 'unavailable' }, { status: 500 }))
    renderApp('/coach/feedback')
    expect(await screen.findByText(/Couldn't load your players/)).toBeInTheDocument()
    expect(screen.queryByText('Missed the last training')).toBeNull()
    expect(screen.queryByText(/On track/)).toBeNull()
  })

  // TRAK-180: the tab starts a revisit from what it last showed, so a check that
  // fails this time must take the last visit's flag with it.
  it("a revisit whose check fails shows no flag from the last visit", async () => {
    withLastTraining(id => HttpResponse.json(id === 'sp-3'))
    renderApp('/coach/feedback')
    await waitFor(() => expect(screen.getAllByText('Missed the last training')).toHaveLength(1))
    cleanup()
    withLastTraining(() => HttpResponse.json({ message: 'unavailable' }, { status: 500 }))
    renderApp('/coach/feedback')
    expect(await screen.findByText(/Couldn't load your players/)).toBeInTheDocument()
    expect(screen.queryByText('Missed the last training')).toBeNull()
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

  // TRAK-418: Settings is the coach's profile now (the old Profile page is gone).
  it('Settings names the academy and never shows a stale typed club', async () => {
    coachInAcademy('Old Typed Club')
    renderApp('/settings')
    expect(await screen.findByText('Synthetic Academy FC')).toBeInTheDocument()
    expect(screen.getByText('U15s')).toBeInTheDocument()
    expect(screen.queryByText('Old Typed Club')).toBeNull()
  })

  it('Home never shows a stale typed club either', async () => {
    coachInAcademy('Old Typed Club')
    renderApp('/coach/home')
    expect(await screen.findByRole('region', { name: 'Squad shape' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText(/Old Typed Club/)).toBeNull()
  })
})
