/**
 * TRAK-436 (and TRAK-441 slice 2): a shared game plan, a changed one and the coach's review reach the family's bell,
 * and the alert opens the match's page at the plan or the review. A parent reads what the match page tells them (starts,
 * bench, not in the squad), never the job or the note. Test people are named after footballers.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { PlayerAlertsBell } from '@/components/player/PlayerAlertsBell'
import type { PlayerEvent } from '@/lib/player-events'
import { fetchNews, newsAlert, type NewsItem } from '../news'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

afterEach(cleanup)
const match = (over: Partial<PlayerEvent> = {}): PlayerEvent => ({
  id: 'parkview', kind: 'match', title: 'League', date: '2026-11-14', time: '11:00', meetTime: null, venue: 'Rehearsal Park',
  kit: null, opponent: 'Parkview Athletic U16', homeAway: 'home', status: 'scheduled', cancelReason: null, sequence: 1,
  updatedAt: null, familyNote: null, ...over,
})
const item = (over: Partial<NewsItem> = {}): NewsItem =>
  ({ kind: 'plan', eventId: 'parkview', at: '2026-11-13T15:00:00Z', event: match(), role: 'starter', coachName: 'Otto Rehhagel', score: null, ...over })

describe('TRAK-436: what the bell says', () => {
  it("the player's: his plan is in, it changed, the coach reviewed his match", () => {
    expect(newsAlert(item(), 'player', '')).toMatchObject({
      id: 'news-plan-parkview', title: 'Your game plan is in', description: 'Match vs Parkview Athletic U16 (home) · Sat 14 Nov, 11:00',
      date: '2026-11-13T15:00:00Z', path: '/player/event/parkview#game-plan', action: 'Open game plan',
    })
    expect(newsAlert(item({ kind: 'plan_changed' }), 'player', '').title).toBe('Your game plan changed')
    expect(newsAlert(item({ kind: 'review', eventId: 'lakeside', event: match({ id: 'lakeside', opponent: 'Lakeside FC U16', homeAway: 'away' }), score: [2, 1] }), 'player', ''))
      .toMatchObject({ title: 'Coach Otto Rehhagel reviewed your match', description: 'Match vs Lakeside FC U16 (away) · won 2–1',
        path: '/player/event/lakeside#review', action: 'Read review' })
    expect(newsAlert(item({ kind: 'review', coachName: null, score: [1, 1] }), 'player', '')).toMatchObject({
      title: 'Your coach reviewed your match', description: 'Match vs Parkview Athletic U16 (home) · drew 1–1' })
  })

  it("the parent's: what the match page says (starts, bench, not in the squad), how it went; never a job or a note", () => {
    expect(newsAlert(item(), 'parent', 'Giourkas')).toMatchObject({ title: 'Giourkas starts', path: '/parent/event/parkview#game-plan', action: 'Open match' })
    expect(newsAlert(item({ role: 'bench' }), 'parent', 'Giourkas').title).toBe('Giourkas is on the bench')
    expect(newsAlert(item({ role: 'not_selected' }), 'parent', 'Giourkas').title).toBe('Giourkas isn’t in the squad this week')
    expect(newsAlert(item({ kind: 'plan_changed', role: 'bench' }), 'parent', 'Giourkas').title).toBe('Changed: Giourkas is on the bench')
    const review = newsAlert(item({ kind: 'review', score: [0, 3] }), 'parent', 'Giourkas')
    expect(review).toMatchObject({ title: 'How Giourkas’s match went', description: 'Match vs Parkview Athletic U16 (home) · lost 0–3',
      path: '/parent/event/parkview#review', action: 'Read review' })
    for (const alert of [newsAlert(item(), 'parent', 'Giourkas'), review]) expect(JSON.stringify(alert)).not.toMatch(/job|note/i)
  })
})

describe('TRAK-436: the player\'s bell', () => {
  it('lists the plan and opens the match page at it', async () => {
    const Where = () => <p>at {useLocation().pathname}{useLocation().hash}</p>
    render(<MemoryRouter initialEntries={['/player/home']}><Routes>
      <Route path="/player/home" element={<PlayerAlertsBell userId="giourkas" events={[]} news={[item()]} />} />
      <Route path="/player/event/:id" element={<Where />} />
    </Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
    const panel = await screen.findByRole('dialog', { name: 'Alerts' })
    expect(within(panel).getByText('Your game plan is in')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: /^Your game plan is in.*Show details$/ }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Open game plan' }))
    expect(await screen.findByText('at /player/event/parkview#game-plan')).toBeInTheDocument()
  })
})

describe('TRAK-436: the read gives each item its match', () => {
  it("each item comes with its match, the role and the coach's name; one whose match the child can't read is left out", async () => {
    const now = new Date().toISOString()
    let eventsAsked = ''
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json([{ id: 'sq-1' }])),
      http.get(`${SUPABASE_URL}/rest/v1/game_for_family`, () => HttpResponse.json([
        { event_id: 'parkview', shared_at: now, changed_at: null, role: 'bench', coach_name: ' Otto Rehhagel ' },
        { event_id: 'gone', shared_at: now, changed_at: null, role: 'starter', coach_name: 'Otto Rehhagel' },
      ])),
      http.get(`${SUPABASE_URL}/rest/v1/game_review_for_family`, () => HttpResponse.json([])),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/child_events`, ({ request }) => {
        eventsAsked = new URL(request.url).searchParams.get('id') ?? ''
        return HttpResponse.json([{ id: 'parkview', event_type: 'match', title: 'League', opponent: 'Parkview Athletic U16', home_away: 'home',
          event_date: '2026-11-14', start_time: '11:00:00', status: 'scheduled', sequence: 1 }])
      }),
    )
    const news = await fetchNews('giourkas', false, new AbortController().signal)
    expect(eventsAsked).toMatch(/parkview/)
    expect(news).toHaveLength(1)
    expect(news[0]).toMatchObject({ kind: 'plan', eventId: 'parkview', role: 'bench', coachName: 'Otto Rehhagel', event: { opponent: 'Parkview Athletic U16' } })
  })
})
