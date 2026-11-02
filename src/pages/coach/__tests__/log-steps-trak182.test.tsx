import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { logStep, matchAt, saveLog } from '../../../../tests/support/log-steps'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto } from '../../../../tests/msw/supabase'

/**
 * TRAK-182 part 7 (Imad's 7c): the match and training log is one step per
 * screen, then Review and one Save (a logged session has no draft). Next stays
 * shut until the step is right and says what is missing; Back keeps what was
 * typed; Review lists what the save will write.
 */

const COACH = { id: 'coach-1' }
let inserted: Record<string, unknown>[]

beforeEach(() => {
  signInAs(COACH)
  inserted = []
  server.use(
    table('profiles', [{ id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
    table('squad_players', []),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => { inserted.push(body); return { id: 'session-1', ...body } }),
  )
})

const next = () => screen.getByRole('button', { name: 'Next' })
const reviewed = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling

// TRAK-182: walking the steps takes longer than 5 s on GitHub's runners.
describe('TRAK-182: the session log in steps', { timeout: 20_000 }, () => {
  it('a training: Next waits for a focus and says so, then Review lists the session', async () => {
    const user = userEvent.setup()
    renderApp('/coach/sessions/add')
    await screen.findByText('SESSION FOCUS')
    expect(next()).toBeDisabled()
    expect(screen.getByText('Pick a session focus.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Technical/ }))
    await user.type(screen.getByPlaceholderText(/Pressing triggers/), 'Rondos')
    expect(next()).toBeEnabled()
    // TRAK-182 (live run 3): four steps, as a match has; length and intensity sit with the notes.
    expect([...document.querySelectorAll('[aria-label="Log steps"] li')].map(li => li.textContent))
      .toEqual([expect.stringContaining('Session'), expect.stringContaining('Attendance'), expect.stringContaining('Notes'), expect.stringContaining('Review')])
    await logStep('Notes')
    await user.click(screen.getByRole('button', { name: '75 min' }))
    await user.click(screen.getByRole('button', { name: 'High' }))
    await user.type(screen.getByPlaceholderText(/What went well/), 'Sharp passing')

    // Back keeps everything typed.
    await logStep('Session')
    expect(screen.getByPlaceholderText(/Pressing triggers/)).toHaveValue('Rondos')

    await logStep('Review')
    expect(reviewed('Focus')).toHaveTextContent('Technical')
    expect(reviewed('Theme')).toHaveTextContent('Rondos')
    expect(reviewed('Length')).toHaveTextContent('75 min')
    expect(reviewed('Intensity')).toHaveTextContent('High')
    expect(reviewed('Notes')).toHaveTextContent('Sharp passing')
    // A logged session has no draft: one Save.
    expect(screen.queryByRole('button', { name: /draft/i })).toBeNull()
    await saveLog('Save session')
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ session_type: 'training', training_type: 'Technical' })
  })

  it('a match: Next waits for the opponent and score, and Review shows the result', async () => {
    renderApp('/coach/sessions/quick')
    await screen.findByPlaceholderText('Opponent name')
    expect(next()).toBeDisabled()
    expect(screen.getByText('Add the opponent and the score.')).toBeInTheDocument()
    await matchAt('Review', 'Synthetic United')
    expect(reviewed('Opponent')).toHaveTextContent('Synthetic United')
    expect(reviewed('Score')).toHaveTextContent('Won 1–0')
    expect(reviewed('Played')).toHaveTextContent('Nobody marked as played')
    expect(screen.getByRole('button', { name: 'Save match' })).toBeEnabled()
  })

  it("names the step buttons apart from the trail, which leaves the screen (TRAK-334: in place of the header's Back)", async () => {
    renderApp('/coach/sessions/quick')
    await matchAt('Squad')
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to Match' })).toBeInTheDocument()
  })
})
