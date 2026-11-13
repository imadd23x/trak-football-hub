import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../../../tests/msw/server'
import { rpcRows, table } from '../../../../tests/msw/supabase'
import { SessionLog } from '../SessionLog'

// TRAK-426: whether the old log has retired (Training and Matches both on); rendered here without the signed-in frame.
const oldLog = vi.hoisted(() => ({ retired: false }))
vi.mock('@/components/coach/old-log', () => ({ useOldLogRetired: () => ({ retired: oldLog.retired, known: true }) }))

/* Imad, 23 Oct: "View log" shows the log, read only, with Edit log one tap further. */

afterEach(() => { oldLog.retired = false })
afterEach(cleanup)

function renderLog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><SessionLog sessionId="s-1" coachId="c-1" /></MemoryRouter></QueryClientProvider>)
}

describe('SessionLog', () => {
  it('a training: its focus, length, intensity and notes, who came, and Edit log', async () => {
    server.use(
      table('coach_sessions', [{ id: 's-1', session_type: 'training', title: 'Tactical / Finishing — Pressing', session_date: '2026-10-22', training_type: 'tactical,finishing', notes: '75 min · High intensity\nGood intensity in the rondos.' }]),
      table('session_attendance', [{ squad_player_id: 'p-1', status: 'present' }, { squad_player_id: 'p-2', status: 'absent' }]),
      table('squad_players', [{ id: 'p-1', player_name: 'Bukayo Saka' }, { id: 'p-2', player_name: 'Beth Mead' }]),
    )
    renderLog()
    expect(await screen.findByText('Thu 22 Oct')).toBeInTheDocument()
    expect(screen.getByText('Pressing')).toBeInTheDocument()
    expect(screen.getByText('75 min')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Good intensity in the rondos.')).toBeInTheDocument()
    expect(await screen.findByText('Attended · 1')).toBeInTheDocument()
    expect(screen.getByText("Didn't come · 1")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit log' })).toHaveAttribute('href', '/coach/sessions/s-1')
    // Read only: nothing on it saves.
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a match: the score, each player with goals, assists or a card, and who didn\'t play', async () => {
    const row = { competition: 'League', venue: 'Home', opponent: 'Rivals FC', team_score: 3, opponent_score: 1, locked: false, position: null }
    server.use(
      table('coach_sessions', [{ id: 's-1', session_type: 'match', title: 'vs Rivals FC', session_date: '2026-10-20', training_type: null, notes: null }]),
      rpcRows('logged_match', [
        { ...row, user_id: 'u-1', player_name: 'Hugo Lloris', goals: 2, assists: 0, card_received: 'None', played: true },
        { ...row, user_id: 'u-2', player_name: 'Bukayo Saka', goals: 0, assists: 1, card_received: 'Yellow', played: true },
        { ...row, user_id: 'u-3', player_name: 'Beth Mead', goals: 0, assists: 0, card_received: 'None', played: true },
        { ...row, user_id: 'u-4', player_name: 'Cole Palmer', goals: 0, assists: 0, card_received: null, played: false },
      ]),
    )
    renderLog()
    expect(await screen.findByText('3–1')).toBeInTheDocument()
    expect(screen.getByText('Played · 3')).toBeInTheDocument()
    expect(screen.getByText('2 goals')).toBeInTheDocument()
    expect(screen.getByText('1 assist · Yellow card')).toBeInTheDocument()
    expect(screen.queryByText('Beth Mead')).toBeNull()
    expect(screen.getByText("Didn't play: Cole Palmer")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit log' })).toHaveAttribute('href', '/coach/sessions/s-1')
  })
})

// TRAK-426 (Kostas, 12 Nov): where Training and Matches are both on, the old Edit session is gone; a training is
// changed on its own page (Who's here, notes), a match in its evaluation.
describe('SessionLog where the old log has retired', () => {
  it('shows the log, read only, with no Edit log', async () => {
    oldLog.retired = true
    server.use(
      table('coach_sessions', [{ id: 's-1', session_type: 'training', title: 'Tactical / Finishing — Pressing', session_date: '2026-10-22', training_type: 'tactical,finishing', notes: '75 min · High intensity' }]),
      table('session_attendance', [{ squad_player_id: 'p-1', status: 'present' }]),
      table('squad_players', [{ id: 'p-1', player_name: 'Bukayo Saka' }]),
    )
    renderLog()
    expect(await screen.findByText('Attended · 1')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit log' })).toBeNull()
  })
})
