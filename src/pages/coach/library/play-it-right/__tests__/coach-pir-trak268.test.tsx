import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../../../tests/support/render-app'
import { signInAs } from '../../../../../../tests/support/session'
import { server } from '../../../../../../tests/msw/server'
import { table, rpc } from '../../../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'
import { momentById } from '@/lib/library/play-it-right'

/**
 * TRAK-268 (Kostas, 23 Oct): Play It Right in Trak's look, laid out like the
 * Library's Browse drills. Six tiles, one per part of the code; a part lists its
 * match moments (ages 13–16) or tells its story (ages 17–20); a moment is a
 * strip, a call to make, then what the coach saw. All inside Trak: no frame, no
 * links out, nothing saved.
 */

const COACH = { id: 'coach-pir' }
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
}

beforeEach(() => {
  screenIs(false)
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U14', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC' }]),
    table('coach_calendar_events', []),
    table('coach_sessions', []),
    table('squad_players', []),
    table('session_attendance', []),
    table('event_absences', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { window.matchMedia = realMatchMedia })

const link = (name: string | RegExp) => screen.getByRole('link', { name })
const option = (name: RegExp) => screen.getByRole('button', { name })

describe('TRAK-268: the coach\'s Play It Right', { timeout: 20_000 }, () => {
  it('opens on six tiles, one per part of the code, like Browse drills', async () => {
    renderApp('/coach/trainings/play-it-right')
    expect(await screen.findByRole('heading', { level: 1, name: 'Play It Right' })).toBeInTheDocument()
    expect(screen.queryByTitle('Play It Right')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()

    const tiles = within(screen.getByRole('heading', { name: 'The code, in six parts' }).nextElementSibling as HTMLElement).getAllByRole('link')
    expect(tiles.map(t => [t.textContent, t.getAttribute('href')])).toEqual([
      ['PART 1Commitment30 match moments', '/coach/trainings/play-it-right/commit'],
      ['PART 2Behaviour and attitude30 match moments', '/coach/trainings/play-it-right/attitude'],
      ['PART 3Sportsmanship30 match moments', '/coach/trainings/play-it-right/sport'],
      ['PART 4Training conduct30 match moments', '/coach/trainings/play-it-right/train'],
      ['PART 5Match day30 match moments', '/coach/trainings/play-it-right/match'],
      ['PART 6Off the field30 match moments', '/coach/trainings/play-it-right/off'],
    ])
    expect(link(/^Coach notes/)).toHaveAttribute('href', '/coach/trainings/play-it-right/notes')

    // Ages 17–20 keeps the same six tiles, each opening its story.
    await userEvent.click(screen.getByRole('button', { name: 'Ages 17–20' }))
    expect(screen.getByRole('button', { name: 'Ages 17–20' })).toHaveAttribute('aria-pressed', 'true')
    expect(link(/^PART 1\s*Commitment/)).toHaveTextContent('A story and 3 calls')
    expect(link(/^PART 1\s*Commitment/)).toHaveAttribute('href', '/coach/trainings/play-it-right/commit?ages=17-20')
  })

  it('a part lists its 30 match moments, each opening its own page', async () => {
    renderApp('/coach/trainings/play-it-right')
    await userEvent.click(await screen.findByRole('link', { name: /^PART 1\s*Commitment/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Commitment' })).toBeInTheDocument()
    expect(screen.getByText(/^Attend training and matches, tell the coach in advance/)).toBeInTheDocument()
    expect(screen.getByText('30 match moments for ages 13–16')).toBeInTheDocument()

    const moments = within(screen.getByRole('list', { name: 'Match moments' })).getAllByRole('link')
    expect(moments).toHaveLength(30)
    expect(link(/^Double-session Thursday\s*Make the call · Week 1/)).toHaveAttribute('href', '/coach/trainings/play-it-right/moment/c1')
    expect(link(/^The rest day\s*Rank three/)).toHaveAttribute('href', '/coach/trainings/play-it-right/moment/c2')

    // The trail goes back to the six parts (TRAK-334: in place of Back).
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Play It Right' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Play It Right' })).toBeInTheDocument()
  })

  it('a moment: make the call, then see the best call, what the coach saw, why it matters and a tip', async () => {
    const c1 = momentById('c1')!
    renderApp('/coach/trainings/play-it-right/moment/c1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Double-session Thursday' })).toBeInTheDocument()
    expect(screen.getByText('Make the call · Week 1 · Ages 13–16')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'The moment' })).getAllByRole('listitem').length).toBe(c1.panels.length)
    expect(screen.getByRole('heading', { name: 'What should Kai do?' })).toBeInTheDocument()
    // Nothing of the answer shows before the call.
    expect(screen.queryByText('Best call')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What the coach saw' })).toBeNull()

    await userEvent.click(option(/Skip Thursday evening’s session/))
    const mine = option(/Skip Thursday evening’s session/)
    expect(mine).toHaveAttribute('aria-pressed', 'true')
    expect(within(mine).getByText('Your call')).toBeInTheDocument()
    expect(within(mine).getByText(c1.fb[1])).toBeInTheDocument()
    expect(within(option(/Tell the education officer today/)).getByText('Best call')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What the coach saw' })).toBeInTheDocument()
    expect(screen.getByText(c1.coach)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Why it matters' })).toBeInTheDocument()
    expect(screen.getByText(c1.why.club)).toBeInTheDocument()
    expect(screen.getByText(c1.tip)).toBeInTheDocument()

    // Try again clears it, and nothing was saved anywhere.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.queryByText('Your call')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What the coach saw' })).toBeNull()

    // Come straight here, the trail still has its part (TRAK-334: in place of Back).
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Library', 'Play It Right', 'Commitment', expect.any(String)])
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Commitment' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Commitment' })).toBeInTheDocument()
  })

  it('a ranking: tap best first, then see how each one ranks', async () => {
    renderApp('/coach/trainings/play-it-right/moment/c2')
    expect(await screen.findByRole('heading', { level: 1, name: 'The rest day' })).toBeInTheDocument()
    expect(screen.getByText(/Tap the best option first/)).toBeInTheDocument()

    await userEvent.click(option(/Do a two-hour solo session/))
    await userEvent.click(option(/Do a two-hour solo session/))
    expect(option(/Do a two-hour solo session/)).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(option(/Have a gentle kickabout/))
    await userEvent.click(option(/Follow the recovery plan/))
    expect(screen.queryByRole('heading', { name: 'What the coach saw' })).toBeNull()
    await userEvent.click(option(/Do a two-hour solo session/))

    expect(within(option(/Follow the recovery plan/)).getByText('Best')).toBeInTheDocument()
    expect(within(option(/Follow the recovery plan/)).getByText('You: 2nd')).toBeInTheDocument()
    expect(within(option(/Have a gentle kickabout/)).getByText('Best 2nd')).toBeInTheDocument()
    expect(within(option(/Have a gentle kickabout/)).getByText('You: 1st')).toBeInTheDocument()
    expect(within(option(/Do a two-hour solo session/)).getByText('Best 3rd')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What the coach saw' })).toBeInTheDocument()
  })

  it('"Show the answers" shows them without a call; a follow-up asks what happens next', async () => {
    renderApp('/coach/trainings/play-it-right/moment/a1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Kept on, let go' })).toBeInTheDocument()
    expect(screen.queryByText('What happens next')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show the answers' }))
    expect(within(option(/Message Josh privately/)).getByText('Best call')).toBeInTheDocument()
    expect(screen.queryByText('Your call')).toBeNull()
    expect(screen.getByText('What happens next')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Josh replies: “Leave me alone.” What now?' })).toBeInTheDocument()
    await userEvent.click(option(/Keep messaging until he answers/))
    expect(within(option(/Keep messaging until he answers/)).getByText('Your call')).toBeInTheDocument()
  })

  it('ages 17–20: a part is a story, its three steps and three quick calls', async () => {
    renderApp('/coach/trainings/play-it-right/commit?ages=17-20')
    expect(await screen.findByRole('heading', { level: 1, name: 'Commitment' })).toBeInTheDocument()
    expect(screen.getByText('A story and three quick calls for ages 17–20')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shift work vs. the Thursday session' })).toBeInTheDocument()
    expect(screen.getByText('1. Dilemma')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Three quick calls' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Match moments' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Ages 13–16' }))
    expect(await screen.findByRole('list', { name: 'Match moments' })).toBeInTheDocument()
  })

  it('Coach notes: how to use it, the research and what changes by age, with no links out', async () => {
    renderApp('/coach/trainings/play-it-right/notes')
    expect(await screen.findByRole('heading', { level: 1, name: 'Coach notes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How to use it with your squad' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What the research says' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'By age' })).toBeInTheDocument()
    for (const a of screen.queryAllByRole('link')) expect(a.getAttribute('href'), a.textContent ?? '').toMatch(/^\//)
  })

  it('on a laptop: a moment opens beside the list, the way Browse drills opens a session', async () => {
    screenIs(true)
    renderApp('/coach/trainings/play-it-right/commit')
    const moments = await screen.findByRole('list', { name: 'Match moments' })
    expect(screen.getByText('No moment open')).toBeInTheDocument()
    expect(screen.getByText('Pick a match moment to see it here.')).toBeInTheDocument()

    await userEvent.click(within(moments).getByRole('button', { name: /Double-session Thursday/ }))
    const open = await screen.findByRole('article', { name: 'Double-session Thursday' })
    expect(within(open).getByRole('heading', { level: 2, name: 'Double-session Thursday' })).toBeInTheDocument()
    expect(within(moments).getByRole('button', { name: /Double-session Thursday/ })).toHaveAttribute('aria-pressed', 'true')

    // A call made in one moment doesn't carry over to the next.
    await userEvent.click(within(open).getByRole('button', { name: /Tell the education officer today/ }))
    expect(within(open).getByText('Your call')).toBeInTheDocument()
    await userEvent.click(within(moments).getByRole('button', { name: /The rest day/ }))
    const next = await screen.findByRole('article', { name: 'The rest day' })
    expect(within(next).queryByText(/^You:/)).toBeNull()
    expect(within(next).queryByRole('heading', { name: 'What the coach saw' })).toBeNull()

    await userEvent.click(within(next).getByRole('button', { name: 'Close' }))
    expect(screen.getByText('No moment open')).toBeInTheDocument()
  })

  it('an unknown part or moment goes back to the six parts', async () => {
    renderApp('/coach/trainings/play-it-right/nope')
    expect(await screen.findByRole('heading', { level: 1, name: 'Play It Right' })).toBeInTheDocument()
    renderApp('/coach/trainings/play-it-right/moment/zz9')
    expect(await screen.findAllByRole('heading', { level: 1, name: 'Play It Right' })).not.toHaveLength(0)
  })
})
