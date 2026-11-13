import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { LatestEvaluation } from '../LatestEvaluation'
import { markOpened } from '@/lib/games/news'
import type { ParentAssessment } from '@/lib/parent-assessments'

/**
 * TRAK-441 slice 2.5 (mockup, 12 Nov): the player Home's Latest evaluation card. The coach's band bars, words and no
 * numbers; "New" until the evaluation's page has shown on this device; Open evaluation goes to it.
 */

const assessment = {
  id: 'a1', session_id: null, created_at: '2026-11-08T10:00:00Z', coach_user_id: 'coach-1', coach_rating: 7.5,
  work_rate: 9.2, tactical: 7.1, attitude: 8.2, technical: 7.4, physical: null, coachability: 8.5,
} as unknown as ParentAssessment

const show = () => render(<MemoryRouter><LatestEvaluation assessment={assessment} readerId="player-1" /></MemoryRouter>)

describe('TRAK-441: Latest evaluation on the player Home', () => {
  beforeEach(() => localStorage.clear())

  it('shows the coach\'s bars with band words, never a number, and opens the evaluation', () => {
    show()
    const card = screen.getByRole('region', { name: 'Latest evaluation' })
    expect(within(card).getByText('8 Nov')).toBeInTheDocument()
    // Five rated categories; Physical has no score, so no bar.
    for (const label of ['Work Rate', 'Tactical', 'Attitude', 'Technical', 'Coachability']) expect(within(card).getByText(label)).toBeInTheDocument()
    expect(within(card).queryByText('Physical')).toBeNull()
    expect(card.textContent).not.toMatch(/\d\.\d|\b7\.5\b/)
    expect(within(card).getByRole('link', { name: /Open evaluation/ })).toHaveAttribute('href', '/player/feedback/a1')
  })

  it('says New until the evaluation has been opened on this device', () => {
    const { unmount } = show()
    expect(within(screen.getByRole('region', { name: 'Latest evaluation' })).getByText('New')).toBeInTheDocument()
    unmount()
    markOpened('player-1', 'player-1', 'evaluation', 'a1')
    show()
    expect(within(screen.getByRole('region', { name: 'Latest evaluation' })).queryByText('New')).toBeNull()
  })
})
