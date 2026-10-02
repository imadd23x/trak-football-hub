import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../OnboardingPage'

// TRAK-101: the only password form left on /onboarding/player is the invited
// child's setup (InvitedPlayerSetup); the public signup form is gone.
const auth = vi.hoisted(() => ({
  user: { id: 'invited-child', user_metadata: { invited_as: 'player', child_first_name: 'Ana' } },
  profile: null, loading: false, refreshProfile: vi.fn(),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('invited setup password visibility', () => {
  it('lets the invited child reveal each password independently without submitting', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/onboarding/player']}><Routes>
      <Route path="/onboarding/:role" element={<OnboardingPage />} />
    </Routes></MemoryRouter>)
    const password = screen.getByLabelText('New password')
    const confirmation = screen.getByLabelText('Confirm password')
    await user.type(password, 'SyntheticOnly1!')
    await user.type(confirmation, 'SyntheticOnly1!')
    expect(password).toHaveAttribute('type', 'password')
    const toggle = screen.getByRole('button', { name: 'Show new password' })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue('SyntheticOnly1!')
    expect(confirmation).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('aria-controls', password.id)
    await user.click(screen.getByRole('button', { name: 'Show confirm password' }))
    expect(confirmation).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide new password' }))
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveValue('SyntheticOnly1!')
    expect(confirmation).toHaveValue('SyntheticOnly1!')
  })
})
