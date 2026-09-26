/**
 * TRAK-12 (G3), decided 26 Sep (option (a)): staff are set up by Trak. The
 * database refuses a self-made coach or academy admin and any code-join
 * (#151). The screens must not offer what the backend refuses: no coach or
 * administrator self-signup, and no "enter your academy's code" on a coach's
 * profile. Real App, AuthProvider and SDK, with MSW behind them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { signInAs } from '../../../tests/support/session'
import { server } from '../../../tests/msw/server'
import { table, SUPABASE_URL } from '../../../tests/msw/supabase'

afterEach(() => cleanup())

describe('TRAK-12: staff are set up by Trak', () => {
  it('"I am a…" offers player and parent signup only, and says who sets up staff', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await user.click(await screen.findByRole('button', { name: /create account/i }))
    // Scoped to the "I am a…" panel: the dev quick-login panel has role buttons too.
    const panel = (await screen.findByText('I am a…')).parentElement as HTMLElement
    expect(within(panel).getByRole('button', { name: /^Player/ })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /^Parent/ })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /^Coach/ })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /^Administrator/ })).toBeNull()
    expect(within(panel).getByText(/Trak sets up coach and academy accounts/i)).toBeInTheDocument()
  })

  it.each(['coach', 'club'])('/onboarding/%s explains that Trak sets up staff, with no form', async role => {
    renderApp(`/onboarding/${role}`)
    expect(await screen.findByText(/Trak sets up coach and academy accounts/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/Registration/)).toBeNull()
  })

  it("a coach in no academy is told Trak sets it, with no code to type and no join request", async () => {
    const COACH = { id: 'coach-no-academy' }
    signInAs(COACH)
    const joins: string[] = []
    server.use(
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Synthetic', invite_code: 'SYNTH1' }]),
      table('coach_details', [{ user_id: COACH.id, organization_id: null, current_club: null, team: null, coach_role: null }]),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/join_organization`, ({ request }) => {
        joins.push(request.url)
        return HttpResponse.json(null)
      }),
    )
    renderApp('/coach/profile')
    expect(await screen.findByText(/Your academy is set by Trak/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('TRK-XXXX')).toBeNull()
    expect(screen.queryByRole('button', { name: /^join$/i })).toBeNull()
    await waitFor(() => expect(joins).toEqual([]))
  })

  // The academy code no longer lets a coach in, so an administrator must not be
  // told to hand it out for that.
  it.each(['/club/profile', '/club/home', '/club/coaches'])(
    '%s tells an academy administrator that Trak adds their coaches',
    async path => {
      const ADMIN = { id: 'admin-no-coaches' }
      signInAs(ADMIN)
      server.use(
        table('profiles', [{ id: 'p', user_id: ADMIN.id, role: 'club', full_name: 'Admin Synthetic' }]),
        table('organizations', [{ id: 'org-1', name: 'Synthetic Academy', join_code: 'SYNORG', admin_user_id: ADMIN.id }]),
        table('coach_details', []),
      )
      renderApp(path)
      expect(await screen.findByText(/Trak adds coaches to your academy/i)).toBeInTheDocument()
      expect(screen.queryByText(/so they can join your academy/i)).toBeNull()
      expect(screen.queryByText(/share your academy code/i)).toBeNull()
    },
  )
})
