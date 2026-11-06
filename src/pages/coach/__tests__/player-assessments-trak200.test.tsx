import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-200 (Imad, 18 Oct): a coach couldn't tell a draft from a published
 * assessment. The player's profile shows its latest assessment as Arc's card:
 * Draft or Published, the bands, the overall band, and Publish (or Published,
 * with Edit and Unpublish) on the card. Tapping it opens the quick look:
 * opponent, message, private note. History rows mark drafts.
 * TRAK-368: the player's own page in Squad (/coach/squad/player/:id) shows the
 * same card; the older /coach/player/:id page is gone.
 */
const COACH = { id: 'coach-200' }
const scores = { work_rate: 6, tactical: 6, attitude: 9, technical: 6, physical: 8, coachability: 9 }
const DRAFT = { id: 'as-draft', coach_user_id: COACH.id, squad_player_id: 'sp-1', created_at: '2026-10-18T10:00:00Z',
  published_at: null, appearance: null, ...scores,
  squad_players: { player_name: 'Ade Okafor', age_group: null }, coach_sessions: { title: 'vs Synthetic Rovers', session_date: '2026-10-17' } }
const PUBLISHED = { ...DRAFT, id: 'as-pub', created_at: '2026-10-11T10:00:00Z', published_at: '2026-10-11T10:00:00Z',
  squad_player_id: 'sp-2', squad_players: { player_name: 'Bo Lind', age_group: null }, coach_sessions: { title: 'Finishing', session_date: '2026-10-10' } }

// Calls to the one-transaction publish (Tarek's review of #364); `publishFails` makes it refuse.
let published: Record<string, unknown>[]
let publishFails: boolean
let patches: { table: string }[]

function serve(given: Record<string, unknown>[] = [DRAFT, PUBLISHED]) {
  // Copies, so a publish remembered in one test never leaks into the next.
  const rows = given.map(row => ({ ...row }))
  published = []
  publishFails = false
  patches = []
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, team: 'U16s', coach_role: 'Head Coach' }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', created_at: '2026-09-01T00:00:00Z', age_group: 'U16', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bo Lind', created_at: '2026-09-01T00:00:00Z', age_group: 'U16', status: 'active' },
    ]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_assessments`, ({ request }) => {
      const player = new URL(request.url).searchParams.get('squad_player_id')?.replace('eq.', '')
      return HttpResponse.json(player ? rows.filter(r => r.squad_player_id === player) : rows)
    }),
    table('coach_shared_feedback', [{ assessment_id: 'as-draft', body: 'Great pressing, keep your shape', published_at: null }]),
    table('coach_assessment_notes', [{ assessment_id: 'as-draft', note: 'Needs to work on composure' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('coach_calendar_events', []),
    rpc('feature_on', () => true),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('coach_squad_season', () => []),
    table('squad_player_profiles', []),
    // TRAK-353: the player's Can also play and roles; none.
    table('squad_player_also_plays', []), table('squad_player_roles', []),
    // TRAK-354: the player's objectives; none.
    table('player_objectives', []),
    table('season_plans', []),
    rpcRows('coach_player_birth_dates', []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/set_assessment_published`, async ({ request }) => {
      if (publishFails) return HttpResponse.json({ code: 'XX000', message: 'synthetic failure' }, { status: 500 })
      const call = await request.json() as { p_assessment_id: string; p_published: boolean }
      published.push(call)
      // The page reads the history again after a change, so the stand-in remembers it.
      for (const row of rows) if (row.id === call.p_assessment_id) row.published_at = call.p_published ? '2026-10-19T12:00:00Z' : null
      return HttpResponse.json('2026-10-19T12:00:00Z')
    }),
    // The card never writes the two tables one by one any more.
    ...['coach_assessments', 'coach_shared_feedback'].map(name =>
      http.patch(`${SUPABASE_URL}/rest/v1/${name}`, () => { patches.push({ table: name }); return HttpResponse.json([]) })),
  )
}

beforeEach(() => signInAs(COACH))
afterEach(() => cleanup())

describe("TRAK-200: the assessment card on the coach's player profile", () => {
  const onlyAde = () => server.use(table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', created_at: '2026-09-01T00:00:00Z', age_group: 'U16', status: 'active' }]))

  it('a draft says Draft, offers Publish, and opens a quick look with the opponent, message and private note', async () => {
    serve(); onlyAde()
    renderApp('/coach/squad/player/sp-1')
    const card = await screen.findByRole('article', { name: /Draft/ })
    expect(within(card).getByRole('heading', { name: 'Draft' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    expect(within(card).queryByText('Needs to work on composure')).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Draft' }))
    const look = await screen.findByRole('dialog')
    expect(within(look).getByText('vs Synthetic Rovers')).toBeInTheDocument()
    expect(within(look).getByText('Great pressing, keep your shape')).toBeInTheDocument()
    expect(within(look).getByText('Needs to work on composure')).toBeInTheDocument()
    expect(within(look).getByRole('button', { name: 'Close quick look' })).toBeInTheDocument()
  }, 20_000)

  it('Publish on the card publishes the bands and the message, and the card says Published', async () => {
    serve(); onlyAde()
    renderApp('/coach/squad/player/sp-1')
    const card = await screen.findByRole('article', { name: /Draft/ })
    await userEvent.click(within(card).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(published).toEqual([{ p_assessment_id: 'as-draft', p_published: true }]))
    expect(patches).toEqual([])
    expect(await within(card).findByRole('heading', { name: 'Published' })).toBeInTheDocument()
  }, 20_000)

  it("Unpublish, from a published card's menu, hides the bands and the message again", async () => {
    serve([{ ...DRAFT, published_at: '2026-10-18T11:00:00Z' }]); onlyAde()
    renderApp('/coach/squad/player/sp-1')
    const card = await screen.findByRole('article', { name: /Published/ })
    await userEvent.click(within(card).getByRole('button', { name: 'Published more actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unpublish' }))
    await waitFor(() => expect(published).toEqual([{ p_assessment_id: 'as-draft', p_published: false }]))
    expect(await within(card).findByRole('heading', { name: 'Draft' })).toBeInTheDocument()
  }, 20_000)

  // Tarek's review of #364, finding 1: a refused publish changes nothing, and the card says so truthfully.
  it('a refused publish leaves the card a Draft and says Not published', async () => {
    serve(); onlyAde(); publishFails = true
    renderApp('/coach/squad/player/sp-1')
    const card = await screen.findByRole('article', { name: /Draft/ })
    await userEvent.click(within(card).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText(/Not published/)).toBeInTheDocument()
    expect(within(card).getByRole('heading', { name: 'Draft' })).toBeInTheDocument()
  }, 20_000)

  // Finding 2: a failed message read is not "no message". Publish still goes through the one call
  // (which publishes the message server-side), and the quick look says the message didn't load.
  it('a failed message read still publishes the message, and the quick look says it did not load', async () => {
    serve(); onlyAde()
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => HttpResponse.json({ message: 'offline' }, { status: 500 })))
    renderApp('/coach/squad/player/sp-1')
    const card = await screen.findByRole('article', { name: /Draft/ })
    await userEvent.click(within(card).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(published).toEqual([{ p_assessment_id: 'as-draft', p_published: true }]))
    // (jsdom never finishes the quick look's closing animation, so it's opened last.)
    await userEvent.click((await within(card).findByRole('heading', { name: 'Published' })).querySelector('button')!)
    expect(await within(await screen.findByRole('dialog')).findByText(/Couldn't load the message/)).toBeInTheDocument()
    expect(screen.queryByText('No message')).toBeNull()
  }, 20_000)
})
