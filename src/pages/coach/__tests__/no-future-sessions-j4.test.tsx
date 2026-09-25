/**
 * TRAK-67 (J4): the second use-case test logged a training dated 29 Sep on
 * 25 Sep; it landed in History with the whole squad marked present. J4 records
 * what happened, so a session or match cannot be dated after today (future
 * planning is the parked calendar, TRAK-25).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, localParts } from '@/lib/event-time'

const COACH = { id: 'coach-1' }
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localParts(d.toISOString()).date }
const dateInput = () => screen.getByLabelText('Session date') as HTMLInputElement

beforeEach(() => {
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('squad_players', []),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => ({ id: 'session-1', ...body })),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
  )
})

describe('J4: a session or match cannot be dated in the future', () => {
  it('a training dated tomorrow cannot be saved, and today can', async () => {
    const user = userEvent.setup()
    renderApp('/coach/sessions/add')
    await user.click(await screen.findByRole('button', { name: /Technical/ }))
    expect(dateInput()).toHaveAttribute('max', localTodayISO())
    fireEvent.change(dateInput(), { target: { value: tomorrow() } })
    expect(await screen.findByText(/can't be dated in the future/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save session' })).toBeDisabled()
    fireEvent.change(dateInput(), { target: { value: localTodayISO() } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save session' })).toBeEnabled())
  })

  it('a match dated tomorrow cannot be saved', async () => {
    const user = userEvent.setup()
    renderApp('/coach/sessions/quick')
    await user.type(await screen.findByPlaceholderText('Opponent name'), 'Olympiacos Youth')
    const [us, them] = screen.getAllByPlaceholderText('0')
    await user.type(us, '1'); await user.type(them, '0')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save match' })).toBeEnabled())
    expect(dateInput()).toHaveAttribute('max', localTodayISO())
    fireEvent.change(dateInput(), { target: { value: tomorrow() } })
    expect(await screen.findByText(/can't be dated in the future/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save match' })).toBeDisabled()
  })
})
