/**
 * TRAK-285 (Games 3/8): plan step 2, line-up and jobs. "Can't make it" players can't be placed; a slot holds one player
 * and a player one slot; bench and not selected come back after a reload; the progress counts starters with a job. A
 * child waiting for consent is nowhere. TRAK-329: the formation is one dropdown on the pitch, grouped by format.
 * TRAK-330 (Imad, 2 Nov): each slot is an Arc morph select, and everyone in the match squad is in a table under the
 * pitch, by their own position, where the job, context and expectation are set. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-285' }

function game() {
  const kickOff = Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_theme: null, cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number, age_group = 'U16', position: string | null = 'Midfielder') =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group, status: 'active', shirt_number: shirt, position, created_at: '2026-10-01T08:00:00Z' })

/** The plan and its line-up as the database keeps them, written by the app's upserts. */
function store() {
  const plans = new Map<string, Record<string, unknown>>()
  const lineUp = new Map<string, Record<string, unknown>>()
  const saves: Record<string, unknown>[][] = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, () => HttpResponse.json([...plans.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      plans.set(body.event_id as string, { ...body, created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z' })
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => HttpResponse.json([...lineUp.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      const rows = await request.json() as Record<string, unknown>[]
      saves.push(rows)
      for (const row of rows) lineUp.set(row.squad_player_id as string, row)
      return new HttpResponse(null, { status: 201 })
    }),
  )
  return { saves, plans }
}

beforeEach(() => {
  COACH = { id: `coach-285-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9, 'U16', null),
      child('karagounis', 'Giorgos Karagounis', 10), child('nikopolidis', 'Antonios Nikopolidis', 1, 'U16', 'Goalkeeper'),
      child('basinas', 'Angelos Basinas', 6), child('katsouranis', 'Kostas Katsouranis', 8, 'U14'),
    ]),
    // Zagorakis is confirmed; Nikopolidis's family said he can't make it; Karagounis waits for consent.
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }]),
    table('event_absences', [{ squad_player_id: 'nikopolidis' }]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'karagounis'),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('coach_calendar_events', [game()]),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

async function openLineUp(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/coach/matches/g1?tab=plan')
  await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
  return screen.findByRole('heading', { name: '4-4-2' })
}
const slot = (number: number) => screen.getByRole('combobox', { name: new RegExp(`slot ${number}(,|$)`, 'i') })
async function pick(user: ReturnType<typeof userEvent.setup>, slotNumber: number, name: RegExp) {
  await user.click(slot(slotNumber))
  await user.click(await screen.findByRole('option', { name }))
}
const squad = () => screen.getByRole('table', { name: 'The match squad' })
const rowFor = (name: string) => within(squad()).getAllByRole('row').find(row => row.textContent?.includes(name))!
/** The players under one subheader, top to bottom. */
const inGroup = (label: string) => within(within(squad()).getAllByRole('rowgroup').find(group => group.querySelector('th')?.textContent === label)!)
  .getAllByRole('row').slice(1).map(row => ['Angelos Basinas', 'Theodoros Zagorakis', 'Angelos Charisteas', 'Antonios Nikopolidis'].find(name => row.textContent?.includes(name)))
/** Types into a player's job (or, left out, their note) in the table and saves it with Enter, as Arc's inline edit does. */
async function writeIn(user: ReturnType<typeof userEvent.setup>, player: string, label: string, text: string) {
  await user.click(within(rowFor(player)).getByRole('button', { name: new RegExp(`^${label}`) }))
  await user.type(screen.getByRole('textbox', { name: label }), `${text}{Enter}`)
}

describe('TRAK-285, TRAK-330: plan step 2, line-up and jobs', { timeout: 30_000 }, () => {
  it('lists who can come, Confirmed first; "Can\'t make it" can\'t be placed, and a child waiting for consent is nowhere', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await user.click(slot(1))
    const options = await screen.findAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'Theodoros Zagorakis', 'Angelos Basinas · not confirmed', 'Angelos Charisteas · not confirmed', "Antonios Nikopolidis · can't make it",
    ])
    expect(options[3]).toHaveAttribute('aria-disabled', 'true')
    await user.click(options[3])
    expect(slot(1)).toHaveAccessibleName('Slot 1, empty')
    expect(screen.queryByText(/Karagounis/)).toBeNull()
    expect(screen.queryByText(/Katsouranis/)).toBeNull()
    // In the table, who can't make it says so, with nothing to set. Never the reason.
    const keeper = rowFor('Antonios Nikopolidis')
    expect(keeper).toHaveTextContent('Can’t make it')
    expect(within(keeper).queryByRole('button')).toBeNull()
  })

  it('a slot holds one player and a player one slot; a filled slot offers Take off the pitch first', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 1, /^Theodoros Zagorakis/)
    expect(slot(1)).toHaveAccessibleName('Theodoros Zagorakis, slot 1')

    await user.click(slot(1))
    expect((await screen.findAllByRole('option'))[0]).toHaveTextContent('Take off the pitch')
    await user.keyboard('{Escape}')

    // Picking a player already on the pitch for another slot moves them.
    await pick(user, 2, /^Theodoros Zagorakis · on the pitch/)
    expect(slot(1)).toHaveAccessibleName('Slot 1, empty')
    expect(slot(2)).toHaveAccessibleName('Theodoros Zagorakis, slot 2')
    expect(within(rowFor('Theodoros Zagorakis')).getByRole('button', { name: 'Theodoros Zagorakis: Starting · Defender' })).toBeInTheDocument()

    await pick(user, 2, /^Take off the pitch/)
    expect(slot(2)).toHaveAccessibleName('Slot 2, empty')
    expect(within(rowFor('Theodoros Zagorakis')).getByRole('button', { name: 'Theodoros Zagorakis: Bench' })).toBeInTheDocument()
  })

  it('bench and not selected come back after a reload; a player left out keeps only a note', async () => {
    const user = userEvent.setup()
    const { saves } = store()
    await openLineUp(user)
    await user.click(within(rowFor('Angelos Charisteas')).getByRole('button', { name: 'Angelos Charisteas: Bench' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Not selected' }))
    expect(within(rowFor('Angelos Charisteas')).queryByRole('button', { name: /^Job/ })).toBeNull()
    await writeIn(user, 'Angelos Charisteas', 'Note to Angelos · only Angelos sees it', 'Not this week. Your chance comes Tuesday.')
    await writeIn(user, 'Angelos Basinas', 'Job · only Angelos sees it', 'Be ready to come on at half-time.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves.at(-1)).toEqual([
      { event_id: 'g1', squad_player_id: 'charisteas', role: 'not_selected', slot: null, job: '', note: 'Not this week. Your chance comes Tuesday.', context: [], expectation: 'usual' },
      { event_id: 'g1', squad_player_id: 'basinas', role: 'bench', slot: null, job: 'Be ready to come on at half-time.', note: '', context: [], expectation: 'usual' },
    ])

    cleanup()
    await openLineUp(user)
    expect(within(rowFor('Angelos Charisteas')).getByRole('button', { name: 'Angelos Charisteas: Not selected' })).toBeInTheDocument()
    expect(rowFor('Angelos Charisteas')).toHaveTextContent('Not this week. Your chance comes Tuesday.')
    expect(rowFor('Angelos Basinas')).toHaveTextContent('Be ready to come on at half-time.')
  })

  it('TRAK-330: no jobs bar (Imad, 2 Nov): sorting by Job lists who has one first and who has none last, in each position', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    expect(screen.queryByRole('progressbar', { name: /starters have a job/ })).toBeNull()
    await writeIn(user, 'Theodoros Zagorakis', 'Job · only Theodoros sees it', 'Win the second balls.')
    // Midfielders by shirt number: Basinas (6), Zagorakis (7). By Job, Zagorakis has one, so he comes first either way.
    expect(inGroup('Midfielders')).toEqual(['Angelos Basinas', 'Theodoros Zagorakis'])
    await user.click(screen.getByRole('button', { name: 'Sort by Job' }))
    expect(inGroup('Midfielders')).toEqual(['Theodoros Zagorakis', 'Angelos Basinas'])
    await user.click(screen.getByRole('button', { name: 'Sort by Job, currently ascending' }))
    expect(inGroup('Midfielders')).toEqual(['Theodoros Zagorakis', 'Angelos Basinas'])
  })

  it('TRAK-317: a starter expected to stretch shows yellow on the pitch, with a key and "stretch" in the slot\'s name', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 3, /Zagorakis/)
    expect(slot(3)).toHaveAccessibleName('Theodoros Zagorakis, slot 3')
    expect(screen.queryByText('Yellow: stretch')).toBeNull()
    await user.click(within(rowFor('Theodoros Zagorakis')).getByRole('button', { name: 'Expectation, Theodoros Zagorakis: Usual' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Stretch' }))
    expect(slot(3)).toHaveAccessibleName('Theodoros Zagorakis, slot 3, stretch')
    expect(slot(3).querySelector('[data-stretch]')).not.toBeNull()
    expect(screen.getByText('Yellow: stretch')).toBeVisible()
  })

  it('TRAK-330: context ticks several tags from one menu, and Save draft writes them', async () => {
    const user = userEvent.setup()
    const { saves } = store()
    await openLineUp(user)
    await pick(user, 1, /^Theodoros Zagorakis/)
    await user.click(within(rowFor('Theodoros Zagorakis')).getByRole('button', { name: 'Context, Theodoros Zagorakis: None' }))
    await user.click(await screen.findByRole('menuitem', { name: 'First start' }))
    await user.click(screen.getByRole('menuitem', { name: 'Out of position' }))
    await user.keyboard('{Escape}')
    expect(within(rowFor('Theodoros Zagorakis')).getByRole('button', { name: 'Context, Theodoros Zagorakis: Out of position, First start' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves.at(-1)).toEqual([expect.objectContaining({ squad_player_id: 'zagorakis', role: 'starter', slot: 1,
      context: expect.arrayContaining(['first_start', 'out_of_position']) })])
  })

  it('TRAK-330: the table lists the whole match squad under each player\'s own position, and sorts inside each', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    // The side panel and the old lists are gone: the table covers them.
    for (const name of ['Everyone’s job', 'Not selected', 'Can’t make it']) expect(screen.queryByRole('region', { name })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Selected player' })).toBeNull()
    const table = squad()
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['No', 'Name', 'Availability', 'Job', 'Context', 'Expectation'])
    expect(within(table).getAllByRole('rowheader').map(header => header.textContent)).toEqual(['Goalkeepers', 'Midfielders', 'Position not recorded'])
    const midfield = () => within(within(table).getAllByRole('rowgroup').find(group => group.textContent?.startsWith('Midfielders'))!)
      .getAllByRole('row').slice(1).map(row => row.textContent)
    // By shirt number first: Basinas (6), then Zagorakis (7).
    expect(midfield().map(text => text?.includes('Basinas') ? 'Basinas' : 'Zagorakis')).toEqual(['Basinas', 'Zagorakis'])
    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    await user.click(screen.getByRole('button', { name: 'Sort by Name, currently ascending' }))
    expect(midfield().map(text => text?.includes('Basinas') ? 'Basinas' : 'Zagorakis')).toEqual(['Zagorakis', 'Basinas'])
    expect(within(table).getAllByRole('rowheader').map(header => header.textContent)).toEqual(['Goalkeepers', 'Midfielders', 'Position not recorded'])
  })

  it('TRAK-329: one formation dropdown on the pitch, a header per format; a shape in a smaller format benches the starters it has no slot for', async () => {
    const user = userEvent.setup()
    const { saves, plans } = store()
    await openLineUp(user)
    expect(screen.queryByRole('region', { name: 'Format and formation' })).toBeNull()
    await pick(user, 10, /^Theodoros Zagorakis/)
    await pick(user, 11, /^Angelos Basinas/)

    const formation = screen.getByRole('combobox', { name: 'Formation' })
    expect(formation).toHaveTextContent('4-4-2')
    await user.click(formation)
    const list = await screen.findByRole('listbox', { name: 'Formation' })
    expect(within(list).getAllByRole('group').map(group => within(group).getAllByRole('option')[0].textContent)).toEqual(['4-4-2', '3-3-2', '2-3-1', '2-2'])
    for (const name of ['11 a side', '9 a side', '7 a side', '5 a side']) expect(within(list).getByRole('group', { name })).toBeInTheDocument()
    await user.click(within(within(list).getByRole('group', { name: '9 a side' })).getByRole('option', { name: '3-3-2' }))

    expect(await screen.findByRole('heading', { name: '3-3-2' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Formation' })).toHaveTextContent('3-3-2')
    // Nine a side has no slots 10 and 11, so those two starters are on the bench.
    expect(screen.queryByRole('combobox', { name: /slot 10(,|$)/i })).toBeNull()
    expect(within(rowFor('Theodoros Zagorakis')).getByRole('button', { name: 'Theodoros Zagorakis: Bench' })).toBeInTheDocument()
    expect(within(rowFor('Angelos Basinas')).getByRole('button', { name: 'Angelos Basinas: Bench' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(plans.get('g1')).toMatchObject({ format: 9, formation: '3-3-2' })
    expect(saves.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ squad_player_id: 'zagorakis', role: 'bench', slot: null }),
      expect.objectContaining({ squad_player_id: 'basinas', role: 'bench', slot: null }),
    ]))
  })
})
