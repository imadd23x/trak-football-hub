/**
 * TRAK-18 (G2): a child never names a guardian. Guardians come from the academy
 * roster ("Never: let a child choose or change a guardian email (G2), on screen
 * or through the API"). Since TRAK-101 there is no public player signup at
 * all, and the invited child's setup has no guardian field; the exact
 * provision_my_profile arguments (no guardian) are pinned in
 * OnboardingInvitedPlayer.test.tsx.
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

describe('a child never names a guardian (TRAK-18, TRAK-101)', () => {
  it('a signed-out visitor gets no signup form, so no guardian field', () => {
    renderAs(signedOut)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByPlaceholderText(/parent|guardian/i)).toBeNull()
    expect(screen.queryByLabelText(/parent|guardian/i)).toBeNull()
  })

  it('the invited child\'s setup has no Parent step and no guardian address box', () => {
    renderAs(invited)
    expect(screen.getByRole('heading', { name: 'Welcome, Ana' })).toBeInTheDocument()
    expect(screen.queryByText('Parent')).toBeNull()
    expect(screen.queryByPlaceholderText(/parent|guardian/i)).toBeNull()
    expect(screen.queryByLabelText(/parent|guardian/i)).toBeNull()
  })
})
