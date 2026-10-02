/**
 * J5 (MVP Requirements): "The coach's squad marks each player 'Ready to assess'
 * or 'Waiting for parent'." A failed check must never read as ready.
 */
import { it, expect, describe } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { registerAuthUser } from '../../../../tests/msw/auth-sessions'
import { supabase } from '@/integrations/supabase/client'

const COACH = { id: 'coach-1' }

function setup(consent: Record<string, boolean | 'error'>) {
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', nationality: 'AE' }]),
    table('squad_players', [
      { id: 'sq-ready', coach_user_id: COACH.id, player_name: 'Amal Ready', position: 'Midfielder' },
      { id: 'sq-wait', coach_user_id: COACH.id, player_name: 'Bilal Waiting', position: 'Defender' },
      { id: 'sq-err', coach_user_id: COACH.id, player_name: 'Carim Unknown', position: 'Attacker' },
    ]),
    table('coach_assessments', []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
      const { p_squad_player_id: id } = await request.json() as { p_squad_player_id: string }
      const answer = consent[id]
      if (answer === 'error') return HttpResponse.json({ message: 'synthetic failure' }, { status: 500 })
      return HttpResponse.json(answer)
    }),
  )
}

const row = (name: string) => screen.getByText(name).closest('button') as HTMLElement

describe('squad consent status (J5)', () => {
  it('marks each player ready, waiting for a parent, or unknown when the check fails', async () => {
    setup({ 'sq-ready': false, 'sq-wait': true, 'sq-err': 'error' })
    renderApp('/coach/squad')
    await screen.findByText('Amal Ready')
    expect(await within(row('Amal Ready')).findByText('Ready to assess')).toBeInTheDocument()
    expect(within(row('Bilal Waiting')).getByText('Waiting for parent')).toBeInTheDocument()
    // A failed check is not a pass.
    expect(within(row('Carim Unknown')).getByText('Status unknown')).toBeInTheDocument()
    expect(within(row('Carim Unknown')).queryByText('Ready to assess')).toBeNull()
  })
})

/* TRAK-79. AuthContext hands out a new user object on every same-account token
   refresh (hourly, and on returning to the tab), which re-runs the squad load.
   The chips must stay on screen while the new checks run, not blink off. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

// A real SDK refresh. `as` switches to a different account, as a sign-in would.
function answerRefresh(as?: { id: string }) {
  server.use(http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
    const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
    const user = { ...structuredClone(previous.user), ...(as ? { id: as.id, email: `${as.id}@example.test` } : {}) }
    return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
  }))
}

async function refresh() {
  await act(async () => {
    const { error } = await supabase.auth.refreshSession()
    expect(error).toBeNull()
  })
}

/** From now on every consent check waits for `gate`, then answers `consent`. */
function holdChecks(gate: Promise<void>, consent: Record<string, boolean>) {
  let asked = 0
  server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
    const { p_squad_player_id: id } = await request.json() as { p_squad_player_id: string }
    asked++
    await gate
    return HttpResponse.json(consent[id] ?? false)
  }))
  return () => asked
}

describe('squad consent status across a token refresh (TRAK-79)', () => {
  it('keeps the chips on screen while a same-account refresh re-checks them', async () => {
    setup({ 'sq-ready': false, 'sq-wait': true, 'sq-err': false })
    answerRefresh()
    renderApp('/coach/squad')
    expect(await within(await screen.findByText('Amal Ready').then(() => row('Amal Ready'))).findByText('Ready to assess')).toBeInTheDocument()
    const gate = deferred()
    const asked = holdChecks(gate.promise, { 'sq-ready': false, 'sq-wait': true, 'sq-err': false })
    await refresh()
    await waitFor(() => expect(asked()).toBeGreaterThan(0))
    try {
      expect(within(row('Amal Ready')).queryByText('Ready to assess'), 'chip stays during the re-check').not.toBeNull()
      expect(within(row('Bilal Waiting')).queryByText('Waiting for parent'), 'chip stays during the re-check').not.toBeNull()
    } finally { await act(async () => { gate.resolve(); await gate.promise }) }
  })

  it('replaces a chip when the re-check answers differently', async () => {
    setup({ 'sq-ready': false, 'sq-wait': true, 'sq-err': false })
    answerRefresh()
    renderApp('/coach/squad')
    expect(await within(await screen.findByText('Amal Ready').then(() => row('Amal Ready'))).findByText('Ready to assess')).toBeInTheDocument()
    // Consent withdrawn for Amal since the page loaded.
    const gate = deferred()
    holdChecks(gate.promise, { 'sq-ready': true, 'sq-wait': true, 'sq-err': false })
    await refresh()
    await act(async () => { gate.resolve(); await gate.promise })
    expect(await within(row('Amal Ready')).findByText('Waiting for parent')).toBeInTheDocument()
    expect(within(row('Amal Ready')).queryByText('Ready to assess')).toBeNull()
  })

  it('a different account never sees the previous coach\'s players or chips', async () => {
    setup({ 'sq-ready': false, 'sq-wait': true, 'sq-err': false })
    answerRefresh({ id: 'coach-2' })
    renderApp('/coach/squad')
    expect(await within(await screen.findByText('Amal Ready').then(() => row('Amal Ready'))).findByText('Ready to assess')).toBeInTheDocument()
    const gate = deferred()
    server.use(
      table('profiles', [{ id: 'p2', user_id: 'coach-2', role: 'coach', full_name: 'Coach Two', nationality: 'AE' }]),
      http.get(`${SUPABASE_URL}/rest/v1/squad_players`, async () => { await gate.promise; return HttpResponse.json([]) }),
    )
    await refresh()
    try {
      await waitFor(() => expect(screen.queryByText('Amal Ready')).toBeNull())
      expect(screen.queryByText('Ready to assess')).toBeNull()
      expect(screen.queryByText('Waiting for parent')).toBeNull()
    } finally { await act(async () => { gate.resolve(); await gate.promise }) }
  })
})
