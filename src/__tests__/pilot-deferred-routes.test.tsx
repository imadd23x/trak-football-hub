/**
 * TRAK-85 route table: each of the 13 parked routes mounts its own screen
 * inside ParkedScreen, with the "Coming soon" pill, for its role only. Screens
 * are stubbed here so this is about routing; the real screens, their reads and
 * that every action sends nothing are in parked-screens-coming-soon.test.tsx
 * and parked-feature-boundary.test.tsx. The backend stays closed (G7).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import App from '@/App'
import { useParked } from '@/components/trak/parked'

const auth = vi.hoisted(() => ({ role: 'player', signedIn: true }))
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: auth.signedIn ? { id: 'synthetic-user' } : null,
    profile: { role: auth.role }, loading: false }),
}))
vi.mock('@/contexts/ParentChildrenContext', () => ({ ParentChildrenProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/trak/DevSwitcher', () => ({ DevSwitcher: () => null }))
vi.mock('@/components/player/PlayerConsentWatcher', () => ({ PlayerConsentWatcher: () => null }))
vi.mock('@/components/parent/ParentConsentWatcher', () => ({ ParentConsentWatcher: () => null }))
vi.mock('@/pages/LandingPage', () => ({ default: () => <h1>Sign in</h1> }))
vi.mock('@/pages/player/PlayerHome', () => ({ default: () => <h1>Player home</h1> }))
vi.mock('@/pages/coach/CoachAssessPage', () => ({ default: () => <h1>Manual assessment</h1> }))

// Each stub names its screen and reports whether it was mounted as parked.
const stub = (name: string) => ({ default: function Stub() {
  const { parked } = useParked()
  return <h1>{name} screen{parked ? ' (parked)' : ''}</h1>
} })
vi.mock('@/pages/player/PlayerPassport', () => stub('Passport'))
vi.mock('@/pages/player/PlayerEvolutionCard', () => stub('Evolution card'))
vi.mock('@/pages/coach/CoachReviewFeedback', () => stub('Feedback review'))
vi.mock('@/pages/coach/CoachAssistant', () => stub('Assistant'))
vi.mock('@/pages/coach/CoachSchedule', () => stub('Schedule'))
vi.mock('@/pages/coach/CoachRecognition', () => stub('Recognition'))
vi.mock('@/pages/coach/CoachAwardPlayer', () => stub('Award'))
vi.mock('@/pages/parent/ParentAlerts', () => stub('Alerts'))
vi.mock('@/pages/club/ClubHome', () => stub('Club home'))
vi.mock('@/pages/club/ClubSquads', () => stub('Club squads'))
vi.mock('@/pages/club/ClubCoaches', () => stub('Club coaches'))
vi.mock('@/pages/club/ClubProfile', () => stub('Club profile'))
vi.mock('@/pages/club/ClubRadar', () => stub('Club radar'))

beforeEach(() => { auth.role = 'player'; auth.signedIn = true })
afterEach(cleanup)
const mount = (path: string) => { window.history.pushState({}, '', path); return render(<App />) }

describe('TRAK-85 parked routes', () => {
  it.each([
    ['player', '/player/passport', 'Passport'], ['player', '/player/evolution', 'Evolution card'],
    ['coach', '/coach/feedback/synthetic-assessment', 'Feedback review'], ['coach', '/coach/assistant', 'Assistant'],
    ['coach', '/coach/schedule', 'Schedule'], ['coach', '/coach/recognition', 'Recognition'], ['coach', '/coach/award', 'Award'],
    ['parent', '/parent/alerts', 'Alerts'],
    ['club', '/club/home', 'Club home'], ['club', '/club/squads', 'Club squads'], ['club', '/club/coaches', 'Club coaches'],
    ['club', '/club/profile', 'Club profile'], ['club', '/club/radar', 'Club radar'],
  ])('%s at %s sees the %s screen, parked, with the "Coming soon" pill', async (role, path, name) => {
    auth.role = role
    mount(path)
    expect(await screen.findByRole('heading', { name: `${name} screen (parked)` })).toBeInTheDocument()
    expect(screen.getByRole('note', { name: 'This screen is coming soon' })).toHaveTextContent('Coming soon')
    // The full-page placeholder is gone.
    expect(screen.queryByRole('heading', { name: 'Coming soon' })).not.toBeInTheDocument()
  })

  it('retains the anonymous route boundary', async () => {
    auth.signedIn = false
    mount('/player/passport')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText(/screen/)).not.toBeInTheDocument()
  })

  it('retains the wrong-role route boundary', async () => {
    mount('/coach/assistant')
    expect(await screen.findByRole('heading', { name: 'Player home' })).toBeInTheDocument()
    expect(screen.queryByText(/Assistant screen/)).not.toBeInTheDocument()
  })

  it('CONTROL a retained route is not parked and has no pill', async () => {
    auth.role = 'coach'
    mount('/coach/assess')
    expect(await screen.findByRole('heading', { name: 'Manual assessment' })).toBeInTheDocument()
    expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).not.toBeInTheDocument()
  })
})
