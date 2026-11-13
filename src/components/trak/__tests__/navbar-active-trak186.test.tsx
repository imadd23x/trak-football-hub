/**
 * TRAK-186 (live run 3, 16 Oct): on the coach's Sessions → History, the bottom
 * bar stopped marking Sessions, as if the coach had left it. A tab stays marked
 * on every page under it, and says so to screen readers.
 * Since the Sessions tab went (Kostas, 20 Oct), its pages mark Home, where they open from.
 * TRAK-259: the coach's bar is the frame's glass tab bar, a tab list (aria-selected).
 */
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const COACH = { id: 'coach-186' }

function coach() {
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Angelos Basinas', invite_code: 'ABCD' }]),
    table('coach_sessions', []), table('squad_players', []), table('coach_details', []),
    // TRAK-426: Training off, so the old log's pages are still there to mark.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training'),
  )
}
const bar = () => screen.findByRole('tablist', { name: 'Coach' })
const tab = (name: string) => within(screen.getByRole('tablist', { name: 'Coach' })).getByRole('tab', { name })

describe('TRAK-186: the coach\'s logging pages keep Home marked', () => {
  it('marks Home on "What are you logging?"', async () => {
    coach()
    renderApp('/coach/sessions')
    await screen.findByText('What are you logging?')
    await bar()
    expect(tab('Home')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Squad')).toHaveAttribute('aria-selected', 'false')
  }, 20_000)

  it('still marks Home on History', async () => {
    coach()
    renderApp('/coach/sessions/list')
    await bar()
    expect(tab('Home')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Squad')).toHaveAttribute('aria-selected', 'false')
  }, 20_000)
})
