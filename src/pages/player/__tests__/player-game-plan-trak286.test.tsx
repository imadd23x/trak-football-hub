/**
 * TRAK-286 (Games 4/8): once the coach shares the plan, the player's event page shows it: the goals, their job and the
 * coach's note to them, drawn by the same section the coach's Share step previews. A later share that changed their
 * plan reads "Updated" on the page and the event card until kick-off. Nothing shows before it's shared. Test people
 * are named after footballers.
 */
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { GamePlanSection } from '@/components/player/GamePlanSection'
import { planToForm } from '@/lib/games/plan'
import { previewOf } from '@/lib/games/share'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

let n = 0
let PLAYER = { id: 'zagorakis-user' }
const MATCH = {
  id: 'g1', coach_user_id: 'coach-1', published: true, event_type: 'match', title: 'League', opponent: 'Parkview Athletic',
  home_away: 'home', event_date: '2099-11-14', start_time: '10:00:00', starts_at: '2099-11-14T06:00:00Z', venue: 'Rehearsal Park',
  meet_time: null, kit: null, status: 'scheduled', cancel_reason: null, sequence: 0, family_note: null,
}
const GOALS = [{ title: 'Win the second ball', looks_like: 'First to every loose ball in midfield.' }]
// What Share wrote for Theodoros Zagorakis (game_for_family, game_for_player).
// TRAK-319: the family's copy holds the role only; the job is in the child's own copy.
const FAMILY = { event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', job: '', has_note: false,
  shared_at: '2099-11-10T15:30:00Z', changed_at: null, coach_name: 'Otto Rehhagel' }
const OWN = { event_id: 'g1', squad_player_id: 'zagorakis', goals: GOALS, job: 'Stay tight to their winger.', note: '',
  shared_at: '2099-11-10T15:30:00Z', changed_at: null }

function setup({ family = [FAMILY], own = [OWN], events = [MATCH] }: { family?: object[]; own?: object[]; events?: object[] } = {}) {
  // TRAK-300: a player reads only their own profile, never the coach's (the database's rule); the name for the note
  // comes with the copy.
  const profiles = [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Theodoros Zagorakis' }]
  server.use(
    table('game_for_family', family as Record<string, unknown>[]),
    table('game_for_player', own as Record<string, unknown>[]),
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const asked = new URL(request.url).searchParams.get('user_id') ?? ''
      const rows = profiles.filter(profile => asked.includes(profile.user_id))
      return (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(rows[0] ?? null) : HttpResponse.json(rows)
    }),
    table('matches', []), table('player_details', []), table('coach_assessments', []), table('recognition_awards', []),
    table('squad_players', [{ id: 'zagorakis', coach_user_id: 'coach-1' }]),
    table('event_absences', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('family_training_history', () => []),
    rpcRows('child_events', events as Record<string, unknown>[]),
    rpc('my_consent_status', () => ({ required: false, age: 14, consent_age: 15, threshold: 18, own_choice: null })),
  )
}

beforeEach(() => { PLAYER = { id: `zagorakis-user-${++n}` }; signInAs(PLAYER) })
afterEach(() => cleanup())

describe('TRAK-286: the shared game plan on the player\'s event page', { timeout: 30_000 }, () => {
  it('shows the goals and their job from their own copy, exactly as the coach\'s preview does', async () => {
    setup()
    renderApp('/player/event/g1')
    const section = await screen.findByRole('region', { name: 'Game plan' })
    expect(within(section).getByText('1 · Win the second ball')).toBeInTheDocument()
    expect(within(section).getByText('Your job')).toBeInTheDocument()
    expect(within(section).getByText('Stay tight to their winger.')).toBeInTheDocument()
    expect(within(section).queryByText('Updated')).toBeNull()
    const page = section.textContent
    cleanup()

    // The coach's preview of the same plan, from what they typed (ShareStep draws previewOf with this section).
    const form = planToForm({ strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11,
      formation: '4-4-2', goals: GOALS }, [{ squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
      note: 'Second game at right-back. Proud of you.', context: ['out_of_position'], expectation: 'stretch' }])
    render(<GamePlanSection as="player" coachName="Otto Rehhagel" childName="Theodoros" plan={previewOf(form, 'zagorakis', 'player')} />)
    expect(screen.getByRole('region', { name: 'Game plan' }).textContent).toBe(page)
  })

  it('a later share that changed their plan reads Updated on the event card and the page', async () => {
    setup({ own: [{ ...OWN, changed_at: '2099-11-12T09:00:00Z' }] })
    renderApp('/player/matches')
    const card = await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('link', { name: /Parkview/ })
    expect(await within(card).findByText('Updated')).toBeInTheDocument()
    cleanup()
    renderApp('/player/event/g1')
    expect(await within(await screen.findByRole('region', { name: 'Game plan' })).findByText('Updated')).toBeInTheDocument()
  })

  it('after kick-off Updated goes: the card says Plan shared', async () => {
    const played = { ...MATCH, event_date: '2026-10-01', starts_at: '2026-10-01T06:00:00Z' }
    setup({ family: [{ ...FAMILY, changed_at: '2026-09-30T09:00:00Z' }], events: [played] })
    renderApp('/player/matches')
    const card = await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('link', { name: /Parkview/ })
    expect(await within(card).findByText('Plan shared')).toBeInTheDocument()
    expect(within(card).queryByText('Updated')).toBeNull()
  })

  it('before it\'s shared, there is no game plan and no badge', async () => {
    setup({ family: [], own: [] })
    renderApp('/player/matches')
    const card = await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('link', { name: /Parkview/ })
    expect(within(card).queryByText('Plan shared')).toBeNull()
    cleanup()
    renderApp('/player/event/g1')
    await screen.findByRole('heading', { name: /Parkview/ })
    expect(screen.queryByRole('region', { name: 'Game plan' })).toBeNull()
  })
})
