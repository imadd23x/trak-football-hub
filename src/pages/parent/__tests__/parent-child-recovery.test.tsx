import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const rosterId = '98c00000-0000-4000-8000-000000000030'
let sequence = 200, session: Session, failure: boolean, resetFailure: boolean, signOutFailed = false
let resetReply: { status: number; body: Record<string, string> } | null
let resets: { token: string | null; body: unknown }[], recoveries: unknown[]
function parentSession(): Session {
  const id = `98c00000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated' }]
    .map(p => Buffer.from(JSON.stringify(p)).toString('base64url')).join('.') + '.' + Buffer.from('synthetic-signature').toString('base64url')
  return { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: expiresAt, token_type: 'bearer',
    user: { id, email: 'parent@child-login.test', aud: 'authenticated', role: 'authenticated',
      email_confirmed_at: '2026-09-30T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-09-30T00:00:00Z' } }
}
beforeEach(() => {
  session = parentSession(); failure = false; resetFailure = false; signOutFailed = false; resetReply = null; resets = []; recoveries = []
  vi.stubEnv('DEV', false)
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, () => HttpResponse.json(session.user)),
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, () => HttpResponse.json([{ id: session.user.id, user_id: session.user.id,
      full_name: 'Synthetic Parent', role: 'parent', nationality: null }])),
    http.get(`${SUPABASE_URL}/rest/v1/player_parent_links`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/get_children_awaiting_consent`, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/get_my_child_credentials`, () => failure
      ? HttpResponse.json({ message: 'synthetic read failure' }, { status: 503 })
      : HttpResponse.json([{ roster_child_id: rosterId, first_name: 'Ana', username: 'striker7' }])),
    http.post(`${SUPABASE_URL}/functions/v1/reset-child-password`, async ({ request }) => {
      resets.push({ token: request.headers.get('authorization'), body: await request.json() })
      if (resetReply) return HttpResponse.json(resetReply.body, { status: resetReply.status })
      return resetFailure ? HttpResponse.json({ error: 'striker7@child.trakfootball.com private detail' }, { status: 503 })
        : HttpResponse.json({ state: signOutFailed ? 'password_updated_signout_failed' : 'password_updated' })
    }),
    http.post(`${SUPABASE_URL}/auth/v1/recover`, async ({ request }) => { recoveries.push(await request.json()); return HttpResponse.json({}) }),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
async function open(path = '/parent/profile') {
  expect((await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })).error).toBeNull()
  window.history.replaceState({}, '', path); render(<App />)
}
async function fillPassword() {
  await userEvent.click(await screen.findByRole('button', { name: 'Set a new password' }))
  await userEvent.type(screen.getByLabelText("Ana's new password"), 'Synthetic-Pass9!')
  await userEvent.type(screen.getByLabelText("Confirm Ana's password"), 'Synthetic-Pass9!')
}
it('Profile shows a username and resets that child using only the captured guardian token, then clears the password', async () => {
  await open()
  const card = await screen.findByRole('region', { name: "Ana's login" })
  expect(within(card).getByText('striker7')).toBeInTheDocument()
  await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Password set for Ana.')
  expect(resets).toEqual([{ token: `Bearer ${session.access_token}`, body: { roster_child_id: rosterId, password: 'Synthetic-Pass9!' } }])
  expect(screen.queryByLabelText("Ana's new password")).toBeNull()
  expect(recoveries).toEqual([])
  expect(document.body.textContent).not.toContain('child.trakfootball.com')
})
// TRAK-104: the reset also signs the child out of every device; the guardian
// is told when that half failed instead of seeing a plain success.
it('says the child is signed out everywhere after a reset', async () => {
  await open(); await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Password set for Ana. Ana is now signed out on every device.')
})
it('warns when the password changed but the sign-out did not, and never shows a plain success', async () => {
  signOutFailed = true; await open(); await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Ana's password changed, but we couldn't sign Ana out of other devices. Set the password again to retry.")
  expect(screen.queryByText(/Password set for Ana/)).toBeNull()
})
it('failed credential reads remain retryable errors and do not look like an empty list', async () => {
  failure = true; await open()
  const error = await screen.findByRole('alert')
  expect(error).toHaveTextContent("Couldn't load child logins")
  expect(screen.queryByText('striker7')).toBeNull()
  failure = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry child logins' }))
  expect(await screen.findByText('striker7')).toBeInTheDocument()
})
it('a refused reset exposes no technical address and never reports success', async () => {
  resetFailure = true; await open(); await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not set the password')
  expect(screen.queryByText('Password set for Ana.')).toBeNull()
  expect(document.body.textContent).not.toContain('child.trakfootball.com')
})
it('account switching removes the previous parent password form and data without starting a reset', async () => {
  await open(); await fillPassword()
  server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/get_my_child_credentials`, () => HttpResponse.json([])))
  session = parentSession()
  await act(async () => { await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }) })
  await waitFor(() => expect(screen.queryByLabelText("Ana's new password")).toBeNull())
  expect(screen.queryByText('striker7')).toBeNull()
  expect(resets).toEqual([])
})
it('the parent keeps normal email recovery for their own account', async () => {
  await open('/settings')
  await userEvent.click(await screen.findByRole('button', { name: 'Send reset email' }))
  await waitFor(() => expect(recoveries).toHaveLength(1))
  expect(recoveries[0]).toMatchObject({ email: 'parent@child-login.test' })
  expect(resets).toEqual([])
})

// TRAK-106 (TRAK-24 run 3, step 11): Auth refused a common password, and the
// card told the guardian to check their link and approval. Each failure now
// says what actually happened.
const WEAK = 'That password is too easy to guess (it appears in known leaks). Choose a different one.'
it('a too-common password says so, clears only the password fields and keeps the form open', async () => {
  resetReply = { status: 422, body: { reason: 'weak_password', error: 'That password is too easy to guess. Choose a different one.' } }
  await open(); await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(WEAK)
  expect(alert).not.toHaveTextContent(/approval/)
  expect(screen.getByLabelText("Ana's new password")).toHaveValue('')
  expect(screen.getByLabelText("Confirm Ana's password")).toHaveValue('')
  expect(screen.queryByText(/Password set for Ana/)).toBeNull()
})
it('only a refused guardian (403) is pointed at their link and approval', async () => {
  resetReply = { status: 403, body: { error: 'Use your linked guardian account with current approval' } }
  await open(); await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not set the password. Check your guardian link and approval, then try again.')
})
it('CONTROL any other failure says try again, with no approval wording and the password kept', async () => {
  resetReply = { status: 503, body: { error: 'Could not set the password. Please try again.' } }
  await open(); await fillPassword()
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not set the password. Please try again.')
  expect(alert).not.toHaveTextContent(/approval|too easy/)
  expect(screen.getByLabelText("Ana's new password")).toHaveValue('Synthetic-Pass9!')
})
