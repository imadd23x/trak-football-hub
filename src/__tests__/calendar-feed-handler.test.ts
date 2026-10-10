import { describe, expect, it, vi } from 'vitest'
import {
  handleCalendarFeedRequest,
  isCalendarToken,
  lookupFromRpc,
  newCalendarToken,
  type CalendarFeedDependencies,
} from '../../supabase/functions/calendar-feed/handler'
import { buildCalendarFeed, type FeedEvent } from '../../supabase/functions/_shared/ical-feed'

// TRAK-132 (J8.9): the feed URL a phone calendar fetches with no login. The
// private token in the path is the only credential, so the handler must never
// echo it, must not let a CDN keep the answer, and must tell "this link is
// dead" (an empty calendar, which removes the events from the phone) apart
// from "the database hiccuped" (an error, which leaves the phone as it was).

const TOKEN = 'A'.repeat(21) + '_' + 'b'.repeat(20) + '-'
const event: FeedEvent = {
  id: 'e1', kind: 'training', squadLabel: 'U15', date: '2026-11-13', startTime: '18:00', endTime: null,
  meetTime: null, opponent: null, homeAway: null, venue: 'Main pitch', kit: null, status: 'scheduled',
  sequence: 0, updatedAt: '2026-10-08T10:15:30.000Z',
}

function deps(result: Awaited<ReturnType<CalendarFeedDependencies['feedFor']>> = { found: true, events: [event], childNames: ['Omar Haddad'] }) {
  return { feedFor: vi.fn<CalendarFeedDependencies['feedFor']>().mockResolvedValue(result) }
}
const request = (path: string, method = 'GET') => new Request(`https://edge.test/functions/v1/calendar-feed/${path}`, { method })

async function everything(response: Response): Promise<string> {
  return `${[...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${await response.text()}`
}

describe('isCalendarToken / newCalendarToken', () => {
  it('makes 256-bit url-safe tokens that pass the format check, never the same twice', () => {
    const a = newCalendarToken()
    const b = newCalendarToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isCalendarToken(a)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('refuses anything else', () => {
    for (const bad of ['', 'abc', `${TOKEN}=`, `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(1)}/`, `${TOKEN.slice(1)}+`]) {
      expect(isCalendarToken(bad)).toBe(false)
    }
  })
})

describe('lookupFromRpc: what calendar_feed_for_token returns', () => {
  it('reads null as a link that never existed', () => {
    expect(lookupFromRpc(null)).toEqual({ found: false })
  })

  it('reads the events and the children\'s names', () => {
    expect(lookupFromRpc({ events: [event], child_names: ['Omar Haddad'] }))
      .toEqual({ found: true, events: [event], childNames: ['Omar Haddad'] })
  })

  it('reads an empty answer as a dead link: an empty calendar', () => {
    expect(lookupFromRpc({ events: [], child_names: [] })).toEqual({ found: true, events: [], childNames: [] })
  })

  it('throws on anything else, so the request gets 503 rather than an empty calendar', () => {
    for (const bad of [undefined, 'x', [], {}, { events: 'x', child_names: [] }, { events: [], child_names: [1] }, { events: [{ id: 'e1' }], child_names: [] }]) {
      expect(() => lookupFromRpc(bad)).toThrow()
    }
  })
})

describe('handleCalendarFeedRequest', () => {
  it('serves the feed for a live link, as an uncacheable calendar file', async () => {
    const d = deps()
    const response = await handleCalendarFeedRequest(request(`${TOKEN}.ics`), d)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
    expect(await response.text()).toBe(buildCalendarFeed([event], { childNames: ['Omar Haddad'] }))
    expect(d.feedFor).toHaveBeenCalledWith(TOKEN)
  })

  it('passes the children\'s names to the feed, so a detail naming a child is left out', async () => {
    const d = deps({ found: true, events: [{ ...event, venue: "Omar's dad's pitch" }], childNames: ['Omar Haddad'] })
    const body = await (await handleCalendarFeedRequest(request(`${TOKEN}.ics`), d)).text()
    expect(body).toContain('BEGIN:VEVENT')
    expect(body).not.toMatch(/omar/i)
  })

  it('accepts the link with or without .ics on the end', async () => {
    const d = deps()
    expect((await handleCalendarFeedRequest(request(TOKEN), d)).status).toBe(200)
    expect(d.feedFor).toHaveBeenCalledWith(TOKEN)
  })

  it('answers HEAD with the headers and no body', async () => {
    const response = await handleCalendarFeedRequest(request(`${TOKEN}.ics`, 'HEAD'), deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(await response.text()).toBe('')
  })

  it('returns an empty calendar for a revoked link or a withdrawn child, so the phone removes the events', async () => {
    const response = await handleCalendarFeedRequest(request(`${TOKEN}.ics`), deps({ found: true, events: [], childNames: [] }))
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe(buildCalendarFeed([]))
    expect(body).not.toContain('BEGIN:VEVENT')
  })

  it('says 404 for a link that never existed, without asking the database for a malformed one', async () => {
    const unknown = deps({ found: false })
    expect((await handleCalendarFeedRequest(request(`${TOKEN}.ics`), unknown)).status).toBe(404)
    for (const path of ['', 'short.ics', `${TOKEN}x.ics`, `${TOKEN}.ics/extra`, `..%2F${TOKEN}`]) {
      const d = deps()
      expect((await handleCalendarFeedRequest(request(path), d)).status).toBe(404)
      expect(d.feedFor).not.toHaveBeenCalled()
    }
  })

  it('reports a database failure as 503, never as an empty calendar that would wipe the phone', async () => {
    const d = { feedFor: vi.fn<CalendarFeedDependencies['feedFor']>().mockRejectedValue(new Error('connection reset')) }
    const response = await handleCalendarFeedRequest(request(`${TOKEN}.ics`), d)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('300')
    const text = await response.text()
    expect(text).not.toContain('BEGIN:VCALENDAR')
    expect(text).not.toContain('connection reset')
  })

  it('only takes GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const d = deps()
      expect((await handleCalendarFeedRequest(request(`${TOKEN}.ics`, method), d)).status).toBe(405)
      expect(d.feedFor).not.toHaveBeenCalled()
    }
  })

  it('never puts the token in a response, whatever the outcome', async () => {
    const outcomes = [
      deps(),
      deps({ found: false }),
      deps({ found: true, events: [], childNames: [] }),
      { feedFor: vi.fn<CalendarFeedDependencies['feedFor']>().mockRejectedValue(new Error(TOKEN)) },
    ]
    for (const d of outcomes) {
      expect(await everything(await handleCalendarFeedRequest(request(`${TOKEN}.ics`), d))).not.toContain(TOKEN)
    }
  })
})
