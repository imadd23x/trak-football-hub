/**
 * TRAK-360 (Season plan 12/18, spec TRAK-348): Squad › Formations into matches. Use for matches lists the squad's
 * upcoming matches (not past ones, not another squad's) and asks before it replaces a saved line-up; Make default sets
 * and removes the default for the format; Set for matchday lists the matches a formation was copied to. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

vi.mock('sonner', async importOriginal => ({ ...(await importOriginal<typeof import('sonner')>()), toast: vi.fn() }))

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


type Call = { rpc: string; body: Record<string, unknown> }
let calls: Call[] = []
let copies: unknown[] = []
const DAY = 24 * 60 * 60_000
const match = (id: string, opponent: string, squadName: string, startsIn: number) => {
  const start = new Date(Math.ceil((Date.now() + startsIn) / 60_000) * 60_000)
  const at = new Date(start.getTime() + 4 * 60 * 60_000).toISOString()
  return { id, coach_user_id: COACH.id, squad: squadName, title: `vs ${opponent}`, event_type: 'match', published: true, status: 'scheduled',
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(), event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`,
    opponent, home_away: 'home', venue: null, competition: null }
}

beforeEach(() => {
  calls = []
  copies = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/formations`, () => HttpResponse.json(saved.map(f => ({ ...f, formation_copies: copies })))),
    table('coach_calendar_events', [
      match('m-alpha', 'Alpha', 'U16', 3 * DAY), match('m-beta', 'Beta', 'U16', 5 * DAY),
      match('m-past', 'Past', 'U16', -2 * DAY), match('m-u14', 'Younger', 'U14', 4 * DAY),
      // A coach with one squad doesn't pick one, so a match can have none stored.
      { ...match('m-none', 'Nosquad', 'U16', 6 * DAY), squad: null },
    ]),
    http.get(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => HttpResponse.json([{ event_id: 'm-beta' }])),
    ...['use_formation_for_matches', 'undo_formation_copy', 'set_default_formation'].map(name => http.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, async ({ request }) => {
      calls.push({ rpc: name, body: await request.json() as Record<string, unknown> })
      return HttpResponse.json([])
    })),
  )
})

const seeded = (extra: Partial<Saved> & { is_default?: boolean } = {}) => {
  saved = [{ id: 'f1', name: 'Balanced', format: 11, shape: '4-4-2', formation_players: [{ slot: 1, squad_player_id: 'p1' }], ...extra } as Saved]
  started = true
}

describe('TRAK-360 Squad › Formations into matches', () => {
  it('Use for matches lists the squad\'s upcoming matches, asks before replacing a saved line-up, then copies', async () => {
    seeded()
    const u = user()
    await openFormations()
    await u.click(await screen.findByRole('button', { name: 'Use for a match' }))
    const list = await screen.findByRole('group', { name: 'Upcoming matches' })
    expect(within(list).getAllByRole('checkbox').map(box => box.getAttribute('id') && (box.closest('div')?.textContent ?? ''))).toHaveLength(3)
    expect(within(list).getByText(/vs Nosquad/)).toBeInTheDocument()
    expect(within(list).getByText(/vs Alpha/)).toBeInTheDocument()
    expect(within(list).queryByText(/vs Past/)).toBeNull()
    expect(within(list).queryByText(/vs Younger/)).toBeNull()
    expect(within(list).getByText(/has a saved line-up/)).toBeInTheDocument()
    await u.click(within(list).getByRole('checkbox', { name: /vs Alpha/ }))
    await u.click(within(list).getByRole('checkbox', { name: /vs Beta/ }))
    await u.click(screen.getByRole('button', { name: 'Copy to 2 matches' }))
    // Beta has a saved line-up: asked first, nothing sent yet.
    expect(await screen.findByText('Replace the line-up in vs Beta?')).toBeInTheDocument()
    expect(calls).toEqual([])
    await u.click(screen.getByRole('button', { name: 'Replace and copy' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ rpc: 'use_formation_for_matches', body: { p_formation_id: 'f1', p_event_ids: ['m-alpha', 'm-beta'] } })
    // TRAK-453: the message stays on the page, with an Undo button and a way to close it.
    const banner = await screen.findByText(/ copied to 2 matches\.$/)
    expect(banner).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  }, 30_000)

  it('copying into a match with no saved line-up asks nothing', async () => {
    seeded()
    const u = user()
    await openFormations()
    await u.click(await screen.findByRole('button', { name: 'Use for a match' }))
    await u.click(await screen.findByRole('checkbox', { name: /vs Alpha/ }))
    await u.click(screen.getByRole('button', { name: 'Copy to 1 match' }))
    await waitFor(() => expect(calls).toEqual([{ rpc: 'use_formation_for_matches', body: { p_formation_id: 'f1', p_event_ids: ['m-alpha'] } }]))
    expect(await screen.findByText(/ copied to 1 match\.$/)).toBeInTheDocument()
  }, 30_000)

  // TRAK-453: the page keeps the message with an Undo button that sends the same matches back, and says it was undone.
  it('Undo, on the page after a copy, sends the same matches to undo_formation_copy and clears the message', async () => {
    vi.mocked(toast).mockClear()
    seeded()
    const u = user()
    await openFormations()
    await u.click(await screen.findByRole('button', { name: 'Use for a match' }))
    await u.click(await screen.findByRole('checkbox', { name: /vs Alpha/ }))
    await u.click(screen.getByRole('button', { name: 'Copy to 1 match' }))
    await screen.findByText(/ copied to 1 match\.$/)
    await u.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.at(-1)).toEqual({ rpc: 'undo_formation_copy', body: { p_formation_id: 'f1', p_event_ids: ['m-alpha'] } }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Undone\. /)))
    await waitFor(() => expect(screen.queryByText(/ copied to 1 match\.$/)).toBeNull())
  }, 30_000)

  it('the copy message stays until it is closed, and closing it keeps the copy', async () => {
    seeded()
    const u = user()
    await openFormations()
    await u.click(await screen.findByRole('button', { name: 'Use for a match' }))
    await u.click(await screen.findByRole('checkbox', { name: /vs Alpha/ }))
    await u.click(screen.getByRole('button', { name: 'Copy to 1 match' }))
    await screen.findByText(/ copied to 1 match\.$/)
    await new Promise(resolve => setTimeout(resolve, 1500)) // no timer takes it away
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /^Dismiss: / }))
    await waitFor(() => expect(screen.queryByText(/ copied to 1 match\.$/)).toBeNull())
    expect(calls.some(call => call.rpc === 'undo_formation_copy')).toBe(false)
  }, 30_000)

  it('Make default sets it for the format', async () => {
    seeded()
    const u = user()
    await openFormations()
    await u.click(await screen.findByRole('button', { name: 'Make default for 11 a side' }))
    await waitFor(() => expect(calls).toEqual([{ rpc: 'set_default_formation', body: { p_id: 'f1', p_default: true } }]))
  }, 30_000)

  it('a default shows its badge and can be removed', async () => {
    seeded({ is_default: true } as Partial<Saved>)
    const u = user()
    await openFormations()
    expect(await screen.findByText('Default for 11 a side')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Remove default' }))
    await waitFor(() => expect(calls).toEqual([{ rpc: 'set_default_formation', body: { p_id: 'f1', p_default: false } }]))
  }, 30_000)

  it('Set for matchday lists the matches it was copied to, with who wasn\'t coming', async () => {
    seeded()
    copies = [{ event_id: 'm-alpha', copied_at: '2026-11-07T10:00:00Z', not_coming: 2, skipped: 1, coach_calendar_events: { opponent: 'Alpha', title: 'vs Alpha' } }]
    await openFormations()
    const section = await screen.findByRole('region', { name: 'Set for matchday' })
    expect(within(section).getByText(/vs Alpha · copied Sat 7 Nov · 2 players not coming · 1 skipped/)).toBeInTheDocument()
  })

  // TRAK-452 (11 Nov walk-through): no Set for matchday block until the formation has been copied to a match.
  it('Set for matchday stays hidden when nothing was copied; Use for a match is ready', async () => {
    seeded()
    await openFormations()
    expect(await screen.findByRole('button', { name: 'Use for a match' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Set for matchday' })).toBeNull()
    expect(screen.queryByText(/Not copied to a match yet/)).toBeNull()
  })
})
