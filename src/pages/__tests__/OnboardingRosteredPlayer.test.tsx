/**
 * TRAK-53 / TRAK-54 (J1): the academy roster, not the child, decides the club
 * and the coach, so no player screen asks for a free-text club or a coach code
 * (Makis hit "Coach code OSFP-07 was not recognised" on 23 Sep). Since TRAK-101
 * there is no public player signup; the invited setup asks only for a name
 * and an optional position, and provision_my_profile's exact arguments (no
 * club, no code) are pinned in OnboardingInvitedPlayer.test.tsx.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../OnboardingPage'

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }))
afterEach(() => cleanup())

const signedOut = { user: null, profile: null, loading: false }
const invited = { user: { id: 'invited-child', user_metadata: { invited_as: 'player', child_first_name: 'Ana', academy_name: 'Synthetic Academy' } },
  profile: null, loading: false, refreshProfile: vi.fn() }
function renderAs(state: Record<string, unknown>) {
  auth.value = state
  render(<MemoryRouter initialEntries={['/onboarding/player']}><Routes>
    <Route path="/onboarding/:role" element={<OnboardingPage />} />
  </Routes></MemoryRouter>)
}

describe('no club and no coach code on any player setup (TRAK-53, TRAK-54, TRAK-101)', () => {
  it('a signed-out visitor gets no signup form at all', () => {
    renderAs(signedOut)
    expect(screen.queryByPlaceholderText('Current club')).toBeNull()
    expect(screen.queryByPlaceholderText(/coach code/i)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('the invited child\'s setup asks for no club and no coach code', () => {
    renderAs(invited)
    expect(screen.getByRole('heading', { name: 'Welcome, Ana' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Current club')).toBeNull()
    expect(screen.queryByPlaceholderText(/coach code/i)).toBeNull()
    expect(screen.queryByText(/coach invite code/i)).toBeNull()
  })
})
