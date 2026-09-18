import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL } from '../../../tests/msw/supabase'
import {
  compareParentActivity, fetchParentDevelopment, fetchParentMatchActivity, fetchParentMatchPage,
  fetchParentMatchSummary, fetchParentRecentMatches, type ParentMatch, type ParentMatchSummary,
} from '../parent-data'

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const signal = () => new AbortController().signal
const summary: ParentMatchSummary = { total_count: 1_101, rated_count: 1_000, average_rating: 0, wins: 900, draws: 100, losses: 50 }
const match = (index: number): ParentMatch => ({
  id: `match-${index}`, match_date: '2026-09-18', created_at: '2026-09-18T10:01:02.123456+00:00',
  opponent: `Synthetic opponent ${index}`, competition: null, venue: null,
  computed_rating: 0, team_score: 0, opponent_score: 0,
})

describe('parent all-history summary contract', () => {
  it('uses the authorized child RPC and preserves complete totals and a zero mean', async () => {
    let body: unknown
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), async ({ request }) => {
      body = await request.json()
      return HttpResponse.json([summary])
    }))
    expect(await fetchParentMatchSummary('child-a', signal())).toEqual(summary)
    expect(body).toEqual({ p_child_id: 'child-a' })
  })

  it('accepts genuine zero history without inventing a rating', async () => {
    const empty = { total_count: 0, rated_count: 0, average_rating: null, wins: 0, draws: 0, losses: 0 }
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json([empty])))
    expect(await fetchParentMatchSummary('child-a', signal())).toEqual(empty)
  })

  it.each([
    ['missing response', null],
    ['unauthorized child', []],
    ['duplicate summary', [summary, summary]],
    ['object instead of row array', summary],
    ['missing count', [{ ...summary, total_count: undefined }]],
    ['negative count', [{ ...summary, total_count: -1 }]],
    ['fractional count', [{ ...summary, total_count: 1.5 }]],
    ['unsafe count', [{ ...summary, total_count: Number.MAX_SAFE_INTEGER + 1 }]],
    ['string count', [{ ...summary, total_count: '1101' }]],
    ['too many rated matches', [{ ...summary, rated_count: 1_102 }]],
    ['too many results', [{ ...summary, wins: 1_101 }]],
    ['missing rated mean', [{ ...summary, average_rating: null }]],
    ['invented unrated mean', [{ ...summary, rated_count: 0 }]],
    ['nonfinite numeric payload', [{ ...summary, average_rating: 'NaN' }]],
  ])('rejects %s instead of presenting zero or partial totals', async (_label, payload) => {
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json(payload)))
    await expect(fetchParentMatchSummary('child-a', signal())).rejects.toThrow('Invalid or unavailable match summary')
  })

  it('propagates RPC failure', async () => {
    server.use(http.post(endpoint('rpc/get_parent_match_summary'), () => HttpResponse.json({ message: 'Synthetic unavailable' }, { status: 503 })))
    await expect(fetchParentMatchSummary('child-a', signal())).rejects.toMatchObject({ message: 'Synthetic unavailable' })
  })
})

describe('parent cursor page contract', () => {
  it('keeps fifty visible matches and uses the last displayed row, not the lookahead, as cursor', async () => {
    let body: unknown
    const rows = Array.from({ length: 51 }, (_, index) => match(index))
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(rows)
    }))
    const page = await fetchParentMatchPage('child-a', null, signal())
    expect(page.matches).toEqual(rows.slice(0, 50))
    expect(page.nextCursor).toEqual({ id: 'match-49', match_date: rows[49].match_date, created_at: rows[49].created_at })
    expect(body).toEqual({ p_child_id: 'child-a', p_after_id: null, p_after_match_date: null, p_after_created_at: null, p_limit: 51 })
  })

  it.each([
    { id: 'boundary-a', match_date: '2026-09-18', created_at: '2026-09-18T10:01:02.123456+00:00' },
    { id: 'boundary-b', match_date: null, created_at: '2026-09-18T10:01:02.123456+00:00' },
    { id: 'boundary-c', match_date: null, created_at: null },
  ])('retains exact timestamp precision and nullable cursor fields for $id', async cursor => {
    let body: unknown
    server.use(http.post(endpoint('rpc/get_parent_match_page'), async ({ request }) => {
      body = await request.json()
      return HttpResponse.json([])
    }))
    expect(await fetchParentMatchPage('child-a', cursor, signal())).toEqual({ matches: [], nextCursor: null })
    expect(body).toEqual({ p_child_id: 'child-a', p_after_id: cursor.id, p_after_match_date: cursor.match_date, p_after_created_at: cursor.created_at, p_limit: 51 })
  })

  it.each([0, 1, 50])('marks a valid %i-row final page complete', async length => {
    const rows = Array.from({ length }, (_, index) => match(index))
    server.use(http.post(endpoint('rpc/get_parent_match_page'), () => HttpResponse.json(rows)))
    expect(await fetchParentMatchPage('child-a', null, signal())).toEqual({ matches: rows, nextCursor: null })
  })

  it.each([
    ['absent payload', null],
    ['oversized page', Array.from({ length: 52 }, (_, index) => match(index))],
    ['duplicate identity', [match(0), match(0)]],
    ['missing projected field', [{ ...match(0), computed_rating: undefined }]],
  ])('rejects %s rather than claiming history is complete', async (_label, payload) => {
    server.use(http.post(endpoint('rpc/get_parent_match_page'), () => HttpResponse.json(payload)))
    await expect(fetchParentMatchPage('child-a', null, signal())).rejects.toThrow('Invalid match history response')
  })

  it('propagates a failed page instead of advancing to empty history', async () => {
    server.use(http.post(endpoint('rpc/get_parent_match_page'), () => HttpResponse.json({ message: 'Synthetic page failure' }, { status: 503 })))
    await expect(fetchParentMatchPage('child-a', null, signal())).rejects.toMatchObject({ message: 'Synthetic page failure' })
  })
})

describe('bounded parent previews', () => {
  it.each(['NaN', 'Infinity', '-Infinity'])('treats PostgreSQL numeric %s as unrated in both direct previews', async rating => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([{ ...match(0), computed_rating: rating }])))
    expect(await fetchParentRecentMatches('child-a', signal())).toEqual([{ ...match(0), computed_rating: null }])
    expect(await fetchParentMatchActivity('child-a', signal())).toEqual([{ ...match(0), computed_rating: null }])
  })

  it.each(['0', '8.5'])('does not silently coerce the unexpected numeric string %s', async rating => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([{ ...match(0), computed_rating: rating }])))
    await expect(fetchParentRecentMatches('child-a', signal())).rejects.toThrow('Invalid match history response')
    await expect(fetchParentMatchActivity('child-a', signal())).rejects.toThrow('Invalid match history response')
  })

  it('asks the server for five matches by played date, and twenty activity records by recorded time', async () => {
    const requests: URLSearchParams[] = []
    server.use(http.get(endpoint('matches'), ({ request }) => {
      requests.push(new URL(request.url).searchParams)
      return HttpResponse.json([match(0)])
    }))
    expect(await fetchParentRecentMatches('child-a', signal())).toEqual([match(0)])
    expect(await fetchParentMatchActivity('child-a', signal())).toEqual([match(0)])
    expect(requests.map(params => Object.fromEntries(params))).toEqual([
      expect.objectContaining({ user_id: 'eq.child-a', limit: '5', order: 'match_date.desc.nullslast,created_at.desc.nullslast,id.desc' }),
      expect.objectContaining({ user_id: 'eq.child-a', limit: '20', order: 'created_at.desc.nullslast,id.desc' }),
    ])
  })

  it('fetches enough assessment and award candidates for the latest twenty combined updates', async () => {
    const observed: { table: string; params: Record<string, string> }[] = []
    server.use(
      http.get(endpoint('player_details'), () => HttpResponse.json([])),
      http.get(endpoint('squad_players'), () => HttpResponse.json([{ id: 'squad-a' }])),
      ...['coach_assessments', 'recognition_awards'].map(table => http.get(endpoint(table), ({ request }) => {
        observed.push({ table, params: Object.fromEntries(new URL(request.url).searchParams) })
        return HttpResponse.json([])
      })),
    )
    await fetchParentDevelopment('child-a', signal())
    expect(observed).toEqual(expect.arrayContaining(['coach_assessments', 'recognition_awards'].map(table => ({
      table, params: expect.objectContaining({ squad_player_id: 'in.(squad-a)', limit: '20', order: 'created_at.desc.nullslast,id.desc' }),
    }))))
  })

  it('orders combined activity with timestamp precision, stable ties, and missing dates last', () => {
    const events = [
      { id: 'no-date', date: null },
      { id: 'b-older', date: '2026-09-18T10:01:02.123455Z' },
      { id: 'b-newer', date: '2026-09-18T14:01:02.123456+04:00' },
      { id: 'a-newer', date: '2026-09-18T10:01:02.123456Z' },
    ]
    expect([...events].sort(compareParentActivity).map(event => event.id)).toEqual(['b-newer', 'a-newer', 'b-older', 'no-date'])
    expect(events[0].id).toBe('no-date')
  })

  it('matches PostgreSQL descending timestamp ordering for infinite and null dates', () => {
    const events = [
      { id: 'null', date: null }, { id: 'minus-infinity', date: '-infinity' },
      { id: 'finite', date: '2026-09-18T10:00:00Z' }, { id: 'infinity', date: 'infinity' },
    ]
    expect(events.sort(compareParentActivity).map(event => event.id)).toEqual(['infinity', 'finite', 'minus-infinity', 'null'])
  })
})
