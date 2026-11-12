/**
 * TRAK-229 (Kostas, 22 Oct, option A): the bands have colours made for Trak's
 * light screens, so assessments sit on light cards like everything else. This
 * replaces TRAK-189's dark cards: no element painted in a band colour may sit
 * inside a `.trak-dark` card, and a band word written in colour uses the band's
 * readable `text` shade, never the lighter bar colour (Good, Mixed and friends
 * are 3:1 for bars but under 4.5:1 for small text).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CoachAssessmentCard } from '@/components/coach/CoachAssessmentCard'
import { renderApp } from '../../tests/support/render-app'
import { signInAs } from '../../tests/support/session'
import { server } from '../../tests/msw/server'
import { table, rpc } from '../../tests/msw/supabase'
import { BANDS } from '@/lib/types'

const PLAYER = { id: 'player-bands-189' }
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const BAND_RGB = new Set(BANDS.flatMap(b => [b.color, b.text]).map(rgb))
// Bar colours too light for small text: a word in one of these is the bug.
const BAR_ONLY = new Set(BANDS.filter(b => b.color !== b.text).map(b => rgb(b.color)))

/** Every element whose text or fill is a band colour; whether it sits on a dark card; whether its text is a bar-only colour. */
function bandPainted() {
  return [...document.body.querySelectorAll<HTMLElement>('[style]')]
    .filter(el => BAND_RGB.has(el.style.color) || BAND_RGB.has(el.style.backgroundColor) || BAND_RGB.has(el.style.background))
    .map(el => ({ text: (el.textContent || el.outerHTML).trim().slice(0, 40), dark: !!el.closest('.trak-dark'), faint: BAR_ONLY.has(el.style.color) }))
}
const onLight = (painted: ReturnType<typeof bandPainted>) => {
  expect(painted.filter(p => p.dark)).toEqual([])
  expect(painted.filter(p => p.faint)).toEqual([])
}

beforeEach(() => {
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Manos Synthetic' }]),
    table('player_details', [{ user_id: PLAYER.id, position: 'Defender', shirt_number: 13 }]),
    table('matches', []),
    table('coach_shared_feedback', []),
    rpc('child_events', () => []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1', linked_player_id: PLAYER.id, status: 'active' }]),
    table('coach_assessments', [{ id: 'as-1', squad_player_id: 'squad-1', coach_user_id: 'coach-1', created_at: '2026-10-12T10:00:00Z',
      work_rate: 9, tactical: 6, attitude: 8, technical: 5, physical: 7, coachability: 3 }]),
    table('player_parent_links', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => cleanup())

describe('TRAK-229: band colours on light cards, words in readable shades', () => {
  // TRAK-435 (12 Nov): Home has no season card built on match ratings; its assessment cards carry the bands.
  it("player Home: the coach's assessment cards", async () => {
    renderApp('/player/home')
    await screen.findByRole('region', { name: 'Latest coach assessment' })
    const painted = bandPainted()
    expect(painted.length).toBeGreaterThan(0)
    onLight(painted)
  })

  it('How Trak Works: the band list and the band words', async () => {
    renderApp('/how-it-works')
    await screen.findByText('PERFORMANCE BANDS')
    const painted = bandPainted()
    expect(painted.length).toBeGreaterThan(6)
    onLight(painted)
  })

  it("the coach's assessment card on a player's profile (TRAK-200's Arc card)", () => {
    render(<MemoryRouter><CoachAssessmentCard assessment={{ id: 'as-card', created_at: '2026-10-12T10:00:00Z', published_at: null,
      work_rate: 9, tactical: 6, attitude: 8, technical: 5, physical: 7, coachability: 3 }} /></MemoryRouter>)
    const painted = bandPainted()
    expect(painted.length).toBeGreaterThan(6)
    onLight(painted)
  })

  it("the player's Coach Assessments", async () => {
    renderApp('/player/profile')
    await screen.findByText('COACH ASSESSMENTS')
    await screen.findByText('Exceptional')
    const painted = bandPainted()
    expect(painted.length).toBeGreaterThan(6)
    onLight(painted)
  })
})
