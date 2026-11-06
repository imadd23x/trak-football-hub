/**
 * TRAK-354 (Season plan 6/18, spec TRAK-348): step 3, Player objectives, and the player's page. Two from the six for
 * their position (those supporting the squad's season objectives first), a third refused with the reason, the coach's
 * own, edit and delete; the step saves with none; a player with no position can't get one. Every change survives a
 * reload. Synthetic people; the stand-in backend remembers what's saved.
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
type Objective = { title: string; source: string; season_objective_id: string | null }
type Saved = Objective & { id: string; squad_player_id: string; created_at: string }

let n = 0
let COACH = { id: 'coach-354' }
let squad: Row[] = []
let held: Saved[] = []
let saves: { p_squad_player_id: string; p_objectives: Objective[] }[] = []
let failSaving = false
let switchOn = true

const child = (i: number, name: string, position: string | null): Row => ({
  id: `p${i}`, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active',
  shirt_number: i, position, created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${i}`,
})
const lib = (title: string, season_objective_id: string | null = null): Objective => ({ title, source: 'library', season_objective_id })

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-354-${++n}` }
  squad = [child(1, 'Synthetic Pat Defender', 'Defender'), child(2, 'Synthetic Bo Midfielder', 'Midfielder'),
    child(3, 'Synthetic Cy Attacker', 'Attacker'), child(4, 'Synthetic Uma Unplaced', null)]
  held = []
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
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, () => HttpResponse.json([{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes' }])),
    table('season_objectives', [{ id: 'so-press', place: 1, title: 'Win it back within 5 seconds', looks_like: '' }]),
    http.get(`${SUPABASE_URL}/rest/v1/player_objectives`, () => HttpResponse.json(held)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/save_player_objectives`, async ({ request }) => {
      const body = await request.json() as (typeof saves)[number]
      if (failSaving) return HttpResponse.json({ message: 'down' }, { status: 503 })
      saves.push(body)
      held = [...held.filter(o => o.squad_player_id !== body.p_squad_player_id),
        ...body.p_objectives.map((o, i) => ({ ...o, id: `${body.p_squad_player_id}-${saves.length}-${i}`, squad_player_id: body.p_squad_player_id, created_at: '2026-11-05T10:00:00Z' }))]
      return new HttpResponse(null, { status: 204 })
    }),
    table('training_notes', []),
    // TRAK-353: the player's page also lists Can also play and roles; none.
    table('squad_player_also_plays', []), table('squad_player_roles', []),
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
const sheet = () => screen.findByRole('dialog', { name: "Synthetic's objectives" })
const option = (scope: HTMLElement, title: string) => within(within(scope).getByRole('group', { name: /^Objectives for/ })).getByRole('button', { name: new RegExp(`^${title}`) })

describe('TRAK-354 player objectives', () => {
  it('step 3: two objectives, supporting ones first, a third refused with the reason, then Save · next', async () => {
    renderApp('/coach/season-plan/objectives')
    expect(await screen.findByRole('heading', { name: "Everyone's objectives" })).toBeInTheDocument()
    expect(screen.getByText('0 of 3 players have one or two')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: /^Synthetic Pat Defender/ }))
    const pat = await sheet()
    const choices = within(within(pat).getByRole('group', { name: /^Objectives for/ })).getAllByRole('button')
    expect(choices[0]).toHaveTextContent('Steps in to win it the moment we lose itSupports: Win it back within 5 seconds')
    expect(choices).toHaveLength(6)

    await user().click(option(pat, 'Steps in to win it'))
    await user().click(option(pat, 'Wins their headers'))
    await user().click(option(pat, 'Holds the line together'))
    expect(option(pat, 'Holds the line together')).toHaveAttribute('aria-pressed', 'false')
    expect(within(pat).getByText('Up to two at once. Untick one first.')).toHaveAttribute('role', 'status')
    expect(within(pat).getByText('2 of 2 picked.', { exact: false })).toBeInTheDocument()

    await user().click(within(pat).getByRole('button', { name: 'Save · next: Synthetic Bo Midfielder' }))
    await waitFor(() => expect(saves).toEqual([{ p_squad_player_id: 'p1', p_objectives: [lib('Steps in to win it the moment we lose it', 'so-press'), lib('Wins their headers')] }]))
    expect(await screen.findByRole('button', { name: 'Save · next: Synthetic Cy Attacker' })).toBeInTheDocument()
    expect(screen.getByText('1 of 3 players has one or two')).toBeInTheDocument()
  }, 30_000)

  it("the coach's own, then edit and delete from the player's page, kept after a reload", async () => {
    renderApp('/coach/season-plan/objectives')
    await user().click(await screen.findByRole('button', { name: /^Synthetic Cy Attacker/ }))
    const cy = await sheet()
    await user().type(within(cy).getByRole('textbox', { name: 'Create your own' }), '  Shoots   early from the edge{Enter}')
    expect(within(cy).getByRole('button', { name: /^Shoots early from the edge/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(cy).getByRole('button', { name: /^Shoots early from the edge/ })).toHaveTextContent('Your own')
    await user().click(option(cy, 'Runs in behind'))
    // Save · next goes round to the first player still without one, as the mockup's does.
    await user().click(within(cy).getByRole('button', { name: 'Save · next: Synthetic Pat Defender' }))
    await waitFor(() => expect(saves[0].p_objectives).toEqual([{ title: 'Shoots early from the edge', source: 'own', season_objective_id: null }, lib('Runs in behind')]))
    await user().click(within(await screen.findByRole('dialog', { name: "Synthetic's objectives" })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    cleanup()
    renderApp('/coach/squad/player/p3')
    const section = await screen.findByRole('region', { name: 'Objectives' })
    await waitFor(() => expect(within(section).getByText('Shoots early from the edge')).toBeInTheDocument())
    expect(within(section).getByText('Your own · since 5 Nov')).toBeInTheDocument()
    await user().click(within(section).getByRole('button', { name: 'Edit objectives' }))
    const again = await sheet()
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled()
    // Edit: swap the coach's own for one from the library. Delete: untick it.
    await user().click(within(again).getByRole('button', { name: /^Shoots early from the edge/ }))
    await user().click(option(again, 'Presses their centre backs first'))
    await user().click(within(again).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(within(section).getByText('Presses their centre backs first')).toBeInTheDocument())
    expect(within(section).getByText('Supports: Win it back within 5 seconds · since 5 Nov')).toBeInTheDocument()
    expect(within(section).queryByText('Shoots early from the edge')).toBeNull()

    cleanup()
    renderApp('/coach/squad/player/p3')
    const reloaded = await screen.findByRole('region', { name: 'Objectives' })
    await waitFor(() => expect(within(reloaded).getByText('Presses their centre backs first')).toBeInTheDocument())
    expect(within(reloaded).getByText('Runs in behind')).toBeInTheDocument()
  }, 30_000)

  it('deletes both, and the step saves with none: Next goes on to Share without writing', async () => {
    held = [{ ...lib('Wins their headers'), id: 'o1', squad_player_id: 'p1', created_at: '2026-11-04T10:00:00Z' }]
    renderApp('/coach/squad/player/p1')
    const section = await screen.findByRole('region', { name: 'Objective' })
    await user().click(await within(section).findByRole('button', { name: 'Edit objective' }))
    const pat = await sheet()
    await user().click(option(pat, 'Wins their headers'))
    await user().click(within(pat).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saves).toEqual([{ p_squad_player_id: 'p1', p_objectives: [] }]))
    await waitFor(() => expect(within(section).getByText('No objective yet.')).toBeInTheDocument())

    cleanup()
    renderApp('/coach/season-plan/objectives')
    // TRAK-356: step 3 goes on to Share.
    await user().click(await screen.findByRole('button', { name: 'Next: Share' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan/share'))
    expect(saves).toHaveLength(1)
  }, 30_000)

  it("no position, no objective: step 3 names them apart, and their page points at Positions", async () => {
    renderApp('/coach/season-plan/objectives')
    const unplaced = await screen.findByRole('region', { name: /^No position yet/ })
    expect(within(unplaced).getByText('Synthetic Uma Unplaced')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Synthetic Uma Unplaced/ })).toBeNull()
    await user().click(within(unplaced).getByRole('button', { name: 'Go to Positions' }))
    expect(await screen.findByRole('heading', { name: /of 4 placed$/ })).toBeInTheDocument()

    cleanup()
    renderApp('/coach/squad/player/p4')
    const section = await screen.findByRole('region', { name: 'Objective' })
    expect(within(section).getByText("Give Synthetic a position first. Their objectives come from it.")).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /objective/ })).toBeNull()
  })

  it('Positions goes on to step 3', async () => {
    renderApp('/coach/season-plan/positions')
    await user().click(await screen.findByRole('button', { name: 'Next: Player objectives' }))
    expect(await screen.findByRole('heading', { name: "Everyone's objectives" })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/season-plan/objectives')
  })

  it('keeps the sheet open and says so when a save fails', async () => {
    failSaving = true
    renderApp('/coach/squad/player/p2')
    const section = await screen.findByRole('region', { name: 'Objective' })
    await user().click(await within(section).findByRole('button', { name: 'Give Synthetic an objective' }))
    const bo = await sheet()
    await user().click(option(bo, 'Scans before receiving'))
    await user().click(within(bo).getByRole('button', { name: 'Save' }))
    expect(await within(bo).findByText("Couldn't save. Check your connection and try again.")).toBeInTheDocument()
    expect(option(bo, 'Scans before receiving')).toHaveAttribute('aria-pressed', 'true')
  })

  it("isn't on the player's page where the season plan is off", async () => {
    switchOn = false
    renderApp('/coach/squad/player/p1')
    expect(await screen.findByRole('region', { name: 'About Synthetic' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Objectives?$/ })).toBeNull()
  })
})
