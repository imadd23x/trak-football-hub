/** TRAK-433: small polish. The season plan marks Home in the menu, as Evaluation does; the 404 speaks like Trak and logs no error. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { placeOf } from '../coach-places'
import NotFound from '@/pages/NotFound'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('TRAK-433', () => {
  it('the season plan marks Home in the menu and is named in the top bar, as Evaluation is', () => {
    expect(placeOf('/coach/season-plan')).toEqual({ screen: 'home', title: 'Season plan' })
    expect(placeOf('/coach/season-plan/objectives')).toEqual({ screen: 'home', title: 'Season plan' })
    expect(placeOf('/coach/evaluation').screen).toBe('home')
  })

  it('the 404 page says so in Trak\'s voice, links Home, and logs no console error for a visit', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<MemoryRouter initialEntries={['/nowhere']}><NotFound /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: "We can't find that page" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/Oops/)).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })
})
