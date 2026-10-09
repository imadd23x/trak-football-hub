/**
 * TRAK-11 phase 4 (J2/J3): a guardian the academy rostered approves a child
 * who has no account yet, and Trak then emails the child. Real App, router,
 * AuthProvider and Supabase SDK, with synthetic intercepted HTTP. The database
 * rules (who may consent, who may be emailed) are proven in SQL
 * (roster_consent_before_account.sql, roster_invite_targets.sql).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { CONSENT_NOTICE_VERSION, CONSENT_STATEMENT } from '@/lib/consent'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const endpoint = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`
const inviteUrl = `${SUPABASE_URL}/functions/v1/send-roster-invites`
const ana = { roster_child_id: '98b00000-0000-4000-8000-000000000070', first_name: 'Ana', age_years: 12 }
const consentId = '98b00000-0000-4000-8000-000000000099'

let sequence = 0
let session: Session
let rosterWaiting: unknown[]
let rosterReadStatus: number
let grants: unknown[]
let invites: unknown[]
let inviteReplies: { status: number; body: Record<string, unknown> }[]

function newSession(): Session {
  const id = `98b00000-0000-4000-8000-${String(100 + ++sequence).padStart(12, '0')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    + '.' + Buffer.from('synthetic-signature').toString('base64url')
  return {
    access_token: token, refresh_token: `synthetic-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    user: { id, email: `guardian-${sequence}@roster.test.invalid`, aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email' }, user_metadata: {},
      email_confirmed_at: '2026-09-27T08:00:00Z', created_at: '2026-09-27T08:00:00Z' },
  }
}

async function open(path: string) {
  const result = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
  expect(result.error).toBeNull()
  window.history.replaceState({}, '', path)
  render(<App />)
}

async function approveAna() {
  await screen.findByRole('heading', { name: "Approve Ana's account" })
  await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
  await userEvent.click(screen.getByRole('button', { name: "Approve Ana's account" }))
}

beforeEach(() => {
  vi.stubEnv('DEV', false)
  sessionStorage.clear()
  session = newSession()
  rosterWaiting = [ana]
  rosterReadStatus = 200
  grants = []
  invites = []
  inviteReplies = []
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, () => HttpResponse.json(session.user)),
    http.get(endpoint('profiles'), () => HttpResponse.json({ id: 'profile', user_id: session.user.id, role: 'parent',
      full_name: 'Guardian Synthetic', nationality: null, avatar_url: null })),
    // Ana has no account yet, so the guardian has no linked child.
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([])),
    http.post(endpoint('telemetry_events'), () => HttpResponse.json(null, { status: 201 })),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_roster_children_awaiting_consent'), () => rosterReadStatus === 200
      ? HttpResponse.json(rosterWaiting)
      : HttpResponse.json({ code: 'PGRST000', message: 'Synthetic roster read unavailable', details: null, hint: null }, { status: rosterReadStatus })),
    http.post(endpoint('rpc/record_roster_consent'), async ({ request }) => {
      grants.push(await request.json())
      rosterWaiting = []
      return HttpResponse.json(consentId)
    }),
    http.post(inviteUrl, async ({ request }) => {
      invites.push(await request.json())
      const reply = inviteReplies.shift() ?? { status: 200, body: { sent: 1, failed: 0, results: [{ kind: 'child', sent: true, via: 'invite' }] } }
      return HttpResponse.json(reply.body, { status: reply.status })
    }),
  )
})

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('TRAK-11 phase 4: approving a child who has no account yet', () => {
  it('tells the guardian on Home that the account-less child is waiting on them', async () => {
    await open('/parent/home')
    expect(await screen.findByText('Ana is waiting on your approval')).toBeInTheDocument()
  })

  it('records the consent against the roster place, then asks Trak to email the child once', async () => {
    await open('/parent/consent')
    await approveAna()
    await waitFor(() => expect(grants).toEqual([{
      p_roster_child_id: ana.roster_child_id,
      p_relationship: 'parent',
      p_purposes: { coaching_records: true, recognition: false },
      p_notice_version: CONSENT_NOTICE_VERSION,
      p_consent_text: CONSENT_STATEMENT,
    }]))
    expect(await screen.findByText("We've emailed Ana an invitation to join.")).toBeInTheDocument()
    expect(invites).toEqual([{ roster_child_id: ana.roster_child_id }])
  })

  it('lets the guardian send the invitation again, and says so when it fails', async () => {
    await open('/parent/consent')
    inviteReplies = [
      { status: 502, body: { sent: 0, failed: 1, results: [{ kind: 'child', sent: false, reason: 'delivery_failed' }] } },
    ]
    await approveAna()
    expect(await screen.findByText("We couldn't email Ana yet.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(await screen.findByText("We've emailed Ana an invitation to join.")).toBeInTheDocument()
    expect(invites).toHaveLength(2)
    expect(grants).toHaveLength(1)
  })

  it('shows a failed read as a failure, never as nothing to approve', async () => {
    rosterReadStatus = 503
    await open('/parent/consent')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load pending approvals")
    expect(screen.queryByText('Nothing to approve')).not.toBeInTheDocument()
  })
})
