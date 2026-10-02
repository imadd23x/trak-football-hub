import { it, expect } from 'vitest'
import { act, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { registerAuthUser } from '../../../../tests/msw/auth-sessions'
import { supabase } from '@/integrations/supabase/client'

// TRAK-79, from Tarek's #149 review: after a FAILED first load, a same-account token
// refresh must not replace the error with the empty-squad screen (a false
// empty squad, UC-X02) while the new read is still in flight. Checked by the
// error staying on screen, so it holds whatever the empty screen says (#134
// changed it from "Add your first player").
it('keeps a squad load failure on screen, not an empty squad, while a refresh re-reads', async () => {
  const COACH = { id: 'coach-1' }
  signInAs(COACH)
  let fail = true
  let release!: () => void
  const pending = new Promise<void>(r => { release = r })
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', nationality: 'AE' }]),
    table('coach_assessments', []),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, async () => {
      if (fail) return HttpResponse.json({ message: 'synthetic failure' }, { status: 500 })
      await pending
      return HttpResponse.json([{ id: 'sq-1', coach_user_id: COACH.id, player_name: 'Amal Ready', position: 'Midfielder' }])
    }),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
      const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
      const user = structuredClone(previous.user)
      return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
    }),
  )
  renderApp('/coach/squad')
  await screen.findByText("Couldn't load your squad")
  fail = false
  await act(async () => { const { error } = await supabase.auth.refreshSession(); expect(error).toBeNull() })
  const errorKept = screen.queryByText("Couldn't load your squad") !== null
  const falseEmpty = screen.queryByText(/Your squad is being prepared|Add your first player/) !== null
  await act(async () => { release(); await pending; await new Promise(r => setTimeout(r, 50)) })
  expect(errorKept, 'the load failure stays on screen while the refreshed read is pending').toBe(true)
  expect(falseEmpty, 'an empty squad was shown while the refreshed read was pending').toBe(false)
  expect(await screen.findByText('Amal Ready')).toBeInTheDocument()
})
