import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PostMatchPrompt } from '@/components/coach/PostMatchPrompt'
import { renderApp } from '../../tests/support/render-app'
import { signInAs } from '../../tests/support/session'
import { server } from '../../tests/msw/server'
import { rpc, SUPABASE_URL } from '../../tests/msw/supabase'

let sequence = 0
let role = 'coach'
let account: string
let reads: string[]
const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
// TRAK-85: each parked route shows its real screen (this text proves it) with
// the "Coming soon" pill. The backend stays closed (pilot_g7.sql,
// parked_feature_boundary.sql); the actions are in parked-screens-coming-soon.
const parked: [string, string, RegExp][] = [
  ['player', '/player/passport', /PLAYER PASSPORT/i], ['player', '/player/evolution', /EVOLUTION CARD/i],
  ['coach', '/coach/assistant', /TRY ASKING/i], ['coach', '/coach/feedback/audit-assessment', /Review feedback/i],
  ['coach', '/coach/schedule', /Calendar/], ['coach', '/coach/recognition', /Give Recognition/], ['coach', '/coach/award', /Give Award/],
  ['parent', '/parent/alerts', /^Alerts$/], ['club', '/club/home', /Pilot Active/], ['club', '/club/squads', /Filter by age group/],
  ['club', '/club/coaches', /Connected Coaches/], ['club', '/club/profile', /Administrator/], ['club', '/club/radar', /Movement Radar/],
]
// Reads that travel as POST, and the app's own page-view telemetry.
const READ_POSTS = ['/rest/v1/telemetry_events', ...['get_children_awaiting_consent', 'get_roster_children_awaiting_consent', 'get_player_invites_for_current_user',
  'my_consent_status', 'my_session_is_live', 'coach_squad_player_consent_required', 'feature_on'].map(name => `/rest/v1/rpc/${name}`)]
let sent: string[]
beforeEach(() => {
  vi.stubEnv('DEV', false)
  account = `parked-audit-${++sequence}`
  role = 'coach'
  reads = []
  sent = []
  signInAs({ id: account })
  server.events.on('request:start', ({ request }) => {
    const { pathname } = new URL(request.url)
    if (request.method !== 'GET' && !pathname.startsWith('/auth/') && !READ_POSTS.includes(pathname)) sent.push(`${request.method} ${pathname}`)
  })
  // jsdom has no element scrolling; the coach assistant scrolls its thread.
  Element.prototype.scrollTo = () => {}
  server.use(
    http.get(endpoint('profiles'), () => HttpResponse.json([{ id: account, user_id: account, role, full_name: 'Synthetic Actor', invite_code: 'SYN047' }])),
    ...['organizations', 'coach_details', 'squad_players', 'coach_assessments', 'recognition_awards',
      'coach_calendar_events', 'coach_sessions', 'matches', 'player_details', 'player_parent_links'].map(name =>
      http.get(endpoint(name), () => { reads.push(name); return HttpResponse.json([]) })),
    rpc('get_children_awaiting_consent', () => []),
    // TRAK-11 phase 4: parent Home and consent also list account-less roster children.
    rpc('get_roster_children_awaiting_consent', () => []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('coach_squad_player_consent_required', () => false),
    // TRAK-124: events are switched off for this academy unless a test says so.
    rpc('feature_on', () => false),
    http.post(endpoint('telemetry_events'), () => HttpResponse.json(null, { status: 201 })),
    http.get(endpoint(':other'), () => HttpResponse.json([])),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); server.events.removeAllListeners() })

describe('TRAK-47 parked feature boundary', () => {
  it.each(parked)('%s sees the real screen at %s with the "Coming soon" pill, and only reads', async (actor, path, landmark) => {
    role = actor
    renderApp(path)
    expect((await screen.findAllByText(landmark, {}, { timeout: 4000 })).length).toBeGreaterThan(0)
    expect(screen.getByRole('note', { name: 'This screen is coming soon' })).toHaveTextContent('Coming soon')
    expect(screen.queryByRole('heading', { name: 'Coming soon' })).toBeNull()
    await new Promise(r => setTimeout(r, 300))
    expect(sent).toEqual([])
  })

  // TRAK-124 (J8.1): the schedule is parked unless events are switched on for
  // the coach's academy. Off is the case above.
  it('shows the coach schedule plainly once events are switched on for the academy', async () => {
    const asked: unknown[] = []
    server.use(rpc('feature_on', args => { asked.push(args.p_feature); return true }))
    renderApp('/coach/schedule')
    expect((await screen.findAllByText(/Calendar/, {}, { timeout: 4000 })).length).toBeGreaterThan(0)
    await waitFor(() => expect(asked).toEqual(['events']))
    await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
  })

  it('keeps the coach schedule parked when the switch cannot be read', async () => {
    let asked = 0
    server.use(rpc('feature_on', () => { asked++; return { status: 500, body: { message: 'Synthetic failure' } } }))
    renderApp('/coach/schedule')
    expect((await screen.findAllByText(/Calendar/, {}, { timeout: 4000 })).length).toBeGreaterThan(0)
    // The app retries once; both answers are failures.
    await waitFor(() => expect(asked).toBe(2), { timeout: 4000 })
    expect(screen.getByRole('note', { name: 'This screen is coming soon' })).toHaveTextContent('Coming soon')
  })

  it.each([
    ['/coach/squad/add', '/coach/squad', 'Squad'],
    ['/coach/quick-assess', '/coach/assess', 'Assessment'],
  ])('retire %s by sending its old URL to %s', async (path, destination, heading) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe(destination))
    expect(screen.queryByRole('heading', { name: 'Add Player' })).toBeNull()
    expect(screen.queryByRole('button', { name: /save & finish/i })).toBeNull()
  })

  it('CONTROL retains manual assessment', async () => {
    renderApp('/coach/assess')
    expect(await screen.findByRole('heading', { name: 'Assessment' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Coming soon' })).toBeNull()
  })

  it('CONTROL leaves club account settings accessible', async () => {
    role = 'club'
    renderApp('/settings')
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument()
  })

  it('CONTROL retains the approved J4 match-entry route', async () => {
    renderApp('/coach/sessions/quick')
    expect(await screen.findByText(/No squad yet\./)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Coming soon' })).toBeNull()
    expect(reads).toContain('squad_players')
  })
})


describe('retained coach entry points', () => {
  it('explains academy-managed admission without an Add Player action on coach Home', async () => {
    renderApp('/coach/home')
    expect(await screen.findByText('Your academy will add players to this squad.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add players to your squad/i })).toBeNull()
    // TRAK-72: the coach invite code is gone from Home.
    expect(screen.queryByText(/TRK-/)).toBeNull()
  })

  it('opens the full assessment from a populated coach Home', async () => {
    server.use(http.get(endpoint('squad_players'), () => HttpResponse.json([
      { id: 'synthetic-roster', coach_user_id: account, player_name: 'Synthetic Player', linked_player_id: 'synthetic-player' },
    ])))
    renderApp('/coach/home')
    await userEvent.click(await screen.findByRole('button', { name: /Assess players/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/assess'))
    expect(await screen.findByRole('heading', { name: 'Assessment' })).toBeInTheDocument()
    expect(screen.queryByText('Quick Assess')).toBeNull()
  })

  it('sends the post-match assessment action straight to the full assessment', async () => {
    render(<MemoryRouter><Routes>
      <Route path="/" element={<PostMatchPrompt sessionId="synthetic-trak47-match" />} />
      <Route path="/coach/assess" element={<h1>Assessment</h1>} />
      <Route path="/coach/quick-assess" element={<h1>Retired quick assessment</h1>} />
    </Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /Assess now/ }))
    expect(await screen.findByRole('heading', { name: 'Assessment' })).toBeInTheDocument()
  })
})
