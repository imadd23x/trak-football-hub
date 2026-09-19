/**
 * Cross-feature shared-phone regression: real App, router, AuthProvider,
 * family provider and Supabase SDK; every HTTP response is synthetic.
 * This proves client isolation, not server consent/RLS or email delivery.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { CONSENT_NOTICE_VERSION, CONSENT_STATEMENT } from '@/lib/consent'
import type { ParentMatch } from '@/lib/parent-data'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const password = 'Synthetic-only-Password123!'
const childA = { user_id: '99700000-0000-4000-8000-000000000001', full_name: 'Alex Synthetic' }
const siblingA = { user_id: '99700000-0000-4000-8000-000000000002', full_name: 'Zara Synthetic' }
const childB = { user_id: '99700000-0000-4000-8000-000000000003', full_name: 'Sam Synthetic' }
const pendingChild = { player_user_id: childA.user_id, full_name: childA.full_name, age_years: 12 }
const consentId = '99700000-0000-4000-8000-000000000004'
const expectedGrant = {
  p_player_user_id: childA.user_id,
  p_relationship: 'parent',
  p_purposes: { coaching_records: true, recognition: false, parent_visibility: false },
  p_notice_version: CONSENT_NOTICE_VERSION,
  p_consent_text: CONSENT_STATEMENT,
}

interface RecordedRequest { parentId: string; token: string; body: unknown }
let parentA: Session
let parentB: Session
let sessions: Map<string, Session>
let grants: RecordedRequest[]
let completedGrants: string[]
let abortedGrants: string[]
let pendingReads: string[]
let logouts: string[]
let logins: unknown[]
let unexpected: string[]
let releaseGrant: () => void
let grantWait: Promise<void>
let releaseHistory: () => void
let profileNames: Map<string, string>
let sequence = 0

function newSession(label: string): Session {
  // Unique account IDs isolate the real App's module-level QueryClient.
  const id = `99700000-0000-4000-8000-${String(100 + ++sequence).padStart(12, '0')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    + '.' + Buffer.from('synthetic-signature').toString('base64url')
  const account: Session = {
    access_token: token, refresh_token: `synthetic-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    user: { id, email: `parent-${label}@account-integration.test.invalid`, aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email' }, user_metadata: {},
      email_confirmed_at: '2026-09-18T08:00:00Z', created_at: '2026-09-18T08:00:00Z' },
  }
  sessions.set(token, account)
  return account
}

function authenticated(request: Request): Session {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const account = sessions.get(token)
  expect(account, 'Every protected HTTP request must carry a known synthetic JWT').toBeDefined()
  if (!account) throw new Error('Unknown synthetic account')
  return account
}

function childrenFor(account: Session) {
  return account.user.id === parentA.user.id ? [childA, siblingA] : [childB]
}

function assertChildFilter(request: Request, column: string) {
  const account = authenticated(request)
  const filter = new URL(request.url).searchParams.get(column)
  expect(childrenFor(account).map(child => `eq.${child.user_id}`)).toContain(filter)
}

beforeEach(() => {
  sessionStorage.clear()
  sessions = new Map()
  parentA = newSession('a')
  parentB = newSession('b')
  profileNames = new Map([[parentA.user.id, 'Synthetic Parent A'], [parentB.user.id, 'Synthetic Parent B']])
  releaseHistory = () => {}
  grants = []; completedGrants = []; abortedGrants = []; pendingReads = []; logouts = []; logins = []; unexpected = []
  grantWait = new Promise<void>(resolve => { releaseGrant = resolve })
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => HttpResponse.json(authenticated(request).user)),
    http.post(`${SUPABASE_URL}/auth/v1/token`, async ({ request }) => {
      expect(new URL(request.url).searchParams.get('grant_type')).toBe('password')
      const body: unknown = await request.json()
      logins.push(body)
      expect(body).toMatchObject({ email: parentB.user.email, password })
      return HttpResponse.json(parentB)
    }),
    http.post(`${SUPABASE_URL}/auth/v1/logout`, ({ request }) => {
      const account = authenticated(request)
      logouts.push(account.user.id)
      // The first real SDK logout must fail without removing A's session.
      return logouts.length === 1
        ? HttpResponse.json({ message: 'Synthetic logout unavailable' }, { status: 503 })
        : new HttpResponse(null, { status: 204 })
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const account = authenticated(request)
      const query = new URL(request.url).searchParams
      if (query.get('select') === 'user_id,full_name') {
        const children = childrenFor(account)
        expect(query.get('user_id')).toBe(`in.(${children.map(child => child.user_id).sort().join(',')})`)
        return HttpResponse.json(children)
      }
      expect(query.get('user_id')).toBe(`eq.${account.user.id}`)
      expect(['*', 'role']).toContain(query.get('select'))
      return HttpResponse.json(query.get('select') === 'role' ? [{ role: 'parent' }]
        : [{ id: account.user.id, user_id: account.user.id, role: 'parent',
          full_name: profileNames.get(account.user.id),
          nationality: null, avatar_url: null }])
    }),
    http.get(endpoint('player_parent_links'), ({ request }) => {
      const account = authenticated(request)
      const query = new URL(request.url).searchParams
      expect(query.get('parent_user_id')).toBe(`eq.${account.user.id}`)
      expect(query.get('select')).toBe('player_user_id')
      return HttpResponse.json(childrenFor(account).map(child => ({ player_user_id: child.user_id })))
    }),
    http.post(endpoint('rpc/get_children_awaiting_consent'), async ({ request }) => {
      const account = authenticated(request)
      expect(await request.json()).toEqual({})
      pendingReads.push(account.user.id)
      return HttpResponse.json(account.user.id === parentA.user.id ? [pendingChild] : [])
    }),
    http.post(endpoint('rpc/record_parental_consent'), async ({ request }) => {
      const account = authenticated(request)
      grants.push({ parentId: account.user.id, token: request.headers.get('authorization')!, body: await request.json() })
      request.signal.addEventListener('abort', () => { abortedGrants.push(account.user.id) }, { once: true })
      await grantWait
      // Client cancellation cannot undo a write the server may have received.
      completedGrants.push(account.user.id)
      return HttpResponse.json(consentId)
    }),
    http.post(endpoint('rpc/get_parent_match_summary'), async ({ request }) => {
      const account = authenticated(request)
      const body = await request.json() as { p_child_id: string }
      expect(childrenFor(account).map(child => child.user_id)).toContain(body.p_child_id)
      return HttpResponse.json([{ total_count: 0, rated_count: 0, average_rating: null, wins: 0, draws: 0, losses: 0 }])
    }),
    http.get(endpoint('matches'), ({ request }) => {
      assertChildFilter(request, 'user_id')
      expect(new URL(request.url).searchParams.get('limit')).toBe('5')
      return HttpResponse.json([])
    }),
    http.get(endpoint('player_details'), ({ request }) => {
      assertChildFilter(request, 'user_id')
      return HttpResponse.json([])
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      assertChildFilter(request, 'linked_player_id')
      return HttpResponse.json([])
    }),
    http.post(endpoint('telemetry_events'), async ({ request }) => {
      const account = authenticated(request)
      expect(await request.json()).toMatchObject({ user_id: account.user.id, event_type: 'app_opened' })
      return new HttpResponse(null, { status: 201 })
    }),
    // Includes profile/password/provisioning writes unless a test explicitly
    // configures one below. Unknown requests never reach a real service.
    http.all('*', ({ request }) => {
      unexpected.push(`${request.method} ${request.url}`)
      return HttpResponse.json({ message: 'Unexpected request blocked by account integration fixture' }, { status: 500 })
    }),
  )
})

afterEach(() => {
  cleanup()
  releaseGrant()
  releaseHistory()
  expect(unexpected).toEqual([])
})

describe('parent consent, history and Settings on a shared phone', () => {
  it('keeps B’s family, draft, route and session after A’s held approval completes across failed/retried logout', async () => {
    const user = userEvent.setup()
    const result = await supabase.auth.setSession({ access_token: parentA.access_token, refresh_token: parentA.refresh_token })
    expect(result.error).toBeNull()
    window.history.replaceState({}, '', '/parent/home')
    render(<App />)
    await screen.findByRole('heading', { name: childA.full_name })
    await user.click(screen.getByRole('button', { name: /Alex Synthetic is waiting on your approval/ }))
    await screen.findByRole('heading', { name: "Approve Alex's account" })
    await user.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await user.click(screen.getByRole('button', { name: "Approve Alex's account" }))
    await waitFor(() => expect(grants).toEqual([{
      parentId: parentA.user.id, token: `Bearer ${parentA.access_token}`, body: expectedGrant,
    }]))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(completedGrants).toEqual([])

    // Real browser history returns to the existing Home route; no router or
    // application hooks are mocked to force an unsupported account lifecycle.
    await act(async () => { window.history.back() })
    await screen.findByRole('heading', { name: 'Home' })
    // Observe the actual SDK fetch's cancellation, not just completion of the
    // synthetic server handler. Its later reply cannot revive this client.
    await waitFor(() => expect(abortedGrants).toEqual([parentA.user.id]))
    await user.click(screen.getByRole('button', { name: 'Profile' }))
    await user.click(await screen.findByRole('button', { name: /^SETTINGS / }))
    const aFamily = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(aFamily).getByText(childA.full_name)).toBeInTheDocument()
    expect(within(aFamily).getByText(siblingA.full_name)).toBeInTheDocument()
    expect(within(aFamily).queryByText(childB.full_name)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByText('Could not sign out. You are still signed in on this device. Check your connection and try again.')
    expect(window.location.pathname).toBe('/settings')
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe(parentA.user.id)
    expect(screen.getByRole('button', { name: 'Synthetic Parent A' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Linked children' })).getAllByRole('listitem')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('button', { name: 'Sign in' })
    expect((await supabase.auth.getSession()).data.session).toBeNull()
    expect(screen.queryByRole('list', { name: 'Linked children' })).not.toBeInTheDocument()
    expect(logouts).toEqual([parentA.user.id, parentA.user.id])

    // B enters via the real sign-in form and provider transition queue.
    await user.type(screen.getByLabelText('Email'), parentB.user.email!)
    await user.type(screen.getByLabelText('Password'), password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: childB.full_name })
    await user.click(screen.getByRole('button', { name: 'Profile' }))
    await user.click(await screen.findByRole('button', { name: /^SETTINGS / }))
    const bFamily = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(bFamily).getAllByRole('listitem')).toHaveLength(1)
    expect(within(bFamily).getByText(childB.full_name)).toBeInTheDocument()
    expect(within(bFamily).queryByText(childA.full_name)).not.toBeInTheDocument()
    expect(within(bFamily).queryByText(siblingA.full_name)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Synthetic Parent B' }))
    const draft = screen.getByRole('textbox')
    await user.clear(draft)
    await user.type(draft, 'Parent B unfinished draft')
    const readsBeforeCompletion = [...pendingReads]

    await act(async () => { releaseGrant(); await grantWait })
    await waitFor(() => expect(completedGrants).toEqual([parentA.user.id]))
    expect(abortedGrants).toEqual([parentA.user.id])
    expect(window.location.pathname).toBe('/settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('Parent B unfinished draft')
    expect(screen.queryByText(/Approval saved for Alex/)).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Linked children' })).toHaveTextContent(childB.full_name)
    expect(screen.queryByText(childA.full_name)).not.toBeInTheDocument()
    expect(screen.queryByText(siblingA.full_name)).not.toBeInTheDocument()
    const currentSession = (await supabase.auth.getSession()).data.session
    expect(currentSession?.user.id).toBe(parentB.user.id)
    expect(currentSession?.access_token).toBe(parentB.access_token)
    expect(pendingReads).toEqual(readsBeforeCompletion)
    expect(grants).toHaveLength(1)
    expect(logouts).toEqual([parentA.user.id, parentA.user.id])
    expect(logins).toHaveLength(1)
    expect(unexpected).toEqual([])
  })

  it('preserves Zara through a Settings name save, then isolates B’s first history page from A’s late next-page response', async () => {
    const user = userEvent.setup()
    const historyWait = new Promise<void>(resolve => { releaseHistory = resolve })
    const pageRequests: RecordedRequest[] = []
    const summaryRequests: RecordedRequest[] = []
    const nameWrites: RecordedRequest[] = []
    const abortedHistory: string[] = []
    const completedHistory: string[] = []
    const savedName = 'Synthetic Parent A Updated'
    const match = (name: string, index: number): ParentMatch => ({
      id: `99700000-0000-4000-8000-${String(700 + index).padStart(12, '0')}`,
      match_date: '2026-09-01', created_at: new Date(Date.UTC(2026, 8, 1, 12, -index)).toISOString(),
      opponent: name, competition: 'Synthetic league', venue: 'Home', computed_rating: 7,
      team_score: 2, opponent_score: 1,
    })
    const alexMatches = [match('Alex opponent', 100)]
    const zaraMatches = Array.from({ length: 51 }, (_, index) => match(`Zara opponent ${index + 1}`, index))
    const samMatches = [match('Sam first opponent', 200), match('Sam second opponent', 201)]
    const histories = new Map([[childA.user_id, alexMatches], [siblingA.user_id, zaraMatches], [childB.user_id, samMatches]])

    server.use(
      http.patch(endpoint('profiles'), async ({ request }) => {
        const account = authenticated(request)
        const query = new URL(request.url).searchParams
        const body: unknown = await request.json()
        expect(account.user.id).toBe(parentA.user.id)
        expect(query.get('user_id')).toBe(`eq.${parentA.user.id}`)
        expect(query.get('select')).toBe('user_id,full_name')
        expect(body).toEqual({ full_name: savedName })
        nameWrites.push({ parentId: account.user.id, token: request.headers.get('authorization')!, body })
        profileNames.set(account.user.id, savedName)
        return HttpResponse.json([{ user_id: account.user.id, full_name: savedName }])
      }),
      http.post(endpoint('rpc/get_parent_match_summary'), async ({ request }) => {
        const account = authenticated(request)
        const body = await request.json() as { p_child_id: string }
        expect(childrenFor(account).map(child => child.user_id)).toContain(body.p_child_id)
        const rows = histories.get(body.p_child_id)
        expect(rows).toBeDefined()
        summaryRequests.push({ parentId: account.user.id, token: request.headers.get('authorization')!, body })
        return HttpResponse.json([{ total_count: rows!.length, rated_count: rows!.length,
          average_rating: 7, wins: rows!.length, draws: 0, losses: 0 }])
      }),
      http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
        const account = authenticated(request)
        const body = await request.json() as { p_child_id: string; p_after_id: string | null }
        expect(childrenFor(account).map(child => child.user_id)).toContain(body.p_child_id)
        const rows = histories.get(body.p_child_id)
        expect(rows).toBeDefined()
        pageRequests.push({ parentId: account.user.id, token: request.headers.get('authorization')!, body })
        if (body.p_after_id !== null) {
          const cursor = zaraMatches[49]
          expect(account.user.id).toBe(parentA.user.id)
          expect(body).toEqual({ p_child_id: siblingA.user_id, p_after_id: cursor.id,
            p_after_match_date: cursor.match_date, p_after_created_at: cursor.created_at, p_limit: 51 })
          request.signal.addEventListener('abort', () => { abortedHistory.push(account.user.id) }, { once: true })
          await historyWait
          completedHistory.push(account.user.id)
          return HttpResponse.json([zaraMatches[50]])
        }
        expect(body).toEqual({ p_child_id: body.p_child_id, p_after_id: null,
          p_after_match_date: null, p_after_created_at: null, p_limit: 51 })
        return HttpResponse.json(rows)
      }),
    )

    const signedIn = await supabase.auth.setSession({ access_token: parentA.access_token, refresh_token: parentA.refresh_token })
    expect(signedIn.error).toBeNull()
    window.history.replaceState({}, '', '/parent/matches')
    render(<App />)
    await screen.findByText('Alex opponent')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Following' }), siblingA.user_id)
    await screen.findByText('51 recorded matches · all history')
    await screen.findByText('Zara opponent 1')
    expect(screen.getAllByText(/^Zara opponent /)).toHaveLength(50)
    expect(screen.queryByText('Zara opponent 51')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Loading next page…')
    await waitFor(() => expect(pageRequests).toHaveLength(3))
    expect(pageRequests[2]).toMatchObject({ parentId: parentA.user.id, token: `Bearer ${parentA.access_token}`,
      body: { p_child_id: siblingA.user_id, p_after_id: zaraMatches[49].id } })
    expect(completedHistory).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Profile' }))
    await screen.findByText('Following Zara Synthetic · 2 children linked')
    // Route departure cancels the client fetch even though the synthetic
    // server is still processing A's page. Observe both sides separately.
    await waitFor(() => expect(abortedHistory).toEqual([parentA.user.id]))
    await user.click(screen.getByRole('button', { name: /^SETTINGS / }))
    const family = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(family).getAllByRole('listitem')).toHaveLength(2)
    expect(within(family).getByText(siblingA.full_name)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Synthetic Parent A' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), savedName)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Name updated')
    expect(nameWrites).toEqual([{ parentId: parentA.user.id, token: `Bearer ${parentA.access_token}`,
      body: { full_name: savedName } }])
    expect(within(screen.getByRole('list', { name: 'Linked children' })).getAllByRole('listitem')).toHaveLength(2)

    // The Profile screen reads AuthContext, so this checks refreshProfile,
    // not just the name local to the Settings form. Selection is still Zara.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('Following Zara Synthetic · 2 children linked')
    expect(screen.getByRole('combobox', { name: 'Following' })).toHaveValue(siblingA.user_id)
    expect(screen.getAllByText(savedName)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /^SETTINGS / }))
    await screen.findByRole('button', { name: savedName })
    expect(completedHistory).toEqual([])

    // Use the real SDK account event while mounted on real Settings. No
    // useAuth mock forces an in-place lifecycle the provider would prevent.
    await act(async () => {
      const switched = await supabase.auth.setSession({ access_token: parentB.access_token, refresh_token: parentB.refresh_token })
      expect(switched.error).toBeNull()
    })
    await screen.findByRole('button', { name: 'Synthetic Parent B' })
    const bFamily = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(bFamily).getAllByRole('listitem')).toHaveLength(1)
    expect(within(bFamily).getByText(childB.full_name)).toBeInTheDocument()
    expect(within(bFamily).queryByText(childA.full_name)).not.toBeInTheDocument()
    expect(within(bFamily).queryByText(siblingA.full_name)).not.toBeInTheDocument()
    await act(async () => { releaseHistory(); await historyWait })
    await waitFor(() => expect(completedHistory).toEqual([parentA.user.id]))
    expect(abortedHistory).toEqual([parentA.user.id])
    expect(window.location.pathname).toBe('/settings')
    expect(screen.getByRole('button', { name: 'Synthetic Parent B' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('Following Sam Synthetic · 1 child linked')
    await user.click(screen.getByRole('button', { name: 'Matches' }))
    await screen.findByText('2 recorded matches · all history')
    await screen.findByText('Sam first opponent')
    expect(screen.getByText('Sam second opponent')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Following' })).toHaveValue(childB.user_id)
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Match history · page 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.queryByText(/^Zara opponent /)).not.toBeInTheDocument()
    expect(screen.queryByText('Alex opponent')).not.toBeInTheDocument()
    expect(screen.queryByText('51 recorded matches · all history')).not.toBeInTheDocument()
    const expectedBRequest = { parentId: parentB.user.id, token: `Bearer ${parentB.access_token}`,
      body: { p_child_id: childB.user_id, p_after_id: null, p_after_match_date: null, p_after_created_at: null, p_limit: 51 } }
    expect(pageRequests).toHaveLength(4)
    expect(pageRequests[3]).toEqual(expectedBRequest)
    expect(summaryRequests.filter(request => request.parentId === parentB.user.id)).toEqual([{
      parentId: parentB.user.id, token: `Bearer ${parentB.access_token}`, body: { p_child_id: childB.user_id },
    }])
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe(parentB.user.id)
    expect(nameWrites).toHaveLength(1)
    expect(grants).toEqual([])
    expect(logouts).toEqual([])
    expect(unexpected).toEqual([])
  })
})
