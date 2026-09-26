/**
 * TRAK-53 / TRAK-54 (J1): the academy roster, not the child, decides the club
 * and the coach. Since slice 3 (#144) the server fills current_club with the
 * academy name and links the rostered coach, so player signup stops asking for
 * a free-text club and a coach code. Makis hit the code step on 23 Sep: "Coach
 * code OSFP-07 was not recognised".
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

async function reachFootballStep() {
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

describe('rostered player signup (TRAK-53, TRAK-54)', () => {
  it('asks for no club: position and age group are enough to continue', async () => {
    await reachFootballStep()
    expect(screen.queryByPlaceholderText('Current club')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByPlaceholderText("Parent or guardian's email")).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('asks for no coach code', async () => {
    await reachFootballStep()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByPlaceholderText("Parent or guardian's email")
    expect(screen.queryByPlaceholderText(/coach code/i)).toBeNull()
    expect(screen.queryByText(/coach invite code/i)).toBeNull()
  })

  it('sends neither a club nor a coach code: the roster supplies both', async () => {
    await reachFootballStep()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(await screen.findByPlaceholderText("Parent or guardian's email"), { target: { value: 'parent@synthetic.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await vi.waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1))
    const profile = (auth.signUp.mock.calls[0] as unknown[])[2] as Record<string, any>
    expect(profile).not.toHaveProperty('coach_invite_code')
    expect(profile.player_details).not.toHaveProperty('current_club')
    expect(profile.player_details.date_of_birth).toBe(dob)
  })
})
