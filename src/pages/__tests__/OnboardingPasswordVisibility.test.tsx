import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../OnboardingPage'
import { PASSWORD_HINT } from '@/lib/password'

const auth = vi.hoisted(() => ({ signUp: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('signup password visibility', () => {
  // Coach and club signup forms are gone: Trak sets up staff (TRAK-12, staff-set-up-by-trak.test.tsx).
  it.each(['player'])('lets %s reveal each password independently without advancing or submitting', async role => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[`/onboarding/${role}`]}><Routes>
      <Route path="/onboarding/:role" element={<OnboardingPage />} />
    </Routes></MemoryRouter>)
    const password = screen.getByPlaceholderText(PASSWORD_HINT)
    const confirmation = screen.getByPlaceholderText('Confirm password')
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
    await user.clear(confirmation)
    expect(confirmation).toHaveAttribute('type', 'password')
    expect(auth.signUp).not.toHaveBeenCalled()
  })
})
