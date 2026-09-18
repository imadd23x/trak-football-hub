import { daysInMonth } from './calendar'

/**
 * Session times, stored as a real instant rather than a naive wall clock.
 *
 * The schedule used to build `starts_at` as `${date}T${time}:00` — no offset —
 * and hand it to a timestamptz column. A string with no offset is read in the
 * connection's timezone, which for PostgREST is UTC, so a coach in Dubai
 * entering 18:00 stored 18:00Z, four hours later than they meant.
 *
 * It looked fine to the coach only because the schedule read the value back by
 * slicing characters out of the raw ISO string, recovering the same UTC wall
 * clock it had sent. The player screen did the honest thing — `new Date(...)`
 * then render in the device's zone — and so showed 22:00 for a 6pm session.
 * Two bugs that cancelled on one screen and not on the other.
 *
 * These helpers keep one rule: a date and time typed by a person are always
 * interpreted in that person's own timezone, in both directions.
 */

/** Days in a month. `month` is 1-based. */
/**
 * Build an absolute instant from wall-clock parts entered locally, or null if
 * those parts are not a real date and time.
 *
 * Strict on purpose. This used to coerce: `new Date(2026, 1, 31)` does not
 * fail, it rolls over to 3 March, and an unparseable string produced an
 * Invalid Date whose .toISOString() threw a RangeError — which crashed the
 * bulk draft save rather than reporting a bad row. Neither is acceptable for
 * a value that ends up as the date of a child's session.
 */
export function toInstant(date: string, time?: string | null): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date || '').trim())
  if (!dm) return null
  const y = Number(dm[1]), m = Number(dm[2]), d = Number(dm[3])
  if (m < 1 || m > 12) return null
  if (d < 1 || d > daysInMonth(y, m)) return null

  let hh = 0, mm = 0
  const raw = (time ?? '').trim()
  if (raw) {
    const tm = /^(\d{1,2}):(\d{2})/.exec(raw)
    if (!tm) return null
    hh = Number(tm[1]); mm = Number(tm[2])
    if (hh > 23 || mm > 59) return null
  }

  const built = new Date(y, m - 1, d, hh, mm, 0, 0)
  if (Number.isNaN(built.getTime())) return null
  return built.toISOString()
}

/** Split an instant back into the local date and time a person would read. */
export function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}

/**
 * Whether an event carries a real kick-off time or is still to be confirmed.
 * The convention is local midnight, which is what toInstant writes when the
 * coach leaves the time blank.
 */
export function isTimeTBC(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return true
  return d.getHours() === 0 && d.getMinutes() === 0
}

/**
 * Normalise a value that may already be an instant, or may be a naive
 * `YYYY-MM-DDTHH:mm` with no offset — which is what the schedule parser returns.
 * A naive value is read as the coach's local wall clock, never as UTC.
 */
export function normalizeInstant(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.trim()

  // The calendar date is validated whether or not the value carries an offset.
  // Skipping this for offset-bearing values was a real hole: JavaScript parses
  // '2026-02-31T10:00:00Z' as 3 March rather than rejecting it, so an
  // impossible day arriving from the parser with a Z or a +04:00 was saved as
  // the wrong date — the same defect toInstant already refuses for naive
  // strings, reachable by the other route.
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!dm) return null
  const y = Number(dm[1]), m = Number(dm[2]), d = Number(dm[3])
  if (m < 1 || m > 12) return null
  if (d < 1 || d > daysInMonth(y, m)) return null

  // Case-insensitive Z, and hour-only offsets like +04. Both are valid ISO and
  // both used to fall through to the naive branch, where a value that already
  // carried an offset was re-read as the coach's local wall clock — off by
  // exactly the offset, silently.
  //
  // The offset must follow a time. Matching a bare trailing [+-]NN would read
  // the "-01" of "2026-03-01" as an hour-only offset and parse a plain date as
  // UTC midnight — which in Dubai renders as 04:00. The existing suite caught
  // that the moment the pattern was widened.
  const hasOffset = /\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/.test(raw)
  if (hasOffset) {
    // The offset is authoritative for the instant; the calendar parts above
    // have already been checked against the frame they were written in.
    // An hour-only offset is expanded because Date.parse rejects "+04".
    const normalised = raw
      .replace(/\s+/, 'T')
      .replace(/z$/, 'Z')
      .replace(/([+-]\d{2})$/, '$1:00')
    const parsed = new Date(normalised)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }

  // Postgres and several exporters separate date and time with a space rather
  // than a T. Rejecting those outright discarded rows that were perfectly
  // well-formed.
  const [datePart, timePart] = raw.split(/[T ]/)
  if (!datePart) return null
  return toInstant(datePart, timePart ? timePart.slice(0, 5) : null)
}

/*
 * Known limitation, deliberately not papered over.
 *
 * "No time given" is stored as local midnight, because coach_calendar_events
 * has only `starts_at timestamptz` and no way to say the time is unknown. An
 * instant is not a calendar date, so an untimed session entered as 1 March in
 * Dubai is 28 Feb 20:00Z, which an Athens reader sees as 28 Feb 22:00 — wrong
 * date, and no longer detected as TBC.
 *
 * That cannot be fixed in this file. It needs a column saying whether the time
 * is known, and the date kept as a date. Raised with Kostas as a follow-up
 * migration on his table rather than bolted on here. Within a single academy,
 * where writer and reader share a timezone, the behaviour is correct.
 */

/**
 * The calendar-day fields introduced by 20260918000001.
 *
 * `event_date` is the day the coach chose and `start_time` is the wall clock
 * they typed, with NULL meaning the time is not yet known. Storing those
 * alongside `starts_at` is what makes an untimed session survive a timezone
 * difference: an instant cannot express "the 1st of March, time to be
 * confirmed", and encoding it as local midnight moves the date.
 */
export function calendarFields(date: string, time?: string | null): {
  event_date: string
  start_time: string | null
} | null {
  const trimmedDate = (date || '').trim()
  const trimmedTime = (time ?? '').trim()

  // Reuse toInstant purely as the validator, so the calendar columns and
  // starts_at can never disagree about whether the input was usable.
  if (!toInstant(trimmedDate, trimmedTime || null)) return null

  return {
    event_date: trimmedDate,
    start_time: trimmedTime ? `${trimmedTime}:00`.slice(0, 8) : null,
  }
}

/** Read back what a person should see, preferring the calendar columns. */
export function displayEventTime(row: {
  event_date?: string | null
  start_time?: string | null
  starts_at?: string | null
}): { date: string; time: string | null } {
  // New rows carry the wall clock the coach typed, so no timezone maths is
  // involved and no reader can shift the date.
  if (row.event_date) {
    return {
      date: row.event_date,
      time: row.start_time ? row.start_time.slice(0, 5) : null,
    }
  }
  // A row written before the backfill, or by an older client that has not
  // reloaded. Falls back to the instant.
  if (row.starts_at) {
    const parts = localParts(row.starts_at)
    return { date: parts.date, time: isTimeTBC(row.starts_at) ? null : parts.time }
  }
  return { date: '', time: null }
}

/**
 * Derive the calendar columns from an instant, for rows that arrive as a
 * timestamp rather than as fields a coach typed — the schedule importer.
 *
 * Midnight is read as "time not known", which is the same convention
 * 20260918000001's backfill uses (`NULLIF(…::time, '00:00:00')`), so an
 * imported row and a backfilled one mean the same thing by the same rule.
 *
 * The limitation is real and worth stating: a genuine midnight kick-off
 * imported from a parsed schedule is indistinguishable from an unknown time.
 * Only the parser emitting an explicit flag fixes that, which is K8's
 * `parse-schedule` work, not something a caller can infer.
 */
export function calendarFieldsFromInstant(iso: string | null): {
  event_date: string
  start_time: string | null
} | null {
  if (!iso) return null
  const parts = localParts(iso)
  if (!parts.date) return null
  return {
    event_date: parts.date,
    start_time: isTimeTBC(iso) ? null : `${parts.time}:00`,
  }
}
