/**
 * TRAK-357 (Season plan 9/18, spec TRAK-348): Squad › Formations. A synthetic 18-player squad starts with the
 * mockup's three, saved once, each with eleven unique starters picked by position. Swaps by tap and by the keyboard
 * keep everyone once; Undo puts them back; the rings follow every change. Delete asks first and changes nothing else.
 * Until every player has a position, Formations says how many to place. Saves survive switching and a reload.
 * The real pointer drag is in e2e/formations.spec.ts. Synthetic people; the stand-in backend remembers.
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
type Starter = { slot: number; squad_player_id: string }
type Saved = { id: string; name: string; format: number; shape: string; formation_players: Starter[] }

let n = 0
let COACH = { id: 'coach-357' }
let squad: Row[] = []
let saved: Saved[] = []
let started = false
let starts: unknown[] = []
let saves: { p_id: string | null; p_name: string; p_shape: string; p_starters: Starter[] }[] = []
let deletes: string[] = []
let also: { squad_player_id: string; position: string }[] = []
let switchOn = true

const LINES: [string, number][] = [['Goalkeeper', 2], ['Defender', 6], ['Midfielder', 6], ['Attacker', 4]]
const players = () => LINES.flatMap(([position, count]) => Array.from({ length: count }, (_, i) => position)).map((position, i) => ({
  id: `p${i + 1}`, coach_user_id: COACH.id, player_name: `Synthetic ${position} ${String(i + 1).padStart(2, '0')}`, age_group: 'U16', status: 'active',
  shirt_number: i + 1, position, created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${i + 1}`,
}))
const keep = (body: { p_id?: string | null; p_name: string; p_format: number; p_shape: string; p_starters: Starter[] }) => {
  const id = body.p_id ?? `f${saved.length + 1}-${saves.length}`
  const row = { id, name: body.p_name, format: body.p_format, shape: body.p_shape, formation_players: body.p_starters }
  saved = body.p_id ? saved.map(f => (f.id === id ? row : f)) : [...saved, row]
  return id
}

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-357-${++n}` }
  squad = players()
  saved = []
  started = false
  starts = []
  saves = []
  deletes = []
  also = []
  switchOn = true
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json(squad)),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', args => args.p_feature !== 'season_plan' || switchOn),
    http.get(`${SUPABASE_URL}/rest/v1/squad_player_also_plays`, () => HttpResponse.json(also)),
    table('squad_player_roles', []),
    http.get(`${SUPABASE_URL}/rest/v1/formations`, () => HttpResponse.json(saved)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/start_formations`, async ({ request }) => {
      const body = await request.json() as { p_formations: { name: string; format: number; shape: string; starters: Starter[] }[] }
      starts.push(body)
      if (started) return HttpResponse.json(false)
      started = true
      for (const f of body.p_formations) keep({ p_name: f.name, p_format: f.format, p_shape: f.shape, p_starters: f.starters })
      return HttpResponse.json(true)
    }),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/save_formation`, async ({ request }) => {
      const body = await request.json() as (typeof saves)[number] & { p_format: number }
      saves.push(body)
      return HttpResponse.json(keep(body))
    }),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/delete_formation`, async ({ request }) => {
      const { p_id } = await request.json() as { p_id: string }
      deletes.push(p_id)
      saved = saved.filter(f => f.id !== p_id)
      return new HttpResponse(null, { status: 204 })
    }),
    table('coach_assessments', []),
    table('squad_player_profiles', []),
    rpc('coach_player_birth_dates', () => []),
    table('season_plans', []),
    table('session_attendance', []),
    table('coach_calendar_events', []),
    table('event_absences', []),
    table('event_confirmations', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const user = () => userEvent.setup()
const pitch = () => screen.getByRole('group', { name: /starting players\. Attacking upwards\.$/ })
const benchList = () => screen.getByRole('group', { name: 'Bench' })
const place = (slot: number) => within(pitch()).getByRole('button', { name: new RegExp(`place ${slot}\\.|^Place ${slot},`) })
const unique = (starters: Starter[]) => new Set(starters.map(s => s.squad_player_id)).size === starters.length

async function openFormations() {
  renderApp('/coach/squad?tab=formations')
  return screen.findByRole('group', { name: 'Saved formations' })
}

describe('TRAK-357 Squad › Formations', () => {
  it("a squad starts with the mockup's three, saved once, each eleven unique starters by position", async () => {
    const cards = await openFormations()
    await waitFor(() => expect(within(cards).getAllByRole('button')).toHaveLength(3))
    expect(within(cards).getAllByRole('button').map(b => b.textContent)).toEqual([
      'Attacking tactic3-4-3 · 11 starters saved', 'Park the bus5-4-1 · 11 starters saved', 'Balanced4-3-3 · 11 starters saved'])
    expect(starts).toHaveLength(1)
    for (const f of saved) expect(f.formation_players).toHaveLength(11)
    for (const f of saved) expect(unique(f.formation_players)).toBe(true)
    // By position: the keeper in goal, the back three defenders.
    expect(place(1)).toHaveAccessibleName(/^Synthetic Goalkeeper 01, Goalkeeper, place 1\. Plays here\./)
    expect(place(2)).toHaveAccessibleName(/Defender .*Plays here\./)
    expect(screen.getByText('11 starters · 7 on the bench')).toBeInTheDocument()

    cleanup()
    await openFormations()
    await waitFor(() => expect(saved).toHaveLength(3))
    // A second visit finds the three and starts nothing.
    expect(starts).toHaveLength(1)
    expect(saved).toHaveLength(3)
  }, 30_000)

  it('tap and tap, then the keyboard, swap players and keep everyone once; Undo puts them back; Save keeps it after a reload', async () => {
    await openFormations()
    await waitFor(() => expect(place(1)).toHaveAccessibleName(/^Synthetic Goalkeeper 01/))
    // Tap: the second keeper from the bench takes place 1.
    await user().click(within(benchList()).getByRole('button', { name: /^Synthetic Goalkeeper 02, bench/ }))
    expect(screen.getByText(/Synthetic Goalkeeper 02 selected\./)).toBeInTheDocument()
    await user().click(place(1))
    expect(place(1)).toHaveAccessibleName(/^Synthetic Goalkeeper 02/)
    expect(within(benchList()).getByRole('button', { name: /^Synthetic Goalkeeper 01, bench/ })).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes', { selector: 'p' })).toBeInTheDocument()

    // Keyboard: Enter on two places swaps them.
    place(2).focus()
    await user().keyboard('{Enter}')
    place(3).focus()
    await user().keyboard('{Enter}')
    const two = place(2).getAttribute('aria-label'), three = place(3).getAttribute('aria-label')
    expect(two).toMatch(/^Synthetic Defender 04/)
    expect(three).toMatch(/^Synthetic Defender 03/)

    await user().click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(place(2)).toHaveAccessibleName(/^Synthetic Defender 03/)
    await user().click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(unique(saves[0].p_starters)).toBe(true)
    expect(saves[0].p_starters.find(s => s.slot === 1)?.squad_player_id).toBe('p2')
    expect(await screen.findByText('All changes saved')).toBeInTheDocument()

    cleanup()
    await openFormations()
    await waitFor(() => expect(place(1)).toHaveAccessibleName(/^Synthetic Goalkeeper 02/))
  }, 30_000)

  it('rings follow a swap, Undo, a shape change and Can also play', async () => {
    also = [{ squad_player_id: 'p18', position: 'Midfielder' }]
    await openFormations()
    await waitFor(() => expect(place(2)).toHaveAccessibleName(/Plays here\./))
    // Attacker 18, on the bench, into the back line: out of position, in words.
    await user().click(within(benchList()).getByRole('button', { name: /^Synthetic Attacker 18, bench/ }))
    await user().click(place(2))
    expect(place(2)).toHaveAccessibleName(/^Synthetic Attacker 18, Defender, place 2\. Out of position: plays attacker, can also play midfielder\./)
    expect(screen.getByText('1 out of position')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(place(2)).toHaveAccessibleName(/Plays here\./)
    expect(screen.queryByText('1 out of position')).toBeNull()
    // Into midfield, which they can also play: no ring.
    await user().click(within(benchList()).getByRole('button', { name: /^Synthetic Attacker 18, bench/ }))
    await user().click(place(6))
    expect(place(6)).toHaveAccessibleName(/^Synthetic Attacker 18, Midfielder, place 6\. Can also play here\./)
    expect(screen.queryByText(/out of position$/)).toBeNull()
    // A new shape: 5-4-1 has one place up front for three attackers, so two drop into the back line.
    // TRAK-453: format and shape are one control, the match line-up's.
    await user().click(screen.getByRole('combobox', { name: 'Format and shape' }))
    await user().click(await screen.findByRole('option', { name: '5-4-1' }))
    expect(await screen.findByText('2 out of position')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(screen.queryByText(/out of position$/)).toBeNull()
  }, 30_000)

  it('Delete asks first, and takes only that formation', async () => {
    const cards = await openFormations()
    await waitFor(() => expect(within(cards).getAllByRole('button')).toHaveLength(3))
    await user().click(within(cards).getByRole('button', { name: /^Park the bus/ }))
    await user().click(screen.getByRole('button', { name: 'Delete formation' }))
    expect(screen.getByText('Delete Park the bus? Your other formations stay as they are.')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Keep it' }))
    expect(deletes).toEqual([])
    await user().click(screen.getByRole('button', { name: 'Delete formation' }))
    await user().click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(cards).getAllByRole('button')).toHaveLength(2))
    expect(deletes).toHaveLength(1)
    expect(saved.map(f => f.name)).toEqual(['Attacking tactic', 'Balanced'])
    expect(saved.every(f => f.formation_players.length === 11)).toBe(true)
  }, 30_000)

  it('stays shut until every player has a position, and says how many', async () => {
    squad = squad.map(p => (p.id === 'p18' || p.id === 'p17' ? { ...p, position: null } : p))
    renderApp('/coach/squad?tab=formations')
    expect(await screen.findByRole('heading', { name: 'Place 2 players to open Formations' })).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Go to Positions' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan/positions'))
    expect(starts).toEqual([])
  })

  it('a squad that had its three and deleted them gets none again', async () => {
    started = true
    renderApp('/coach/squad?tab=formations')
    expect(await screen.findByText('No formations yet')).toBeInTheDocument()
    expect(saved).toEqual([])
  })

  it("isn't there where the season plan is off: Attributes stays", async () => {
    switchOn = false
    renderApp('/coach/squad')
    const views = await screen.findByRole('radiogroup', { name: 'Squad view' }).catch(() => screen.findByRole('group', { name: 'Squad view' }))
    expect(within(views).queryByText('Formations')).toBeNull()
    expect(within(views).getByText('Attributes')).toBeInTheDocument()
    // TRAK-359: and so does Availability.
    expect(within(views).getByText('Availability')).toBeInTheDocument()
  })

  it('TRAK-359: where the season plan is on, Squad has no Availability tab', async () => {
    renderApp('/coach/squad')
    const views = await screen.findByRole('radiogroup', { name: 'Squad view' }).catch(() => screen.findByRole('group', { name: 'Squad view' }))
    expect(within(views).getByText('Formations')).toBeInTheDocument()
    expect(within(views).queryByText('Availability')).toBeNull()
  })
})
