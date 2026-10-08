import { describe, expect, it } from 'vitest'
import {
  buildCalendarFeed,
  escapeText,
  foldLine,
  type FeedEvent,
} from '../../supabase/functions/_shared/ical-feed'

// TRAK-132 (J8.9): the text of the private calendar feed. Calendar apps update
// an event only when its UID stays the same and its SEQUENCE goes up; anything
// else shows up as a duplicate. Titles carry the squad and type, never a child.

const base: FeedEvent = {
  id: '0f8a1c2e-0000-4000-8000-000000000001',
  kind: 'training',
  squadLabel: 'U15',
  date: '2026-11-13',
  startTime: '18:00',
  endTime: '19:30',
  meetTime: null,
  opponent: null,
  homeAway: null,
  venue: 'Main pitch',
  kit: null,
  status: 'scheduled',
  sequence: 0,
  updatedAt: '2026-10-08T10:15:30.123Z',
}

/** The feed as logical lines: CRLF split, folded lines joined back (RFC 5545 3.1). */
function lines(feed: string): string[] {
  return feed.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean)
}

function events(feed: string): string[][] {
  const out: string[][] = []
  let current: string[] | null = null
  for (const line of lines(feed)) {
    if (line === 'BEGIN:VEVENT') current = []
    else if (line === 'END:VEVENT') { out.push(current!); current = null }
    else if (current) current.push(line)
  }
  return out
}

const prop = (event: string[], name: string) =>
  event.find(l => l.startsWith(`${name}:`) || l.startsWith(`${name};`))

describe('buildCalendarFeed: the calendar wrapper', () => {
  it('is a valid published iCalendar with CRLF line ends and a Dubai time zone', () => {
    const feed = buildCalendarFeed([base])
    expect(feed.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(feed.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(feed.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    const all = lines(feed)
    expect(all).toContain('VERSION:2.0')
    expect(all).toContain('METHOD:PUBLISH')
    expect(all).toContain('X-WR-TIMEZONE:Asia/Dubai')
    expect(all).toContain('BEGIN:VTIMEZONE')
    expect(all).toContain('TZID:Asia/Dubai')
    expect(all).toContain('TZOFFSETTO:+0400')
  })

  it('names the calendar after Trak, never after a child', () => {
    expect(lines(buildCalendarFeed([base]))).toContain('X-WR-CALNAME:Trak Football')
  })

  it('is still a valid calendar with no events: what a withdrawn or revoked link returns', () => {
    const feed = buildCalendarFeed([])
    expect(lines(feed)).toContain('BEGIN:VCALENDAR')
    expect(events(feed)).toEqual([])
  })
})

describe('buildCalendarFeed: one entry per event, updated in place', () => {
  it('gives each event a stable UID from its id, and the J8.2 sequence number', () => {
    const [event] = events(buildCalendarFeed([{ ...base, sequence: 3 }]))
    expect(prop(event, 'UID')).toBe(`UID:${base.id}@trakfootball.com`)
    expect(prop(event, 'SEQUENCE')).toBe('SEQUENCE:3')
  })

  it('keeps the UID when the event moves, so the app updates it instead of adding a second one', () => {
    const before = events(buildCalendarFeed([base]))[0]
    const after = events(buildCalendarFeed([{ ...base, startTime: '18:30', sequence: 1 }]))[0]
    expect(prop(after, 'UID')).toBe(prop(before, 'UID'))
    expect(prop(after, 'DTSTART')).toBe('DTSTART;TZID=Asia/Dubai:20261113T183000')
    expect(prop(after, 'SEQUENCE')).toBe('SEQUENCE:1')
  })

  it('writes the same text for the same events every time (no clock in the output)', () => {
    expect(buildCalendarFeed([base])).toBe(buildCalendarFeed([base]))
    const [event] = events(buildCalendarFeed([base]))
    expect(prop(event, 'DTSTAMP')).toBe('DTSTAMP:20261008T101530Z')
  })

  it('lists an event once when two of a parent\'s children are in the same squad', () => {
    expect(events(buildCalendarFeed([base, { ...base }]))).toHaveLength(1)
  })

  it('orders events by date and time', () => {
    const later = { ...base, id: 'b', date: '2026-11-20' }
    const earlier = { ...base, id: 'a', date: '2026-11-06' }
    const uids = events(buildCalendarFeed([later, base, earlier])).map(e => prop(e, 'UID'))
    expect(uids).toEqual(['UID:a@trakfootball.com', `UID:${base.id}@trakfootball.com`, 'UID:b@trakfootball.com'])
  })
})

describe('buildCalendarFeed: times', () => {
  it('writes the wall-clock time the coach typed, in Dubai time', () => {
    const [event] = events(buildCalendarFeed([base]))
    expect(prop(event, 'DTSTART')).toBe('DTSTART;TZID=Asia/Dubai:20261113T180000')
    expect(prop(event, 'DTEND')).toBe('DTEND;TZID=Asia/Dubai:20261113T193000')
  })

  it('ends on the next day when the end time is before the start (a late tournament)', () => {
    const [event] = events(buildCalendarFeed([{ ...base, startTime: '22:00', endTime: '01:00' }]))
    expect(prop(event, 'DTEND')).toBe('DTEND;TZID=Asia/Dubai:20261114T010000')
  })

  it('makes an event with no time yet an all-day entry on its own day, not midnight', () => {
    const [event] = events(buildCalendarFeed([{ ...base, startTime: null, endTime: null }]))
    expect(prop(event, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20261113')
    expect(prop(event, 'DTEND')).toBe('DTEND;VALUE=DATE:20261114')
  })

  it('crosses month and year ends correctly for all-day entries', () => {
    const [event] = events(buildCalendarFeed([{ ...base, date: '2026-12-31', startTime: null, endTime: null }]))
    expect(prop(event, 'DTEND')).toBe('DTEND;VALUE=DATE:20270101')
  })

  it('leaves out the end when the coach gave none, rather than inventing a length', () => {
    const [event] = events(buildCalendarFeed([{ ...base, endTime: null }]))
    expect(prop(event, 'DTEND')).toBeUndefined()
  })
})

describe('buildCalendarFeed: titles and details', () => {
  it('titles a training, a match, a tournament and an other event by squad and type', () => {
    const feed = buildCalendarFeed([
      { ...base, id: '1', kind: 'training' },
      { ...base, id: '2', kind: 'match', opponent: 'Rivals FC', homeAway: 'away' },
      { ...base, id: '3', kind: 'tournament' },
      { ...base, id: '4', kind: 'other' },
    ])
    expect(events(feed).map(e => prop(e, 'SUMMARY'))).toEqual([
      'SUMMARY:U15 Training',
      'SUMMARY:U15 Match vs Rivals FC (away)',
      'SUMMARY:U15 Tournament',
      'SUMMARY:U15 Event',
    ])
  })

  it('puts the venue in LOCATION and the meet time and kit in the description', () => {
    const [event] = events(buildCalendarFeed([{ ...base, kind: 'match', opponent: 'Rivals FC', meetTime: '17:15', kit: 'White' }]))
    expect(prop(event, 'LOCATION')).toBe('LOCATION:Main pitch')
    const description = prop(event, 'DESCRIPTION')!
    expect(description).toContain('Meet: 17:15')
    expect(description).toContain('Kit: White')
    expect(description).toContain('Full schedule in Trak: https://trakfootball.com')
  })

  it('marks a cancelled event cancelled and keeps it, so phones show it rather than silently dropping it', () => {
    const [event] = events(buildCalendarFeed([{ ...base, status: 'cancelled', sequence: 2 }]))
    expect(prop(event, 'STATUS')).toBe('STATUS:CANCELLED')
    expect(prop(event, 'SUMMARY')).toBe('SUMMARY:Cancelled: U15 Training')
    expect(prop(event, 'SEQUENCE')).toBe('SEQUENCE:2')
    expect(prop(events(buildCalendarFeed([base]))[0], 'STATUS')).toBe('STATUS:CONFIRMED')
  })

  it('leaves out coach free text that could name a child: no notes, no cancel reason, no event title', () => {
    const withText = { ...base, kind: 'other' as const, notes: 'Sam back from injury', cancelReason: 'Sam ill', title: "Sam's birthday" }
    const feed = buildCalendarFeed([withText as FeedEvent, { ...withText, id: 'c', status: 'cancelled' } as FeedEvent])
    expect(feed).not.toContain('Sam')
  })

  it('drops any detail that contains a rostered child\'s name (J8 check 6)', () => {
    const feed = buildCalendarFeed(
      [{ ...base, kind: 'match', opponent: 'Rivals FC', venue: "Omar's dad's pitch", kit: 'White' }],
      { childNames: ['Omar Haddad', 'Lucas Petit'] },
    )
    expect(feed).not.toMatch(/omar/i)
    const [event] = events(feed)
    expect(prop(event, 'LOCATION')).toBeUndefined()
    expect(prop(event, 'SUMMARY')).toBe('SUMMARY:U15 Match vs Rivals FC')
    expect(prop(event, 'DESCRIPTION')).toContain('Kit: White')
  })

  it('matches child names as whole words only, so a venue is not lost to a name inside a longer word', () => {
    const feed = buildCalendarFeed(
      [{ ...base, venue: 'Samiha Hall', kit: 'Bali blue' }],
      { childNames: ['Sami Rahman', 'Ali Nasser'] },
    )
    const [event] = events(feed)
    expect(prop(event, 'LOCATION')).toBe('LOCATION:Samiha Hall')
    expect(prop(event, 'DESCRIPTION')).toContain('Kit: Bali blue')
  })

  it('ignores name particles that are also in ordinary venue names (Al, bin)', () => {
    const feed = buildCalendarFeed(
      [{ ...base, venue: 'Zayed Bin Sultan Stadium', kit: 'Al Wasl away kit' }],
      { childNames: ['Omar Al Haddad', 'Rashid bin Saeed'] },
    )
    const [event] = events(feed)
    expect(prop(event, 'LOCATION')).toBe('LOCATION:Zayed Bin Sultan Stadium')
    expect(prop(event, 'DESCRIPTION')).toContain('Kit: Al Wasl away kit')
  })

  it('still catches a child name written in Arabic', () => {
    const feed = buildCalendarFeed([{ ...base, venue: 'ملعب عمر' }], { childNames: ['عمر حداد'] })
    expect(prop(events(feed)[0], 'LOCATION')).toBeUndefined()
  })

  it('removes an opponent that names a child from the title as well', () => {
    const feed = buildCalendarFeed([{ ...base, kind: 'match', opponent: 'Lucas FC' }], { childNames: ['Lucas Petit'] })
    expect(prop(events(feed)[0], 'SUMMARY')).toBe('SUMMARY:U15 Match')
  })
})

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and line breaks as RFC 5545 requires', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf')
  })

  it('escapes a venue with a comma inside the feed', () => {
    const [event] = events(buildCalendarFeed([{ ...base, venue: 'Zabeel Park, Pitch 2' }]))
    expect(prop(event, 'LOCATION')).toBe('LOCATION:Zabeel Park\\, Pitch 2')
  })
})

describe('foldLine', () => {
  const octets = (s: string) => new TextEncoder().encode(s).length

  it('keeps every physical line at 75 octets or fewer, and unfolds back to the original', () => {
    const long = `DESCRIPTION:${'x'.repeat(300)}`
    const folded = foldLine(long)
    for (const physical of folded.split('\r\n')) expect(octets(physical)).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })

  it('never splits a multi-byte character (an Arabic venue name)', () => {
    const long = `LOCATION:${'ملعب زعبيل '.repeat(12)}`
    const folded = foldLine(long)
    for (const physical of folded.split('\r\n')) {
      expect(octets(physical)).toBeLessThanOrEqual(75)
      expect(physical).not.toContain('�')
    }
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })

  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:U15 Training')).toBe('SUMMARY:U15 Training')
  })

  it('is applied to the feed: no physical line over 75 octets', () => {
    const feed = buildCalendarFeed([{ ...base, venue: 'ملعب '.repeat(40), kit: 'k'.repeat(120) }])
    for (const physical of feed.split('\r\n')) expect(octets(physical)).toBeLessThanOrEqual(75)
  })
})
