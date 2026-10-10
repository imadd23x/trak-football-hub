// TRAK-132 (J8.9): the text of a person's private calendar feed (RFC 5545).
//
// Pure: no database, no clock, no network. The feed endpoint decides whose
// events go in (active consent, current squad, link not revoked) and hands
// them here. Same events in, same text out, so a calendar app that refetches
// sees no change unless something really changed.
//
// What makes Apple, Google and Outlook update an event instead of adding a
// second copy: the UID never changes for an event, and SEQUENCE goes up on
// every change (J8.2 bumps it). A cancelled event stays in the feed marked
// CANCELLED; dropping it would leave it on phones that already have it.
//
// Privacy (J8 check 6): no entry may contain a child's name. Titles are built
// from the squad and the event type only. Coach free text that could name a
// child (notes, cancel reason, an "other" event's title) is never an input.
// The fields that do go in (opponent, venue, kit) are dropped if they contain
// a rostered child's name.

export type FeedEventKind = 'training' | 'match' | 'tournament' | 'other'

export interface FeedEvent {
  /** coach_calendar_events.id: becomes the UID, so it must never change. */
  id: string
  kind: FeedEventKind
  /** The squad, e.g. "U15". Never a child. */
  squadLabel: string
  /** YYYY-MM-DD as the coach entered it (event_date). */
  date: string
  /** HH:MM wall clock in the academy's time, or null when not known yet. */
  startTime: string | null
  endTime: string | null
  meetTime: string | null
  opponent: string | null
  homeAway: 'home' | 'away' | null
  venue: string | null
  kit: string | null
  status: 'scheduled' | 'cancelled'
  /** J8.2's change counter. */
  sequence: number
  /** ISO instant of the last change; becomes DTSTAMP and LAST-MODIFIED. */
  updatedAt: string
}

export interface FeedOptions {
  /** Full names of the children the feed covers and their squads. Any detail containing one is left out. */
  childNames?: string[]
}

export const FEED_TZID = 'Asia/Dubai'
const UID_DOMAIN = 'trakfootball.com'
const TRAK_LINK = 'https://trakfootball.com'

const KIND_LABEL: Record<FeedEventKind, string> = {
  training: 'Training',
  match: 'Match',
  tournament: 'Tournament',
  other: 'Event',
}

// Name parts too short or too common to identify a child, and which appear in
// ordinary venue names ("Al Wasl", "Zayed Bin Sultan").
const NOT_A_NAME = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'abu', 'van', 'von', 'de', 'da', 'di', 'del', 'la', 'le'])

/** RFC 5545 3.3.11: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * RFC 5545 3.1: no line longer than 75 octets; continue with CRLF and a space.
 * Counted in UTF-8 bytes and split only between characters, so an Arabic
 * venue name is never cut in the middle of a letter.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const bytes = encoder.encode(ch).length
    // The first line holds 75 octets; continuation lines lose one to the space.
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

function namePatterns(names: string[]): RegExp[] {
  const parts = new Set<string>()
  for (const name of names) {
    for (const part of name.toLowerCase().split(/[\s'’-]+/)) {
      if (part.length >= 3 && !NOT_A_NAME.has(part)) parts.add(part)
    }
  }
  // Whole words only, by Unicode letters rather than \b, which knows only ASCII.
  return [...parts].map(p => new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu'))
}

function clean(value: string | null, patterns: RegExp[]): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  return patterns.some(p => p.test(v)) ? null : v
}

const compactDate = (date: string) => date.replace(/-/g, '')
const compactTime = (time: string) => `${time.slice(0, 2)}${time.slice(3, 5)}00`

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function eventLines(event: FeedEvent, patterns: RegExp[]): string[] {
  const opponent = clean(event.opponent, patterns)
  const venue = clean(event.venue, patterns)
  const kit = clean(event.kit, patterns)

  let title = `${event.squadLabel} ${KIND_LABEL[event.kind]}`
  if (event.kind === 'match' && opponent) title += ` vs ${opponent}`
  if (event.kind === 'match' && event.homeAway) title += ` (${event.homeAway})`
  const cancelled = event.status === 'cancelled'
  if (cancelled) title = `Cancelled: ${title}`

  const details: string[] = []
  if (cancelled) details.push('This event is cancelled.')
  if (event.meetTime) details.push(`Meet: ${event.meetTime}`)
  if (kit) details.push(`Kit: ${kit}`)
  details.push(`Full schedule in Trak: ${TRAK_LINK}`)

  const stamp = utcStamp(event.updatedAt)
  const out = [
    'BEGIN:VEVENT',
    `UID:${event.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${event.sequence}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
  ]
  if (event.startTime) {
    out.push(`DTSTART;TZID=${FEED_TZID}:${compactDate(event.date)}T${compactTime(event.startTime)}`)
    if (event.endTime) {
      const endDate = event.endTime < event.startTime ? nextDay(event.date) : event.date
      out.push(`DTEND;TZID=${FEED_TZID}:${compactDate(endDate)}T${compactTime(event.endTime)}`)
    }
  } else {
    // Time not known yet: an all-day entry on the coach's day, never midnight.
    out.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`)
    out.push(`DTEND;VALUE=DATE:${compactDate(nextDay(event.date))}`)
  }
  out.push(`SUMMARY:${escapeText(title)}`)
  if (venue) out.push(`LOCATION:${escapeText(venue)}`)
  out.push(`DESCRIPTION:${escapeText(details.join('\n'))}`)
  out.push('TRANSP:OPAQUE', 'END:VEVENT')
  return out
}

/** The whole feed. An empty list is still a valid calendar: what a revoked or withdrawn link returns. */
export function buildCalendarFeed(events: FeedEvent[], options: FeedOptions = {}): string {
  const patterns = namePatterns(options.childNames ?? [])

  // A parent with two children in one squad would otherwise get each event twice.
  const unique = [...new Map(events.map(e => [e.id, e])).values()]
  unique.sort((a, b) =>
    a.date.localeCompare(b.date)
    || (a.startTime ?? '').localeCompare(b.startTime ?? '')
    || a.id.localeCompare(b.id))

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Trak Football//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Trak Football',
    `X-WR-TIMEZONE:${FEED_TZID}`,
    // Hints only: each app decides how often it really refetches.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    // Dubai has had no daylight saving since 1970, so one fixed offset is exact.
    'BEGIN:VTIMEZONE',
    `TZID:${FEED_TZID}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0400',
    'TZOFFSETTO:+0400',
    'TZNAME:+04',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...unique.flatMap(e => eventLines(e, patterns)),
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
