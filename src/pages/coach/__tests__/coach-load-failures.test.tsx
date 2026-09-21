import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, tableError } from '../../../../tests/msw/supabase'

/**
 * A failed load on a coach screen must not read as "you have nothing".
 *
 * UT-23. The player screens were fixed for this in #30 and the rule was written
 * down as UC-X02 — but the components and the use case both stayed on the
 * player side. The coach screens still use the shape #30 removed:
 *
 *     .then(({ data }) => setSessions(data || []))
 *
 * The error is never destructured, so a 500, a permission denial and a genuinely
 * empty list are the same value by the time the component sees them: `[]`.
 * CLAUDE.md states the rule directly — "Always inspect query errors; a failed
 * request is not an empty result" — and these call sites predate it.
 *
 * Why it matters more for a coach than it reads: the empty copy is a factual
 * claim about their squad. A coach who opens Sessions on a bad connection is
 * told "No sessions logged yet" — about sessions they logged themselves. The
 * fix is not cosmetic; the screen is currently lying about data the coach
 * created.
 *
 * These render the real screens through the real Supabase SDK, with MSW
 * supplying the failure. A test that called a helper would not have caught it,
 * because there is no helper — the defect is the absent `error` binding at the
 * call site.
 *
 * One mount at a time, per the lesson from #44: four blocks mounting one page
 * into a single jsdom left exactly one mounted, and which one varied between
 * runs.
 */

const COACH = { id: 'coach-1' }

function signedInCoach() {
  signInAs(COACH)
  server.use(
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' },
    ]),
  )
}

/**
 * Waits for the screen's own request to land, rather than for a heading.
 *
 * Every one of these screens renders its chrome synchronously, so asserting on
 * the title proves only that React mounted — not that the failure was
 * processed. Without this the "no empty-state copy" assertions would pass
 * against a screen that had not yet received anything.
 */
async function requestSettled(fragment: string, run: () => void) {
  let landed = false
  const onResponse = ({ request }: { request: Request }) => {
    if (request.url.includes(fragment)) landed = true
  }
  server.events.on('response:mocked', onResponse)
  try {
    run()
    await waitFor(() => expect(landed).toBe(true))
  } finally {
    server.events.removeListener('response:mocked', onResponse)
  }
}

afterEach(() => cleanup())

describe('a failed coach load is not an empty squad', () => {
  describe('Sessions', () => {
    it('shows a retryable error rather than "No sessions logged yet"', async () => {
      signedInCoach()
      server.use(tableError('coach_sessions', 500, { message: 'upstream unavailable' }))

      await requestSettled('/coach_sessions', () => renderApp('/coach/sessions/list'))

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      // The precise harm: the coach is told their own logged sessions are absent.
      expect(screen.queryByText(/no sessions logged yet/i)).not.toBeInTheDocument()
    })

    it('still shows the empty message when the request SUCCEEDS and returns nothing', async () => {
      // The control. Without it, a fix that showed the error banner
      // unconditionally would pass the test above and break the real empty
      // state — which is a legitimate thing a new coach sees on day one.
      signedInCoach()
      server.use(table('coach_sessions', []))

      await requestSettled('/coach_sessions', () => renderApp('/coach/sessions/list'))

      expect(await screen.findByText(/no sessions logged yet/i)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('renders the sessions when the request succeeds with rows', async () => {
      signedInCoach()
      server.use(table('coach_sessions', [
        { id: 's-1', coach_user_id: COACH.id, title: 'Finishing', session_type: 'training',
          session_date: '2026-09-15', notes: null },
      ]))

      await requestSettled('/coach_sessions', () => renderApp('/coach/sessions/list'))

      expect(await screen.findByText('Finishing')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('Home', () => {
    /* The dashboard is the worst instance, because it does not render an empty
       list — it renders NUMBERS. Four independent loads each discarded their
       error, so a failed dashboard read "0 players · 0 total · 0 sessions":
       not a blank screen the coach would distrust, but a precise and false
       report about a season they built themselves. */
    it('does not report a squad of zero when the squad could not be loaded', async () => {
      signedInCoach()
      server.use(tableError('squad_players', 500, { message: 'upstream unavailable' }))

      await requestSettled('/squad_players', () => renderApp('/coach/home'))

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      // The specific lie: a confident zero where the answer is "we could not ask".
      expect(screen.queryByText('Players in squad')?.previousElementSibling?.textContent)
        .not.toBe('0')
    })

    it('does not claim "0 total" assessments when that read failed', async () => {
      signedInCoach()
      server.use(
        table('squad_players', [
          { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor' },
        ]),
        tableError('coach_assessments', 500, { message: 'upstream unavailable' }),
      )

      await requestSettled('/coach_assessments', () => renderApp('/coach/home'))

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.queryByText(/^0 total$/)).not.toBeInTheDocument()
    })

    it('still shows real zeros for a brand-new coach whose reads SUCCEED', async () => {
      // The control, and it matters more here than on Sessions: a new coach
      // genuinely has 0 players and 0 assessments on day one, and that is a
      // true statement the screen must keep making.
      signedInCoach()
      server.use(
        table('squad_players', []),
        table('coach_assessments', []),
        table('coach_sessions', []),
      )

      await requestSettled('/squad_players', () => renderApp('/coach/home'))

      expect(await screen.findByText('Players in squad')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })
  })
})
