/**
 * TRAK-18 (G2) phase 4 of the consent-first spec: a rostered child's signup has
 * no guardian step. Guardians come from the academy roster, never from the
 * child ("Never: let a child choose or change a guardian email (G2), on screen
 * or through the API"). Since TRAK-48 slice 3 every new player is rostered,
 * and since TRAK-11 phase 3 the roster's guardians are invited at load, so the
 * child has nothing to type and the signup carries no guardian address.
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

// Under 18, so before this change the Parent step was required.
const year = String(new Date().getFullYear() - 15)
const dob = `${year}-01-15`

async function completeFootballStep() {
  render(<MemoryRouter initialEntries={['/onboarding/player']}><Routes>
    <Route path="/onboarding/:role" element={<OnboardingPage />} />
  </Routes></MemoryRouter>)
  fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Synthetic Child' } })
  const [day, month, yearSelect, nationality] = screen.getAllByRole('combobox')
  fireEvent.change(month, { target: { value: 'January' } })
  fireEvent.change(yearSelect, { target: { value: year } })
  fireEvent.change(day, { target: { value: '15' } })
  fireEvent.change(nationality, { target: { value: (nationality as HTMLSelectElement).options[1].value } })
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'child@synthetic.test' } })
  fireEvent.change(screen.getByPlaceholderText(PASSWORD_HINT), { target: { value: 'SyntheticOnly1!' } })
  fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'SyntheticOnly1!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  const [position, ageGroup] = await screen.findAllByRole('combobox')
  fireEvent.change(position, { target: { value: (position as HTMLSelectElement).options[1].value } })
  fireEvent.change(ageGroup, { target: { value: lowestEligibleAgeGroup(dob) } })
}

describe('a rostered child signs up without naming a guardian (TRAK-18 phase 4)', () => {
  it('ends at the Football step: no Parent step and no guardian email box', async () => {
    await completeFootballStep()
    expect(screen.queryByText('Parent')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByPlaceholderText(/parent|guardian/i)).toBeNull()
  })

  it('sends no guardian address with the signup', async () => {
    await completeFootballStep()
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await vi.waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1))
    const profile = (auth.signUp.mock.calls[0] as unknown[])[2] as Record<string, unknown>
    expect(profile).not.toHaveProperty('parent_email')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('then asks the child to confirm their email, promising nothing about a guardian address', async () => {
    await completeFootballStep()
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByText('Check your email')).toBeTruthy()
    expect(screen.getByText('child@synthetic.test')).toBeTruthy()
    expect(screen.queryByText(/we'll ask your parent/i)).toBeNull()
  })
})
