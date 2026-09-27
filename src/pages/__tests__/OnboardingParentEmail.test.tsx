/**
 * G5 / TRAK-52: a child cannot give their own email as their parent's. Found
 * on the 22 Sep testing call: the same address was accepted for both, so the
 * approval request went to the child and the screen said a parent was asked.
 * The database refuses it too (create_parent_invite), but by then the account
 * exists and first sign-in fails, so the form has to stop it first.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../OnboardingPage'
import { PASSWORD_HINT } from '@/lib/password'
import { lowestEligibleAgeGroup } from '@/lib/age-group'

const auth = vi.hoisted(() => ({ signUp: vi.fn(async () => ({ user: { id: 'synthetic' }, error: null })) }))
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('sonner', () => ({ toast }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const year = String(new Date().getFullYear() - 15)
const dob = `${year}-01-15`

async function reachParentStep(email: string) {
  render(<MemoryRouter initialEntries={['/onboarding/player']}><Routes>
    <Route path="/onboarding/:role" element={<OnboardingPage />} />
  </Routes></MemoryRouter>)
  fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Synthetic Child' } })
  const [day, month, yearSelect, nationality] = screen.getAllByRole('combobox')
  fireEvent.change(month, { target: { value: 'January' } })
  fireEvent.change(yearSelect, { target: { value: year } })
  fireEvent.change(day, { target: { value: '15' } })
  fireEvent.change(nationality, { target: { value: (nationality as HTMLSelectElement).options[1].value } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByPlaceholderText(PASSWORD_HINT), { target: { value: 'SyntheticOnly1!' } })
  fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'SyntheticOnly1!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  const [position, ageGroup] = await screen.findAllByRole('combobox')
  fireEvent.change(position, { target: { value: (position as HTMLSelectElement).options[1].value } })
  fireEvent.change(ageGroup, { target: { value: lowestEligibleAgeGroup(dob) } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  return screen.findByPlaceholderText("Parent or guardian's email")
}

describe('parent email at signup (G5)', () => {
  it("refuses the child's own email as the parent's, ignoring case and spaces", async () => {
    const parent = await reachParentStep('child@synthetic.test')
    fireEvent.change(parent, { target: { value: '  Child@Synthetic.TEST ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/different from yours/i))
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('CONTROL accepts a different parent email', async () => {
    const parent = await reachParentStep('child@synthetic.test')
    fireEvent.change(parent, { target: { value: 'parent@synthetic.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await vi.waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
