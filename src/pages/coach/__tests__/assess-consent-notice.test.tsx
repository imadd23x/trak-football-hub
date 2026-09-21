/**
 * Consent is 18 since #80, so on Monday every academy player is under the
 * threshold and a coach cannot assess them until a parent approves. The
 * database refuses (RLS WITH CHECK on squad_player_consent_required), and this
 * screen used to show that refusal verbatim, after the coach had set six sliders:
 *
 *   Could not save assessment: new row violates row-level security policy
 *   for table "coach_assessments"
 *
 * The screen now asks the same predicate the policy evaluates when a player is
 * chosen, says why, and disables Save. A refusal at save time (consent
 * withdrawn mid-form) is translated rather than shown raw.
 */
import { it, expect, describe } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, SUPABASE_URL } from '../../../../tests/msw/supabase'

const COACH = { id: 'coach-1' }
const RLS_REFUSAL = { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "coach_assessments"' }

function setup({ consentRequired, insertRefused = false }: { consentRequired: boolean | 'error'; insertRefused?: boolean }) {
  signInAs(COACH)
  const calls = { consentChecks: [] as unknown[], inserts: 0 }
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', nationality: 'AE', invite_code: 'ABCD' }]),
    table('squad_players', [{ id: 'squad-1', coach_user_id: COACH.id, player_name: 'Omar Synthetic', position: 'Midfielder', linked_player_id: 'player-1' }]),
    table('coach_sessions', []), table('coach_details', []), table('coach_assessments', []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/squad_player_consent_required`, async ({ request }) => {
      calls.consentChecks.push(await request.json())
      if (consentRequired === 'error') return HttpResponse.json({ message: 'synthetic failure' }, { status: 500 })
      // After a refused save the screen re-asks; by then consent has been withdrawn.
      return HttpResponse.json(insertRefused ? calls.inserts > 0 : consentRequired)
    }),
    http.post(`${SUPABASE_URL}/rest/v1/coach_assessments`, () => {
      calls.inserts++
      return insertRefused
        ? HttpResponse.json(RLS_REFUSAL, { status: 403 })
        : HttpResponse.json([{ id: 'assess-1' }], { status: 201 })
    }),
  )
  return calls
}

async function choosePlayer() {
  renderApp('/coach/assess')
  const user = userEvent.setup()
  const option = await screen.findByRole('option', { name: 'Omar Synthetic' })
  await user.selectOptions(option.closest('select') as HTMLSelectElement, 'squad-1')
  return user
}

const saveButton = () => screen.getByRole('button', { name: /save assessment/i })
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent ?? '').join(' | ')

describe('CoachAssessPage and parental consent', () => {
  it('says a parent must approve, and disables Save, before the coach fills anything in', async () => {
    const calls = setup({ consentRequired: true })
    await choosePlayer()
    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
    expect(screen.getByText(/Omar Synthetic.*parent has approved/i)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(calls.consentChecks).toContainEqual({ p_squad_player_id: 'squad-1' })
  })

  // Control: without it, the test above passes on a screen that always blocks.
  it('shows no notice and allows saving when no consent is needed', async () => {
    const calls = setup({ consentRequired: false })
    const user = await choosePlayer()
    await waitFor(() => expect(calls.consentChecks.length).toBeGreaterThan(0))
    expect(screen.queryByText(/waiting for a parent/i)).not.toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(calls.inserts).toBe(1))
  })

  // The database is the gate, not this check. If the check itself fails, do
  // not block the coach on a guess; the save will be refused if it must be.
  it('does not block when the consent check itself fails', async () => {
    setup({ consentRequired: 'error' })
    await choosePlayer()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.queryByText(/waiting for a parent/i)).not.toBeInTheDocument()
  })

  it('translates a refusal at save time instead of showing the database error', async () => {
    const calls = setup({ consentRequired: false, insertRefused: true })
    const user = await choosePlayer()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(calls.inserts).toBe(1))
    await waitFor(() => expect(toastText()).toMatch(/parent/i))
    expect(toastText()).not.toMatch(/row-level security/i)
    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  // If the re-check after a refusal fails too, the screen cannot know why and
  // must not invent a reason (e.g. "you no longer have access").
  it('does not claim a reason when the re-check after a refusal also fails', async () => {
    const calls = setup({ consentRequired: 'error', insertRefused: true })
    const user = await choosePlayer()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(calls.inserts).toBe(1))
    await waitFor(() => expect(toastText()).toMatch(/could not be confirmed/i))
    expect(toastText()).not.toMatch(/no longer have access|row-level security/i)
  })
})

// Quick assess walks the whole squad one player at a time and is linked from
// Coach Home and the post-match prompt. Before this, an unconsented player
// answered "Could not save assessment. Please try again." every time.
describe('CoachQuickAssess and parental consent', () => {
  async function openQuick() {
    renderApp('/coach/quick-assess')
    const user = userEvent.setup()
    await screen.findByText('Omar Synthetic')
    return user
  }
  const nextButton = () => screen.getByRole('button', { name: /next/i })

  it('says a parent must approve, keeps Skip, and disables Next', async () => {
    setup({ consentRequired: true })
    await openQuick()
    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: /skip/i })).toBeEnabled()
  })

  it('shows no notice when no consent is needed (control)', async () => {
    const calls = setup({ consentRequired: false })
    await openQuick()
    await waitFor(() => expect(calls.consentChecks).toContainEqual({ p_squad_player_id: 'squad-1' }))
    expect(screen.queryByText(/waiting for a parent/i)).not.toBeInTheDocument()
  })

  it('translates a refusal at save time and never says "try again"', async () => {
    const calls = setup({ consentRequired: false, insertRefused: true })
    const user = await openQuick()
    await waitFor(() => expect(calls.consentChecks.length).toBeGreaterThan(0))
    // First assessment for this player: a slider must move before Next enables.
    const [first] = screen.getAllByRole('slider')
    fireEvent.change(first, { target: { value: '8' } })
    await waitFor(() => expect(nextButton()).toBeEnabled())
    await user.click(nextButton())
    await waitFor(() => expect(calls.inserts).toBe(1))
    await waitFor(() => expect(toastText()).toMatch(/parent/i))
    expect(toastText()).not.toMatch(/try again/i)
    expect(await screen.findByText(/waiting for a parent/i)).toBeInTheDocument()
  })
})
