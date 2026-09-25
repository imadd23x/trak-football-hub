import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import App from '@/App'

const auth = vi.hoisted(() => ({ role: 'player', signedIn: true }))
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: auth.signedIn ? { id: 'synthetic-user' } : null,
    profile: { role: auth.role }, loading: false }),
}))
vi.mock('@/contexts/ParentChildrenContext', () => ({ ParentChildrenProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/trak/DevSwitcher', () => ({ DevSwitcher: () => null }))
vi.mock('@/pages/LandingPage', () => ({ default: () => <h1>Sign in</h1> }))
vi.mock('@/pages/player/PlayerHome', () => ({ default: () => <h1>Player home</h1> }))
vi.mock('@/pages/player/PlayerPassport', () => ({ default: () => <h1>Passport feature mounted</h1> }))
vi.mock('@/pages/player/PlayerEvolutionCard', () => ({ default: () => <h1>Export feature mounted</h1> }))
vi.mock('@/pages/coach/CoachAssistant', () => ({ default: () => <h1>Assistant feature mounted</h1> }))
vi.mock('@/pages/coach/CoachReviewFeedback', () => ({ default: () => <h1>AI review feature mounted</h1> }))
vi.mock('@/pages/coach/CoachSchedule', () => ({ default: () => <h1>Schedule feature mounted</h1> }))
vi.mock('@/pages/coach/CoachAssessPage', () => ({ default: () => <h1>Manual assessment</h1> }))

beforeEach(() => { auth.role = 'player'; auth.signedIn = true })
afterEach(cleanup)
const mount = (path: string) => { window.history.pushState({}, '', path); return render(<App />) }

describe('G7 deferred pilot routes', () => {
  it.each([
    ['player', '/player/passport'], ['player', '/player/evolution'],
    ['coach', '/coach/assistant'], ['coach', '/coach/feedback/synthetic-assessment'],
    ['coach', '/coach/schedule'],
  ])('%s sees a static placeholder at %s without mounting the feature', async (role, path) => {
    auth.role = role
    mount(path)
    expect(await screen.findByRole('heading', { name: 'Coming soon' })).toBeInTheDocument()
    expect(screen.queryByText(/feature mounted/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', `/${role}/home`)
  })

  it('retains the anonymous route boundary', async () => {
    auth.signedIn = false
    mount('/player/passport')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('retains the wrong-role route boundary', async () => {
    mount('/coach/assistant')
    expect(await screen.findByRole('heading', { name: 'Player home' })).toBeInTheDocument()
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('keeps the manual assessment route available', async () => {
    auth.role = 'coach'
    mount('/coach/assess')
    expect(await screen.findByRole('heading', { name: 'Manual assessment' })).toBeInTheDocument()
  })
})
