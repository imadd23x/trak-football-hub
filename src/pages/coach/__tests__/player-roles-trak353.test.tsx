/**
 * TRAK-353 (Season plan 5/18, spec TRAK-348): one panel for a player's main position, roles and Can also play, opened
 * from a name in the Positions step and from the player's page. A third Can also play is refused with the reason, the
 * main position is never one, a role the coach creates shows for their other players, and every change saves and
 * survives a reload. Only where the season plan is on. Synthetic people; the stand-in backend remembers what's saved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

type Row = { id: string; coach_user_id: string; player_name: string; age_group: string; status: string; shirt_number: number; position: string | null; created_at: string; linked_player_id: string | null }
type Save = { p_squad_player_id: string; p_position: string; p_also_plays: string[]; p_roles: string[] }

let n = 0
let COACH = { id: 'coach-353' }
let squad: Row[] = []
let also: { squad_player_id: string; position: string }[] = []
let roles: { squad_player_id: string; role: string }[] = []
let history: { squad_player_id: string; from_position: string | null; to_position: string; changed_at: string }[] = []
let saves: Save[] = []
let failSaving = false
let switchOn = true

const param = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null
const child = (i: number, name: string, position: string | null): Row => ({
  id: `p${i}`, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active',
  shirt_number: i, position, created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${i}`,
})

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-353-${++n}` }
  squad = [child(1, 'Synthetic Pat Defender', 'Defender'), child(2, 'Synthetic Bo Midfielder', 'Midfielder'), child(3, 'Synthetic Cy Attacker', 'Attacker')]
  also = []
  roles = []
  history = [{ squad_player_id: 'p1', from_position: null, to_position: 'Defender', changed_at: '2026-11-04T09:00:00Z' }]
  saves = []
  failSaving = false
  switchOn = true
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json(squad)),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', args => args.p_feature !== 'season_plan' || switchOn),
    http.get(`${SUPABASE_URL}/rest/v1/squad_player_also_plays`, () => HttpResponse.json(also)),
    http.get(`${SUPABASE_URL}/rest/v1/squad_player_roles`, () => HttpResponse.json(roles)),
    http.get(`${SUPABASE_URL}/rest/v1/squad_position_history`, ({ request }) =>
      HttpResponse.json(history.filter(h => h.squad_player_id === param(new URL(request.url), 'squad_player_id')))),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/save_player_position_and_roles`, async ({ request }) => {
      const body = await request.json() as Save
      if (failSaving) return HttpResponse.json({ message: 'down' }, { status: 503 })
      saves.push(body)
      const id = body.p_squad_player_id
      also = [...also.filter(a => a.squad_player_id !== id), ...body.p_also_plays.map(position => ({ squad_player_id: id, position }))]
      roles = [...roles.filter(r => r.squad_player_id !== id), ...body.p_roles.map(role => ({ squad_player_id: id, role }))]
      squad = squad.map(row => (row.id === id ? { ...row, position: body.p_position } : row))
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, () => HttpResponse.json([{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes' }])),
    table('season_objectives', []),
    table('training_notes', []),
    // TRAK-354: the player's page also lists their objectives; none.
    table('player_objectives', []),
    table('squad_player_profiles', []),
    rpc('coach_player_birth_dates', () => []),
    rpc('coach_squad_season', () => []),
    table('coach_assessments', []),
    table('coach_assessment_notes', []),
    table('coach_shared_feedback', []),
    table('coach_sessions', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const user = () => userEvent.setup()
const sheet = (first: string) => screen.findByRole('dialog', { name: `${first}'s position and roles` })
const choice = (scope: HTMLElement, name: string) => within(scope).getByRole('button', { name })

describe('TRAK-353 Can also play and roles', () => {
  // Many taps and some typing: on CI this ran past the 5 s default (5 Nov), as TRAK-352's 22 taps did.
  it('from a Positions name: two Can also play, a third refused with the reason, roles and your own, then Save · next', async () => {
    renderApp('/coach/season-plan/positions')
    await user().click(await screen.findByRole('button', { name: /^Synthetic Pat Defender/ }))
    const pat = await sheet('Synthetic')
    expect(choice(pat, 'Defender')).toHaveAttribute('aria-pressed', 'true')

    // The main position isn't offered as a Can also play.
    const cover = within(pat).getByRole('group', { name: /Can also play/ })
    expect(within(cover).queryByRole('button', { name: 'Defender' })).toBeNull()
    await user().click(choice(cover, 'Midfielder'))
    await user().click(choice(cover, 'Attacker'))
    await user().click(choice(cover, 'Goalkeeper'))
    expect(choice(cover, 'Goalkeeper')).toHaveAttribute('aria-pressed', 'false')
    expect(within(cover).getByRole('status')).toHaveTextContent('Up to two. Untick one first.')

    // Roles for the positions they play, then the coach's own.
    expect(within(pat).getByRole('group', { name: 'As a defender' })).toBeInTheDocument()
    expect(within(pat).getByRole('group', { name: 'As a midfielder' })).toBeInTheDocument()
    await user().click(choice(within(pat).getByRole('group', { name: 'As a defender' }), 'Stopper'))
    await user().click(within(pat).getByRole('button', { name: '+ Create your own' }))
    await user().type(within(pat).getByRole('textbox', { name: 'Your own role' }), '  Win the   second ball{Enter}')
    expect(choice(within(pat).getByRole('group', { name: 'Yours' }), 'Win the second ball')).toHaveAttribute('aria-pressed', 'true')

    await user().click(within(pat).getByRole('button', { name: 'Save · next: Synthetic Bo Midfielder' }))
    await waitFor(() => expect(saves).toEqual([{ p_squad_player_id: 'p1', p_position: 'Defender', p_also_plays: ['Midfielder', 'Attacker'], p_roles: ['Stopper', 'Win the second ball'] }]))

    // The next player opens, and the role the coach created is theirs to pick too.
    const bo = await screen.findByRole('dialog', { name: "Synthetic's position and roles" })
    await waitFor(() => expect(within(bo).getByRole('group', { name: 'As a midfielder' })).toBeInTheDocument())
    expect(choice(within(bo).getByRole('group', { name: 'Yours' }), 'Win the second ball')).toHaveAttribute('aria-pressed', 'false')
    expect(within(bo).getByRole('button', { name: 'Save · next: Synthetic Cy Attacker' })).toBeInTheDocument()
  }, 30_000)

  it('a new main position leaves Can also play', async () => {
    also = [{ squad_player_id: 'p1', position: 'Midfielder' }]
    renderApp('/coach/season-plan/positions')
    await user().click(await screen.findByRole('button', { name: /^Synthetic Pat Defender/ }))
    const pat = await sheet('Synthetic')
    const cover = () => within(pat).getByRole('group', { name: /Can also play/ })
    await waitFor(() => expect(choice(cover(), 'Midfielder')).toHaveAttribute('aria-pressed', 'true'))
    await user().click(choice(within(pat).getByRole('group', { name: 'Main position' }), 'Midfielder'))
    expect(within(cover()).queryByRole('button', { name: 'Midfielder' })).toBeNull()
    expect(choice(cover(), 'Defender')).toHaveAttribute('aria-pressed', 'false')
    await user().click(within(pat).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(saves[0]).toMatchObject({ p_position: 'Midfielder', p_also_plays: [] }))
  }, 30_000)

  it("on the player's page: shows, edits and keeps them after a reload; the history shows the main position's changes", async () => {
    roles = [{ squad_player_id: 'p1', role: 'Stopper' }]
    renderApp('/coach/squad/player/p1')
    const section = await screen.findByRole('region', { name: 'Position and roles' })
    await waitFor(() => expect(within(section).getByText('Stopper')).toBeInTheDocument())
    expect(within(section).getByText('None yet')).toBeInTheDocument()

    await user().click(within(section).getByRole('button', { name: "Edit Synthetic's position and roles" }))
    const pat = await sheet('Synthetic')
    expect(within(pat).getByText('first placed · 4 Nov 2026')).toBeInTheDocument()
    expect(within(pat).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user().click(choice(within(pat).getByRole('group', { name: /Can also play/ }), 'Goalkeeper'))
    await user().click(choice(within(pat).getByRole('group', { name: 'As a defender' }), 'Covering centre back'))
    await user().click(within(pat).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(within(section).getByText('Stopper, Covering centre back')).toBeInTheDocument())
    expect(within(section).getByText('Goalkeeper')).toBeInTheDocument()

    cleanup()
    renderApp('/coach/squad/player/p1')
    const again = await screen.findByRole('region', { name: 'Position and roles' })
    await waitFor(() => expect(within(again).getByText('Stopper, Covering centre back')).toBeInTheDocument())
    expect(within(again).getByText('Goalkeeper')).toBeInTheDocument()
  })

  it("keeps the panel open and says so when a save fails", async () => {
    failSaving = true
    renderApp('/coach/squad/player/p1')
    const section = await screen.findByRole('region', { name: 'Position and roles' })
    await user().click(await within(section).findByRole('button', { name: "Edit Synthetic's position and roles" }))
    const pat = await sheet('Synthetic')
    await user().click(choice(within(pat).getByRole('group', { name: /Can also play/ }), 'Attacker'))
    await user().click(within(pat).getByRole('button', { name: 'Save' }))
    expect(await within(pat).findByText("Couldn't save. Check your connection and try again.")).toBeInTheDocument()
    expect(choice(within(pat).getByRole('group', { name: /Can also play/ }), 'Attacker')).toHaveAttribute('aria-pressed', 'true')
  })

  it("isn't on the player's page where the season plan is off", async () => {
    switchOn = false
    renderApp('/coach/squad/player/p1')
    expect(await screen.findByRole('region', { name: 'About Synthetic' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Position and roles' })).toBeNull()
  })
})
