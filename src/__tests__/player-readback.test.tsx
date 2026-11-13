import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../tests/support/render-app'
import { signInAs } from '../../tests/support/session'
import { registerAuthUser } from '../../tests/msw/auth-sessions'
import { server } from '../../tests/msw/server'
import { table, rpc, SUPABASE_URL, rpcRows } from '../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'

// These tests count Home's own my_consent_status requests to order stale
// responses. The G6 open-session watcher asks the same thing on its own
// schedule; it has its own tests (PlayerConsentWatcher, player-open-session).
vi.mock('@/components/player/PlayerConsentWatcher', () => ({ PlayerConsentWatcher: () => null }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const failure = () => HttpResponse.json({ code: '42501', message: 'Synthetic denied read' }, { status: 403 })
const WORDS = 'Keep your head up before receiving the ball.'
// Matched as a substring: main quotes the message in a tap-through card, and
// #141 (TRAK-71) shows it unquoted inside the assessment. These tests are about
// whether the words are shown or cleared, not how they are framed.
let sequence = 0
let account: string
let role: 'player' | 'parent'
const CHILD_A = 'child-alex', CHILD_B = 'child-zara'
const match = (id: string, owner = account) => ({
  id, user_id: owner, opponent: `${id} opposition`, competition: `${id} league`, venue: 'Home',
  created_at: '2026-09-20T10:00:00Z', match_date: '2026-09-18', computed_rating: 7,
  team_score: 2, opponent_score: 1, minutes_played: 60, goals: 1, assists: 0,
  position: 'Defender', age_group: 'U15',
})
// TRAK-194: one line under Home's header holds position, club and age group. TRAK-435 (12 Nov): Home reads no matches
// (no card built on match ratings), so this line is how these tests see a Home load finish.
// TRAK-437: the position is the coach's (the season plan's read), nothing here, so the line is club and age group.
const homeLine = (club: string) => `${club} · U15`
const event = { id: 'event-a', coach_user_id: 'coach-a', title: 'Team training', event_type: 'training', published: true, event_date: '2026-09-28', starts_at: '2026-09-28T17:00:00Z', time_known: true }
const assessment = {
  id: 'assessment-a', squad_player_id: 'squad-a', coach_user_id: 'coach-a',
  created_at: '2026-09-20T10:00:00Z', coach_rating: 7,
  work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7,
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
async function refresh() {
  await act(async () => {
    const { error } = await supabase.auth.refreshSession()
    expect(error).toBeNull()
  })
}
// Wait for MSW to finish the released HTTP response inside React's async act,
// so negative assertions inspect state after the SDK's real response handling.
function nextResponse(name: string) {
  return new Promise<void>(resolve => {
    const listener = ({ request }: { request: Request }) => {
      if (!request.url.startsWith(endpoint(name))) return
      server.events.removeListener('response:mocked', listener)
      resolve()
    }
    server.events.on('response:mocked', listener)
  })
}
async function releaseResponse(pending: ReturnType<typeof deferred>, name: string) {
  const responded = nextResponse(name)
  await act(async () => { pending.resolve(); await responded })
}
function matchResponse(request: Request, row: ReturnType<typeof match>) {
  return HttpResponse.json(request.headers.get('Accept')?.includes('application/vnd.pgrst.object+json') ? row : [row])
}
function navigate(path: string) {
  act(() => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

beforeEach(() => {
  vi.stubEnv('DEV', false)
  role = 'player'
  account = `readback-account-${++sequence}`
  signInAs({ id: account })
  server.use(
    // TRAK-286: no shared game plan.
    table('game_for_family', []),
    table('game_for_player', []),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      if (filter.startsWith('in.')) return HttpResponse.json([
        { user_id: CHILD_A, full_name: 'Alex' }, { user_id: CHILD_B, full_name: 'Zara' },
        { user_id: 'coach-a', full_name: 'Coach Audit' },
      ].filter(p => filter.includes(p.user_id)))
      if (filter === 'eq.coach-a') return HttpResponse.json([{ user_id: 'coach-a', full_name: 'Coach Audit' }])
      return HttpResponse.json([{ id: `profile-${account}`, user_id: account, role, full_name: 'Audit Player' }])
    }),
    table('matches', [match('recent')]),
    table('player_details', [{ position: 'Defender', current_club: 'Audit Academy', age_group: 'U15' }]),
    table('squad_players', [{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }]),
    table('coach_assessments', [assessment]),
    table('coach_shared_feedback', [{ assessment_id: assessment.id, body: WORDS, published_at: '2026-09-20T10:00:00Z' }]),
    rpcRows('child_events', []), rpcRows('season_plan_for_player', []), table('recognition_awards', []),
    table('player_parent_links', [{ player_user_id: CHILD_A }, { player_user_id: CHILD_B }]),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('get_children_awaiting_consent', () => []),
    // TRAK-11 phase 4: parent Home and consent also list account-less roster children.
    rpc('get_roster_children_awaiting_consent', () => []),
    // Player and parent Matches also list training (TRAK-76/77); none here.
    rpc('family_training_history', () => []),
    rpc('child_events', () => []),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
      const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
      const user = structuredClone(previous.user)
      return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
    }),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('player readback through authenticated routes', () => {
  it('CONTROL renders a permitted match detail through the real authenticated route', async () => {
    renderApp('/player/match/recent')
    expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
  })

  it('shows an actionable error when a match-detail read is denied', async () => {
    server.use(http.get(endpoint('matches'), failure))
    renderApp('/player/match/recent')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled()
  })

  it('finishes loading with a safe unavailable state when RLS returns no match', async () => {
    server.use(table('matches', []))
    renderApp('/player/match/not-owned')
    await waitFor(() => expect(screen.queryByText(/match.*(not found|unavailable)|couldn.t find.*match/i)).not.toBeNull())
    expect(screen.queryByText('vs recent opposition')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /back to matches/i }))
    await screen.findByText('No past matches yet.')
  })

  it('does not show a previous match while a different match route is still loading', async () => {
    const pending = deferred()
    let requested = false
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.slice(3) ?? 'recent'
      if (id === 'second') { requested = true; await pending.promise }
      return matchResponse(request, match(id))
    }))
    renderApp('/player/match/recent')
    await screen.findByText('vs recent opposition')
    try {
      navigate('/player/match/second')
      await waitFor(() => expect(requested).toBe(true))
      expect(screen.queryByText('vs recent opposition')).toBeNull()
    } finally { await releaseResponse(pending, 'matches') }
  })

  it('CONTROL renders player home with the current coach message', async () => {
    renderApp('/player/home')
    expect(await screen.findByText(WORDS, { exact: false })).toBeInTheDocument()
  })

  it('preserves a failed details read when the independent squad read finishes later', async () => {
    const pending = deferred()
    let denied = false
    server.use(
      http.get(endpoint('squad_players'), async () => { await pending.promise; return HttpResponse.json([{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }]) }),
      http.get(endpoint('player_details'), () => { denied = true; return failure() }),
    )
    renderApp('/player/home')
    try {
      await waitFor(() => expect(denied).toBe(true))
      await releaseResponse(pending, 'squad_players')
      await waitFor(() => expect(Boolean(screen.queryByRole('alert')) || screen.queryAllByText('Audit Player').length > 0).toBe(true))
      expect(screen.queryByRole('alert')).not.toBeNull()
      expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled()
    } finally { pending.resolve() }
  })

  it.each(['squad_players', 'coach_assessments'])(
    'clears the old coach message after refreshed %s returns no accessible rows', async name => {
      server.use(rpcRows('child_events', [event]))
      renderApp('/player/home')
      await screen.findByText(WORDS, { exact: false })
      await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
      expect(await within(await screen.findByRole('dialog', { name: 'Alerts' })).findByText('New: Team training')).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(screen.getByText('Coach Audit')).toBeInTheDocument()
      let checked = false
      server.use(http.get(endpoint(name), () => { checked = true; return HttpResponse.json([]) }))
      await refresh()
      await waitFor(() => expect(checked).toBe(true))
      await screen.findByText(homeLine('Audit Academy'))
      await waitFor(() => expect(screen.queryByText(WORDS, { exact: false })).toBeNull())
      expect(screen.queryByRole('region', { name: 'Latest coach assessment' })).toBeNull()
      expect(screen.queryByText('Coach Audit')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
      const alerts = within(await screen.findByRole('dialog', { name: 'Alerts' }))
      if (name === 'squad_players') expect(alerts.queryByText('New: Team training')).toBeNull()
      else expect(await alerts.findByText('New: Team training')).toBeInTheDocument()
    },
  )

  it('CONTROL clears the old coach message after a refreshed published-feedback query returns no rows', async () => {
    renderApp('/player/home')
    await screen.findByText(WORDS, { exact: false })
    server.use(table('coach_shared_feedback', []))
    await refresh()
    await screen.findByText(homeLine('Audit Academy'))
    await waitFor(() => expect(screen.queryByText(WORDS, { exact: false })).toBeNull())
  })

  it('CONTROL a delayed sibling response does not replace the currently selected child', async () => {
    role = 'parent'
    const pending = deferred()
    let requested = false
    let oldRequest: Request | undefined
    const handlerFinished = deferred()
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      if (child === CHILD_A) {
        requested = true
        oldRequest = request
        await pending.promise
        handlerFinished.resolve()
      }
      return HttpResponse.json([match(child, child)])
    }))
    renderApp('/parent/matches')
    try {
      const selector = await screen.findByRole('combobox', { name: 'Following' })
      await waitFor(() => expect(requested).toBe(true))
      await userEvent.selectOptions(selector, CHILD_B)
      await screen.findByText(`${CHILD_B} opposition`)
      expect(oldRequest?.signal.aborted).toBe(true)
      await act(async () => { pending.resolve(); await handlerFinished.promise })
      expect(screen.queryByText(`${CHILD_A} opposition`)).toBeNull()
      expect(screen.getByText(`${CHILD_B} opposition`)).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('CONTROL the parent can retry a failed match read without losing the selected child', async () => {
    role = 'parent'
    let fail = true
    server.use(http.get(endpoint('matches'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      return fail ? failure() : HttpResponse.json([match(child, child)])
    }))
    renderApp('/parent/matches')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull(), { timeout: 3000 })
    expect(screen.queryByText('No matches yet.')).toBeNull()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(`${CHILD_A} opposition`)
    expect(screen.getByRole('combobox')).toHaveValue(CHILD_A)
  })

  it('recovers a denied match detail with Retry', async () => {
    let fail = true
    server.use(http.get(endpoint('matches'), ({ request }) => fail ? failure() : matchResponse(request, match('recent'))))
    renderApp('/player/match/recent')
    await screen.findByRole('alert')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers safe Matches navigation after a denied match detail', async () => {
    server.use(http.get(endpoint('matches'), ({ request }) => {
      if (new URL(request.url).searchParams.has('id')) return failure()
      return HttpResponse.json([match('recent')])
    }))
    renderApp('/player/match/not-owned')
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /back to matches/i }))
    expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
  })

  it('ignores a match detail response arriving after a newer route finished', async () => {
    const pending = deferred()
    let requested = false
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.slice(3) ?? 'recent'
      if (id === 'older') { requested = true; await pending.promise }
      return matchResponse(request, match(id))
    }))
    renderApp('/player/match/older')
    try {
      await waitFor(() => expect(requested).toBe(true))
      navigate('/player/match/newer')
      await screen.findByText('vs newer opposition')
      await releaseResponse(pending, 'matches')
      expect(screen.queryByText('vs older opposition')).toBeNull()
      expect(screen.getByText('vs newer opposition')).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('refreshes match detail ownership and ignores the superseded read', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      if (++requests === 1) {
        await pending.promise
        return matchResponse(request, match('withdrawn'))
      }
      return HttpResponse.json([])
    }))
    renderApp('/player/match/withdrawn')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await screen.findByText(/match.*(not found|unavailable)|couldn.t find.*match/i)
      await releaseResponse(pending, 'matches')
      expect(screen.queryByText('vs withdrawn opposition')).toBeNull()
      expect(screen.getByText(/match.*(not found|unavailable)|couldn.t find.*match/i)).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('preserves a details failure when the squad read finishes first', async () => {
    const pending = deferred()
    let requested = false
    server.use(http.get(endpoint('player_details'), async () => {
      requested = true
      await pending.promise
      return failure()
    }))
    const squadResponded = nextResponse('squad_players')
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requested).toBe(true))
      await act(async () => { await squadResponded })
      await releaseResponse(pending, 'player_details')
      expect(await screen.findByRole('alert')).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('retries all Home reads and clears the failure after the fresh load succeeds', async () => {
    server.use(http.get(endpoint('player_details'), failure))
    renderApp('/player/home')
    await screen.findByRole('alert')
    server.use(table('player_details', [{ position: 'Defender', current_club: 'Recovered Academy', age_group: 'U15' }]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(homeLine('Recovered Academy'))).toBeInTheDocument()
    expect(await screen.findByText(WORDS, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['player_details', 'squad_players', 'coach_assessments', 'profiles', 'coach_shared_feedback', 'rpc/child_events'])(
    'ignores a late superseded Home %s response', async name => {
      const pending = deferred()
      let requested = false
      let fresh = false
      const staleRows: Record<string, Record<string, unknown>[]> = {
        player_details: [{ position: 'Defender', current_club: 'Stale Academy', age_group: 'U15' }],
        squad_players: [{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }],
        coach_assessments: [assessment],
        profiles: [{ user_id: 'coach-a', full_name: 'Stale Coach' }],
        coach_shared_feedback: [{ assessment_id: assessment.id, body: WORDS, published_at: '2026-09-20T10:00:00Z' }],
        'rpc/child_events': [event],
      }
      server.use(
        http.get(endpoint('player_details'), () => HttpResponse.json([{ position: 'Defender', current_club: fresh ? 'Current Academy' : 'Audit Academy', age_group: 'U15' }])),
        http.get(endpoint('squad_players'), () => HttpResponse.json(fresh ? [] : staleRows.squad_players)),
      )
      // Events come through child_events (TRAK-164), a POST.
      server.use((name.startsWith('rpc/') ? http.post : http.get)(endpoint(name), async ({ request }) => {
        if (name === 'profiles' && new URL(request.url).searchParams.get('user_id') !== 'eq.coach-a') return
        if (fresh) return // Let the current-load handlers above answer.
        requested = true
        await pending.promise
        return HttpResponse.json(staleRows[name])
      }))
      renderApp('/player/home')
      try {
        await waitFor(() => expect(requested).toBe(true))
        fresh = true
        await refresh()
        await screen.findByText(homeLine('Current Academy'))
        await releaseResponse(pending, name)
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByText(homeLine('Current Academy'))).toBeInTheDocument()
        expect(screen.queryByText(homeLine('Stale Academy'))).toBeNull()
        expect(screen.queryByText('Stale Coach')).toBeNull()
        expect(screen.queryByRole('region', { name: 'Latest coach assessment' })).toBeNull()
        expect(screen.queryByText(WORDS, { exact: false })).toBeNull()
        await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
        expect(within(await screen.findByRole('dialog', { name: 'Alerts' })).queryByText('New: Team training')).toBeNull()
        await userEvent.keyboard('{Escape}')
      } finally { pending.resolve() }
    },
  )

  it('ignores a failed Home read from before a successful refresh', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.get(endpoint('player_details'), async () => {
      if (++requests === 1) { await pending.promise; return failure() }
      return HttpResponse.json([{ position: 'Defender', current_club: 'Current Academy', age_group: 'U15' }])
    }))
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await screen.findByText(homeLine('Current Academy'))
      await releaseResponse(pending, 'player_details')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText(homeLine('Current Academy'))).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('keeps feedback failures visible while still loading the calendar', async () => {
    server.use(http.get(endpoint('coach_shared_feedback'), failure), rpcRows('child_events', [event]))
    renderApp('/player/home')
    expect(await screen.findByText(/Couldn't load your (feedback|coach's message)/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
    expect(await within(await screen.findByRole('dialog', { name: 'Alerts' })).findByText('New: Team training')).toBeInTheDocument()
    expect(screen.queryByText(WORDS, { exact: false })).toBeNull()
  })


  it('ignores an older consent response after a refreshed Home load', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.post(endpoint('rpc/my_consent_status'), async () => {
      if (++requests === 1) {
        await pending.promise
        return HttpResponse.json({ required: true, invited_parent: null })
      }
      return HttpResponse.json({ required: false, invited_parent: null })
    }))
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await waitFor(() => expect(requests).toBe(2))
      await screen.findByText(WORDS, { exact: false })
      await releaseResponse(pending, 'rpc/my_consent_status')
      expect(screen.queryByText('Waiting for your parent')).toBeNull()
    } finally { pending.resolve() }
  })



  // Kostas's #133 review (P2): AuthContext hands out a new user object on every
  // same-account token refresh (hourly, and on returning to the tab), so this
  // load re-runs. A re-run must refresh what is on screen, not blank it.
  it('keeps the details line and the coach message on screen while a same-account refresh reloads', async () => {
    renderApp('/player/home')
    await screen.findByText(WORDS, { exact: false })
    const pending = deferred()
    server.use(http.get(endpoint('player_details'), async () => { await pending.promise; return HttpResponse.json([{ position: 'Defender', current_club: 'Audit Academy', age_group: 'U15' }]) }))
    try {
      await refresh()
      const lineShown = screen.queryAllByText(homeLine('Audit Academy')).length > 0
      const messageShown = screen.queryByText(WORDS, { exact: false }) !== null
      await releaseResponse(pending, 'player_details')
      expect(lineShown, 'the details line stays visible during a same-account refresh').toBe(true)
      expect(messageShown, "the coach's message stays visible during a same-account refresh").toBe(true)
    } finally { pending.resolve() }
  })

  // Kostas and Imad (P3): if a callback throws instead of resolving with
  // { error }, Promise.all rejected and loading never ended.
  it('ends in a retryable error, not an endless skeleton, when a Home callback throws', async () => {
    // A squad answer with no list: its callback throws on .map.
    server.use(http.get(endpoint('squad_players'), () => HttpResponse.json({ length: 1 })))
    renderApp('/player/home')
    expect(await screen.findByRole('button', { name: /retry/i })).toBeEnabled()
  })

  // Imad's #133 review: the squad callback's cancelled guard was unpinned.
  it('ignores a squad failure from before a successful refresh', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.get(endpoint('squad_players'), async () => {
      if (++requests === 1) { await pending.promise; return failure() }
      return HttpResponse.json([{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }])
    }))
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await screen.findByText(WORDS, { exact: false })
      await releaseResponse(pending, 'squad_players')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText(WORDS, { exact: false })).toBeInTheDocument()
    } finally { pending.resolve() }
  })

})
