/**
 * TRAK-351 (Season plan 3/18, Tarek 3 Nov): a player in Squad › Players opens as their own full page, with no list
 * beside it and a Back button. The page has its own address, so a reload or a link opens it directly. Back returns to
 * the list as it was left: the same position filter and the same scroll. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

vi.mock('recharts', async importOriginal => {
  const recharts = await importOriginal<typeof import('recharts')>()
  const { cloneElement } = await import('react')
  return {
    ...recharts,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      <div style={{ width: 800, height: 220 }}>{cloneElement(children, { width: 800, height: 220 } as never)}</div>,
  }
})

let COACH = { id: 'coach-351' }
let n = 0
const player = (id: string, name: string, position: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, position, shirt_number: shirt, age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' })

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-351-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach' }]),
    table('squad_players', [
      player('sq-ada', 'Ada Synthetic', 'Defender', 4), player('sq-bo', 'Bo Synthetic', 'Attacker', 9), player('sq-cy', 'Cy Synthetic', 'Midfielder', 8),
    ]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => false),
    rpc('coach_squad_season', () => []),
    table('squad_player_profiles', []),
    rpcRows('coach_player_birth_dates', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear(); vi.restoreAllMocks() })

const view = () => screen.findByRole('region', { name: 'Players' })

describe('TRAK-351 a player\'s full page', () => {
  it('opens at its own address, alone: no list beside it, no Squad tabs, a Back button', async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad')
    const panel = await view()
    await user.click(await within(panel).findByRole('button', { name: /^Bo Synthetic/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad/player/sq-bo'))
    expect(await within(panel).findByRole('region', { name: 'About Bo' })).toBeInTheDocument()
    expect(within(panel).queryByRole('list', { name: 'Players' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Squad view' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('goes Back to the list as it was: the same filter and the same scroll', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderApp('/coach/squad')
    const panel = await view()
    await user.click(await within(panel).findByRole('radio', { name: 'ATT' }))
    await waitFor(() => expect(within(within(panel).getByRole('list', { name: 'Players' })).getAllByRole('listitem')).toHaveLength(1))
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
    await user.click(within(panel).getByRole('button', { name: /^Bo Synthetic/ }))
    await within(panel).findByRole('region', { name: 'About Bo' })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad'))
    const list = await within(panel).findByRole('list', { name: 'Players' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(panel).getByRole('radio', { name: 'ATT' })).toBeChecked()
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: 640 }))
  })

  it('opens straight from its address, and Back then goes to the squad', async () => {
    const user = userEvent.setup()
    renderApp('/coach/squad/player/sq-cy')
    const panel = await view()
    expect(await within(panel).findByRole('region', { name: 'About Cy' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/squad'))
    expect(await within(panel).findByRole('list', { name: 'Players' })).toBeInTheDocument()
  })

  // TRAK-368: with every squad in view, a missing player isn't the coach's at all, as the older page said.
  it('says so when the address names nobody in the squad', async () => {
    renderApp('/coach/squad/player/sq-gone')
    const panel = await view()
    expect(await within(panel).findByText("We couldn't find that player. They may have been removed from your squad.")).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('with one squad picked, a player from another squad points to All', async () => {
    server.use(table('squad_players', [
      player('sq-ada', 'Ada Synthetic', 'Defender', 4), { ...player('sq-una', 'Una Synthetic', 'Midfielder', 6), age_group: 'U14' },
    ]))
    localStorage.setItem(`trak:coach-squad-all:${COACH.id}`, '0')
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U14')
    renderApp('/coach/squad/player/sq-ada')
    const panel = await view()
    expect(await within(panel).findByText(/isn't in the squad you're looking at\. Pick All at the top/)).toBeInTheDocument()
  })
})
