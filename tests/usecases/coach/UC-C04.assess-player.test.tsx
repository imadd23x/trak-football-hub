import { it, expect } from 'vitest'
import { setSlider, sliderValue, sliderDisabled } from '../../support/slider'
import { assessStep, nextButton, saveAssessment } from '../../support/assess-steps'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { table, insertInto, rpc, SUPABASE_URL } from '../../msw/supabase'
import { http, HttpResponse } from 'msw'

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
    // TRAK-100: the dropdown lists only sessions the player was marked present at.
    table('session_attendance', [{ session_id: 'session-1', squad_player_id: 'squad-1', status: 'present' }]),
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
    // a test that only ever submits the defaults. Drive each slider (Arc's
    // elastic slider, by keyboard; one per SliderInput in
    // src/pages/coach/CoachAssessPage.tsx, in the DOM order Work Rate,
    // Tactical, Attitude, Technical, Physical, Coachability — the same order
    // the payload asserts below) to six *distinct* values instead.
    // TRAK-182: the sliders are the Ratings step.
    await assessStep('Ratings')
    const [workRate, tactical, attitude, technical, physical, coachability] =
      screen.getAllByRole('slider')
    setSlider(workRate, 10)
    setSlider(tactical, 9)
    setSlider(attitude, 8)
    setSlider(technical, 7)
    setSlider(physical, 6)
    setSlider(coachability, 5)

    // avg = (10+9+8+7+6+5)/6 = 7.5 -> scoreToBand clears the ">= 7" branch,
    // i.e. 'good' / "Good" — distinct from the default avg-5 "Mixed" band,
    // proving the band is derived from the six scores rather than fixed.
    const overallBandLabel = await screen.findByText('OVERALL BAND')
    const overallBandCard = overallBandLabel.parentElement as HTMLElement
    expect(within(overallBandCard).getByText('Good')).toBeInTheDocument()
    expect(within(overallBandCard).queryByText('Mixed')).not.toBeInTheDocument()

    // TRAK-182: saving is the Review step's (Save, with no message).
    await saveAssessment()

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
  }, 20_000) // TRAK-182: walking the steps; CI under load needs more than 5 s.

  it('shows a band derived from the six scores before submitting', async () => {
    signedInCoachWithSquad()
    server.use(table('coach_assessments', []))
    renderApp('/coach/assess')
    const user = userEvent.setup()
    await user.selectOptions(await findPlayerSelect(), 'squad-1')
    await chooseSession(user)
    await assessStep('Ratings')

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
  }, 20_000) // TRAK-182: walking the steps; CI under load needs more than 5 s.

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
    // TRAK-182: the first step's Next is the way to the save; it stays shut.
    await findPlayerSelect()
    const submit = nextButton()
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
    expect(nextButton()).toBeDisabled()
    await user.click(nextButton())
    expect(inserted).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^(Save|Publish)$/ })).toBeNull()
  }, 20_000) // TRAK-182: walking the steps; CI under load needs more than 5 s.

  // v3 (TRAK-364): where the season plan is on and the squad's plan is shared, the due evaluation publishes all six
  // scores for each consented player, from their latest scores, with no session (the function writes session_id NULL;
  // supabase/tests/season_evaluations.sql proves the rows).
  it('publishes the six scores per consented player, from their latest, with no session, in an evaluation', async () => {
    signedInCoachWithSquad()
    // Its own coach: the app's query cache outlives a test, and the earlier ones' squad has no age group.
    const coach = { id: 'coach-uc-c04-evaluation' }
    signInAs(coach)
    const DAY = 86_400_000
    const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
    const published: Record<string, unknown>[] = []
    server.use(
      table('profiles', [{ id: 'p-eval', user_id: coach.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
      table('squad_players', [{ ...SQUAD[0], coach_user_id: coach.id, age_group: 'U16', status: 'active', linked_player_id: 'child-1', created_at: '2026-08-01T08:00:00Z' }]),
      table('coach_details', [{ user_id: coach.id, organization_id: 'org-1' }]),
      table('organizations', [{ id: 'org-1', time_zone: 'Asia/Dubai' }]),
      rpc('feature_on', ({ p_feature }) => p_feature === 'season_plan'),
      rpc('coach_squad_player_consent_required', () => false),
      table('season_plans', [{ id: 'plan-1', squad: 'U16', starts_on: day(-120), ends_on: day(200), shared_at: new Date(Date.now() - 90 * DAY).toISOString(),
        unshared_parts: [], unshared_players: [], eval_every: '2w', eval_day: 0 }]),
      table('season_evaluations', []), table('player_objectives', []), rpc('stuck_player_objectives', () => []),
      table('coach_assessments', [{ squad_player_id: 'squad-1', created_at: '2026-08-20T10:00:00Z', published_at: '2026-08-20T10:00:00Z',
        work_rate: 8, tactical: 7, attitude: 6, technical: 5, physical: 4, coachability: 3 }]),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/publish_evaluation_with_objectives`, async ({ request }) => {
        const args = await request.json() as Record<string, unknown> & { p_players: { squad_player_id: string }[] }
        published.push(args)
        return HttpResponse.json({ evaluation_id: 'ev-1', assessments: args.p_players.map(p => ({ squad_player_id: p.squad_player_id, assessment_id: 'as-1' })) })
      }),
    )
    renderApp('/coach/evaluation')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Nikos Papadopoulos/ }))
    // The band follows the six scores here too: 8+7+6+5+4+3 is 5.5, Mixed; Coachability up to 9 makes 6.5, Steady.
    expect(screen.getByText('From last time: Mixed, 5.5. Move only what changed.')).toBeInTheDocument()
    setSlider(screen.getAllByRole('slider')[5], 9)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    expect(within(screen.getByRole('region', { name: 'What changed' })).getByText('Mixed → Steady')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish to 1 player' }))
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0]).toMatchObject({ p_plan_id: 'plan-1', p_players: [{ squad_player_id: 'squad-1',
      work_rate: 8, tactical: 7, attitude: 6, technical: 5, physical: 4, coachability: 9, note: '' }] })
    expect(published[0]).not.toHaveProperty('p_players.0.session_id')
  }, 20_000)
})
