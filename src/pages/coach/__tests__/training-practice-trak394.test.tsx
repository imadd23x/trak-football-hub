/**
 * TRAK-394 (Drill Library 9/11, parent TRAK-384): Change any practice, from the Drills tab. Steve's five things, each
 * with his example: pick a set-up and the picture, what changes and the key follow it; Conditions shows his three
 * rules. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

let n = 0
let COACH = { id: 'coach-394' }

beforeEach(() => {
  COACH = { id: `coach-394-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Carlo Ancelotti', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([])),
    table('squad_players', []),
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

const things = () => screen.getByRole('group', { name: 'Five things that shape a practice' })
const examples = () => screen.getByRole('group', { name: 'Pick an example' })

describe('TRAK-394: Change any practice', { timeout: 20_000 }, () => {
  it('opens from the Drills tab on Area shape and size, with a picture, what changes and the key', async () => {
    const user = userEvent.setup()
    renderApp('/coach/training/drills')
    await user.click(await screen.findByRole('link', { name: 'Change any practice' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Change any practice' })).toBeInTheDocument()
    expect(within(things()).getAllByRole('button').map(b => b.textContent)).toEqual(['Area shape and size', 'Numbers', 'Targets', 'Direction', 'Conditions'])
    expect(screen.getByRole('heading', { level: 2, name: /Passing between the other team’s lines/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Area shape and size example: 20 wide, 40 long' })).toBeInTheDocument()
    expect(screen.getByText(/Lines sit further apart.*This is harder\./)).toBeInTheDocument()
    // Kostas, 9 Nov: Steve checks after the pilot, so the page doesn't say the answers are a draft.
    expect(screen.queryByText(/Steve to check/)).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Key' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Team A', 'Team B'])
  })

  it('picking another set-up changes the picture and the answer, and the address keeps the place', async () => {
    const user = userEvent.setup()
    renderApp('/coach/training/drills/change')
    await user.click(within(await screen.findByRole('group', { name: 'Five things that shape a practice' })).getByRole('button', { name: 'Direction' }))
    expect(window.location.search).toBe('?part=direction')
    expect(within(examples()).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('img', { name: 'Direction example: 10 passes, 30x30' })).toBeInTheDocument()

    await user.click(within(examples()).getByRole('button', { name: 'End line, 60x15' }))
    expect(window.location.search).toBe('?part=direction&eg=2')
    expect(screen.getByRole('img', { name: 'Direction example: End line, 60x15' })).toBeInTheDocument()
    expect(screen.getByText(/Two defenders can nearly cover the width/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Key' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['12 attackers', '2 defenders', 'End line'])

    // Another thing starts at its first set-up.
    await user.click(within(things()).getByRole('button', { name: 'Numbers' }))
    expect(window.location.search).toBe('?part=numbers')
    expect(screen.getByRole('img', { name: 'Numbers example: 3 spare players in the middle' })).toBeInTheDocument()
  })

  it('Conditions shows Steve’s three rules, with no picture', async () => {
    renderApp('/coach/training/drills/change?part=conditions')
    expect(await screen.findByRole('heading', { level: 2, name: /Rules change what players practise/ })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Three rules' })).getAllByRole('listitem').map(li => li.firstChild?.textContent))
      .toEqual(['Justify it', 'Start points are not conditions', 'Apply it'])
    expect(screen.queryByRole('img', { name: /example/ })).toBeNull()
  })

  it('an address it doesn’t know opens the first thing and set-up', async () => {
    renderApp('/coach/training/drills/change?part=nonsense&eg=9')
    expect(await screen.findByRole('img', { name: 'Area shape and size example: 20 wide, 40 long' })).toBeInTheDocument()
  })
})
