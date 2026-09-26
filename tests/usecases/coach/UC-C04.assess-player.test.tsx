import { it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto } from '../../msw/supabase'

const COACH = { id: 'coach-1' }
const SQUAD = [
  { id: 'squad-1', coach_user_id: COACH.id, player_name: 'Nikos Papadopoulos', position: 'Midfielder', shirt_number: 8 },
]

function signedInCoachWithSquad() {
  signInAs(COACH)
  server.use(
    // invite_code is set so CoachHomePage's invite-code effect doesn't try
    // to generate one and PATCH /profiles, which nothing here mocks.
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', nationality: 'GR', invite_code: 'ABCD' },
    ]),
    table('squad_players', SQUAD),
    // CoachAssessPage fetches the coach's past sessions for the required
    // session dropdown (TRAK-68), and coach_details on the destination home
    // screen; mock both up front so every test here can reach the form.
    table('coach_sessions', [{ id: 'session-1', coach_user_id: COACH.id, title: 'vs Synthetic FC', session_date: '2026-09-20' }]),
    table('coach_details', []),
  )
}

/*
 * The player <select> has no accessible name (its label is a plain <span>,
 * not a <label for>), and the redesigned screen added a second <select> for
 * the optional session — so `getByRole('combobox')` is now ambiguous between
 * the two. The player option we already wait for is unique to the player
 * select, so anchor off it with `.closest('select')` instead of guessing at
 * an index or an accessible name that doesn't exist.
 */
async function findPlayerSelect() {
  const option = await screen.findByRole('option', { name: 'Nikos Papadopoulos' })
  return option.closest('select') as HTMLSelectElement
}

// UC-C04 v2 (TRAK-68): the assessment belongs to a past session.
async function chooseSession(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: /vs Synthetic FC/ })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 'session-1')
}

useCase('UC-C04', () => {
  it('persists six distinct slider values to the correct columns and updates the band', async () => {
    signedInCoachWithSquad()
    const inserted: Record<string, unknown>[] = []
    server.use(
      insertInto('coach_assessments', body => {
        inserted.push(body)
        return { id: 'assess-1', ...body }
      }),
      // handleSave navigates to /coach/home on success, and CoachHomePage
      // fetches a coach_assessments count on mount — mock it so that
      // post-redirect request doesn't reach MSW unhandled.
      table('coach_assessments', []),
    )

    renderApp('/coach/assess')
    const user = userEvent.setup()

    // The precondition is "a coach with at least one squad player" — that
    // means the squad fetch has actually resolved, not merely that the
    // (initially empty) <select> exists. Wait for the real option to render
    // before selecting it, otherwise this selects against a placeholder-only
    // combobox and fails with "Value not found in options".
    const playerSelect = await findPlayerSelect()
    await user.selectOptions(playerSelect, 'squad-1')
    await chooseSession(user)

    // All six sliders default to 5 — an implementation that hardcoded 5 into
    // every column, or wired all six sliders to one shared value, would pass
    // a test that only ever submits the defaults. Drive each slider (native
    // <input type="range">, one per SliderInput in
    // src/pages/coach/CoachAssessPage.tsx, in the DOM order Work Rate,
    // Tactical, Attitude, Technical, Physical, Coachability — the same order
    // the payload asserts below) to six *distinct* values instead.
    const [workRate, tactical, attitude, technical, physical, coachability] =
      screen.getAllByRole('slider')
    fireEvent.change(workRate, { target: { value: '10' } })
    fireEvent.change(tactical, { target: { value: '9' } })
    fireEvent.change(attitude, { target: { value: '8' } })
    fireEvent.change(technical, { target: { value: '7' } })
    fireEvent.change(physical, { target: { value: '6' } })
    fireEvent.change(coachability, { target: { value: '5' } })

    // avg = (10+9+8+7+6+5)/6 = 7.5 -> scoreToBand clears the ">= 7" branch,
    // i.e. 'good' / "Good" — distinct from the default avg-5 "Mixed" band,
    // proving the band is derived from the six scores rather than fixed.
    const overallBandLabel = await screen.findByText('OVERALL BAND')
    const overallBandCard = overallBandLabel.parentElement as HTMLElement
    expect(within(overallBandCard).getByText('Good')).toBeInTheDocument()
    expect(within(overallBandCard).queryByText('Mixed')).not.toBeInTheDocument()

    // The submit button now reads "Save Assessment →", not "Submit Assessment".
    await user.click(screen.getByRole('button', { name: /save assessment/i }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({
      coach_user_id: COACH.id,
      squad_player_id: 'squad-1',
      session_id: 'session-1',
      work_rate: 10,
      tactical: 9,
      attitude: 8,
      technical: 7,
      physical: 6,
      coachability: 5,
    })
  })

  it('shows a band derived from the six scores before submitting', async () => {
    signedInCoachWithSquad()
    renderApp('/coach/assess')

    // All six sliders default to 5, so avg = 5. scoreToBand(5) in
    // src/lib/rating-engine.ts checks thresholds high-to-low (9/8/7/6/4/2)
    // and 5 clears the ">= 4" branch before the ">= 2" one, so it returns
    // 'mixed' — not 'developing' (that needs avg in [2, 4)). BANDS in
    // src/lib/types.ts renders 'mixed' as the word "Mixed". The registry
    // clause only requires *a* band derived from the six scores to be shown
    // before submitting — it does not name a particular word — so this
    // asserts the word the engine actually produces for the default scores,
    // verified against scoreToBand/BANDS rather than assumed.
    //
    // "Mixed" also appears once per slider (SliderInput shows a live
    // per-category band next to each of the six sliders), so a bare
    // `findByText('Mixed')` is ambiguous. Scope to the "OVERALL BAND" card,
    // which is what the registry clause actually means by "a band derived
    // from the six scores".
    const overallBandLabel = await screen.findByText('OVERALL BAND')
    const overallBandCard = overallBandLabel.parentElement as HTMLElement
    expect(within(overallBandCard).getByText('Mixed')).toBeInTheDocument()
  })

  it('refuses to submit until a player and a session are selected', async () => {
    signedInCoachWithSquad()
    const inserted: unknown[] = []
    server.use(
      insertInto('coach_assessments', body => { inserted.push(body); return { id: 'x', ...body } }),
    )

    renderApp('/coach/assess')
    const user = userEvent.setup()

    // Assert disabled the instant the button exists and this would pass even
    // if the squad never loaded, since the button starts disabled before any
    // player is selectable — that proves nothing about refusing submission
    // while a choice is available. Wait for the squad to load first, so the
    // disabled state is checked while a player genuinely could be chosen but
    // has not been.
    await findPlayerSelect()
    const submit = screen.getByRole('button', { name: /save assessment/i })
    expect(submit).toBeDisabled()

    // Clicking a disabled button should be inert. Verifying nothing was
    // inserted distinguishes "the click did nothing" from "the click
    // submitted anyway", matching the sibling assertion in
    // UC-C02.add-player.test.tsx.
    await user.click(submit)
    expect(inserted).toHaveLength(0)

    // A player alone is not enough: the session is required too (v2).
    await user.selectOptions(await findPlayerSelect(), 'squad-1')
    await screen.findByRole('option', { name: /vs Synthetic FC/ })
    expect(screen.getByRole('button', { name: /save assessment/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /save assessment/i }))
    expect(inserted).toHaveLength(0)
  })
})
