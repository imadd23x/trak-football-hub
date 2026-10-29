/**
 * TRAK-289 (Games 7/8): once the coach publishes the evaluation, the player's event page shows After the game: their
 * job, how it went against what was asked in TRAK-282's words, and the coach's note to them, drawn by the same section
 * the coach's Publish step previews. The event card says Coach's review. In match history the game shows Coach's
 * review, not a band, and opens its event page. Nothing shows before it's published. Test people are named after
 * footballers.
 */
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { GameReviewSection } from '@/components/player/GameReviewSection'
import { evaluationToForm, previewReview } from '@/lib/games/evaluation'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

let n = 0
let PLAYER = { id: 'zagorakis-user' }
// Played this morning, so it's still on the Upcoming list today.
const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10)
const MATCH = {
  id: 'g1', coach_user_id: 'coach-1', published: true, event_type: 'match', title: 'League', opponent: 'Parkview Athletic',
  home_away: 'home', event_date: today, start_time: '00:01:00', starts_at: `${today}T00:01:00+04:00`, venue: 'Rehearsal Park',
  meet_time: null, kit: null, status: 'scheduled', cancel_reason: null, sequence: 0, family_note: null,
}
// What Publish wrote for Theodoros Zagorakis (game_review_for_family, game_review_for_player).
const REVIEW = { event_id: 'g1', session_id: 's1', squad_player_id: 'zagorakis', our_score: 2, their_score: 1, job: 'Stay tight to their winger.',
  did_job: 'partly', expectation: 'stretch', context: ['out_of_position'], against_expectation: 'above', has_note: true, coach_name: 'Otto Rehhagel',
  published_at: `${today}T08:00:00Z` }
const NOTE = { event_id: 'g1', squad_player_id: 'zagorakis', note: 'Brave all game.' }
// The match row publish wrote: no rating.
const MATCH_ROW = { id: 'm1', user_id: 'x', session_id: 's1', opponent: 'Parkview Athletic', team_score: 2, opponent_score: 1, competition: 'League',
  venue: 'Home', match_date: today, created_at: `${today}T08:00:00Z`, computed_rating: null, goals: 1, assists: 0 }

function setup({ reviews = [REVIEW], notes = [NOTE], matches = [] as object[] } = {}) {
  const profiles = [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Theodoros Zagorakis' }]
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/game_review_for_family`, ({ request }) =>
      (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(reviews[0] ?? null) : HttpResponse.json(reviews)),
    table('game_review_for_player', notes as Record<string, unknown>[]),
    table('game_for_family', []), table('game_for_player', []),
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const asked = new URL(request.url).searchParams.get('user_id') ?? ''
      const rows = profiles.filter(profile => asked.includes(profile.user_id))
      return (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(rows[0] ?? null) : HttpResponse.json(rows)
    }),
    table('matches', matches as Record<string, unknown>[]), table('player_details', []), table('coach_assessments', []), table('recognition_awards', []),
    table('squad_players', [{ id: 'zagorakis', coach_user_id: 'coach-1' }]),
    table('event_absences', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('family_training_history', () => []),
    rpcRows('child_events', [MATCH]),
    rpc('my_consent_status', () => ({ required: false, age: 14, consent_age: 15, threshold: 18, own_choice: null })),
  )
}

beforeEach(() => { PLAYER = { id: `zagorakis-user-${++n}` }; signInAs(PLAYER) })
afterEach(() => cleanup())

describe('TRAK-289: After the game on the player\'s pages', { timeout: 30_000 }, () => {
  it('shows their job, how it went in TRAK-282\'s words and the note just for them, exactly as the coach\'s preview does', async () => {
    setup()
    renderApp('/player/event/g1')
    const section = await screen.findByRole('region', { name: 'After the game' })
    expect(section).toHaveTextContent('Final score 2–1')
    expect(within(section).getByText('Your job')).toBeInTheDocument()
    expect(within(section).getByText('Stay tight to their winger.')).toBeInTheDocument()
    expect(within(section).getByText('You did part of your job')).toBeInTheDocument()
    expect(within(section).getByText('What we asked: A big ask today. A solid job is a good game. (out of position)')).toBeInTheDocument()
    expect(within(section).getByText('Went beyond what we asked.')).toBeInTheDocument()
    expect(await within(section).findByRole('heading', { name: 'From Coach Otto Rehhagel · just for you' })).toBeInTheDocument()
    expect(within(section).getByText('Brave all game.')).toBeInTheDocument()
    const page = section.textContent
    cleanup()

    // The coach's preview of the same review, from the draft and the plan as it locked (PublishStep draws this).
    const form = { ...evaluationToForm({ evaluation: { our_score: 2, their_score: 1, goals: [], how_they_scored: '', plan_worked: [] },
      players: [{ squad_player_id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above' }],
      notes: [{ squad_player_id: 'zagorakis', note: 'Brave all game.' }] }) }
    const plans = { zagorakis: { role: 'starter' as const, slot: 4, job: 'Stay tight to their winger.', note: '', context: ['out_of_position'], expectation: 'stretch' as const } }
    render(<GameReviewSection as="player" childName="Theodoros" review={previewReview(form, 'zagorakis', plans, 'Otto Rehhagel', 'player')} />)
    expect(screen.getByRole('region', { name: 'After the game' }).textContent).toBe(page)
  })

  it('the event card says Coach\'s review', async () => {
    setup()
    renderApp('/player/matches')
    const card = await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('link', { name: /Parkview/ })
    expect(await within(card).findByText('Coach’s review')).toBeInTheDocument()
  })

  it('in match history the game shows Coach\'s review, not a band, and opens its event page', async () => {
    const user = userEvent.setup()
    setup({ matches: [MATCH_ROW] })
    renderApp('/player/matches')
    const row = await screen.findByRole('button', { name: /vs Parkview Athletic/ })
    expect(await within(row).findByText('Coach’s review')).toBeInTheDocument()
    await user.click(row)
    await waitFor(() => expect(window.location.pathname).toBe('/player/event/g1'))
  })

  it('before it\'s published there is no After the game and no badge', async () => {
    setup({ reviews: [], notes: [] })
    renderApp('/player/event/g1')
    await screen.findByRole('heading', { name: /Parkview/ })
    expect(screen.queryByRole('region', { name: 'After the game' })).toBeNull()
  })
})
