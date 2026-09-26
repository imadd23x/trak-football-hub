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
const parked = [
  ['player', '/player/passport'], ['player', '/player/evolution'],
  ['coach', '/coach/assistant'], ['coach', '/coach/feedback/audit-assessment'],
  ['coach', '/coach/schedule'], ['coach', '/coach/recognition'], ['coach', '/coach/award'],
  ['parent', '/parent/alerts'], ['club', '/club/home'], ['club', '/club/squads'],
  ['club', '/club/coaches'], ['club', '/club/profile'], ['club', '/club/radar'],
]
beforeEach(() => {
  vi.stubEnv('DEV', false)
  account = `parked-audit-${++sequence}`
  role = 'coach'
  reads = []
  signInAs({ id: account })
  server.use(
    http.get(endpoint('profiles'), () => HttpResponse.json([{ id: account, user_id: account, role, full_name: 'Synthetic Actor', invite_code: 'SYN047' }])),
    ...['organizations', 'coach_details', 'squad_players', 'coach_assessments', 'recognition_awards',
      'coach_calendar_events', 'coach_sessions', 'matches', 'player_details', 'player_parent_links'].map(name =>
      http.get(endpoint(name), () => { reads.push(name); return HttpResponse.json([]) })),
    rpc('get_children_awaiting_consent', () => []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('coach_squad_player_consent_required', () => false),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('TRAK-47 parked feature boundary', () => {
  it.each(parked)('%s receives a static placeholder at %s', async (actor, path) => {
    role = actor
    renderApp(path)
    expect(await screen.findByRole('heading', { name: 'Coming soon' })).toBeInTheDocument()
    expect(reads.filter(name => name !== 'player_parent_links')).toEqual([])
    if (actor === 'club') expect(screen.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/settings')
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
    await screen.findByText('TRK-SYN047')
    expect(await screen.findByText('Your academy will add players to this squad.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add players to your squad/i })).toBeNull()
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
