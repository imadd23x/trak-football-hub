/**
 * TRAK-389 (Drill Library 4/11, parent TRAK-384): a drill's page, from the 8 Nov mockup. Players today, Easier and
 * Harder (each says what changed and why, and greys out at the end), the changed details marked, Also called, and
 * Another drill. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { LIBRARY } from '@/lib/training/library'

let n = 0
let COACH = { id: 'coach-389' }
const drill = (name: string) => LIBRARY.find(d => d.name === name)!
const open = (name: string) => renderApp(`/coach/training/drills/d/${drill(name).id}`)

beforeEach(() => {
  COACH = { id: `coach-389-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Carlo Ancelotti', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', Array.from({ length: 12 }, (_, i) => ({ id: `sp-${i}`, coach_user_id: COACH.id, player_name: `Player ${i}`, age_group: 'U14', status: 'active' }))),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([])),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_plans', []),
    table('training_notes', []),
    table('training_plan_drafts', []),
    table('coach_drill_bookmarks', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const picture = () => screen.getByRole('img', { name: /set-up\./ })
const detail = (name: string) => screen.getByText(name, { selector: 'dt' }).closest('div')!

describe('TRAK-389: a drill’s page', { timeout: 20_000 }, () => {
  it('says its kind, type and other names, and starts at the standard level for the squad', async () => {
    open('Keep the ball')
    expect(await screen.findByRole('heading', { name: 'Keep the ball', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Also called: piggy in the middle, keep ball, toro')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /Area shape and size: 13x13 m\. Numbers: 12 players, 9v3\./ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Set for your squad. Press Easier or Harder and Trak shows what it changed and why.')
    // Add to training is TRAK-391's (training-add-trak391); Add to My drills is TRAK-390's.
    expect(screen.getByRole('button', { name: /Add to training/ })).toBeTruthy()
  })

  it('Harder and Easier move a level, say what changed and why, and mark the changed details', async () => {
    const user = userEvent.setup()
    open('Keep the ball')
    await screen.findByRole('img', { name: /13x13 m/ })
    await user.click(screen.getByRole('button', { name: 'Harder' }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Harder. Here’s what Trak changed:')
    expect(within(status).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Area shape and size: 13x13 m to 12x12 m. Less room means less time on the ball.',
      'Numbers: 12 players, 9v3 to 12 players, 8v4. Fewer spare players means passes are harder to find.',
    ])
    expect(picture()).toHaveAccessibleName(/Area shape and size: 12x12 m\. Numbers: 12 players, 8v4\./)
    expect(detail('Area shape and size')).toHaveAttribute('data-changed', 'true')
    expect(detail('Targets')).not.toHaveAttribute('data-changed')

    await user.click(screen.getByRole('button', { name: 'Easier' }))
    expect(screen.getByRole('status')).toHaveTextContent('Easier. Here’s what Trak changed:')
    expect(picture()).toHaveAccessibleName(/13x13 m/)
  })

  it('a button greys out at the end of the range', async () => {
    const user = userEvent.setup()
    open('Keep the ball')
    await screen.findByRole('img', { name: /13x13 m/ })
    for (let i = 0; i < 8; i++) {
      const harder = screen.getByRole('button', { name: 'Harder' })
      if ((harder as HTMLButtonElement).disabled) break
      await user.click(harder)
    }
    expect(screen.getByRole('button', { name: 'Harder' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Easier' })).toBeEnabled()
  })

  it('Players today refits the drill from 8 to 20 and says what changed', async () => {
    const user = userEvent.setup()
    open('Keep the ball')
    await screen.findByRole('img', { name: /13x13 m/ })
    const today = screen.getByRole('group', { name: 'Players today' })
    await user.click(within(today).getByRole('button', { name: 'One player more' }))
    expect(within(today).getByText('13')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('13 players today. Trak refitted the drill:')
    expect(screen.getByRole('status')).toHaveTextContent('Numbers: 12 players, 9v3 to 13 players, 10v3.')
    for (let i = 0; i < 4; i++) await user.click(within(today).getByRole('button', { name: 'One player fewer' }))
    expect(within(today).getByText('9')).toBeInTheDocument()
    await user.click(within(today).getByRole('button', { name: 'One player fewer' }))
    expect(within(today).getByText('8')).toBeInTheDocument()
    expect(within(today).getByRole('button', { name: 'One player fewer' })).toBeDisabled()
  })

  it('Another drill opens the next of the same type, fresh; Back returns', async () => {
    const user = userEvent.setup()
    open('Keep the ball')
    await screen.findByRole('img', { name: /13x13 m/ })
    await user.click(screen.getByRole('button', { name: 'Harder' }))
    await user.click(screen.getByRole('button', { name: 'Another drill' }))
    expect(await screen.findByRole('heading', { name: 'Four corners', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^Set for your squad/)
    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Keep the ball', level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe(`/coach/training/drills/d/${drill('Keep the ball').id}`))
  })

  it('keeps Easier, Harder and Players today when the page is laid out again or opened with Back', async () => {
    const user = userEvent.setup()
    open('Keep the ball')
    await screen.findByRole('img', { name: /13x13 m/ })
    await user.click(screen.getByRole('button', { name: 'Harder' }))
    await user.click(within(screen.getByRole('group', { name: 'Players today' })).getByRole('button', { name: 'One player more' }))
    await user.click(screen.getByRole('button', { name: 'Another drill' }))
    expect(await screen.findByRole('heading', { name: 'Four corners', level: 1 })).toBeInTheDocument()
    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Keep the ball', level: 1 })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Players today' })).getByText('13')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('13 players today. Trak refitted the drill:')
    expect(picture()).toHaveAccessibleName(/Numbers: 13 players, 9v4\./)
  })
})
