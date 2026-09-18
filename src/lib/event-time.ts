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
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

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

  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)
  if (hasOffset) {
    // The offset is authoritative for the instant; the calendar parts above
    // have already been checked against the frame they were written in.
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }

  const [datePart, timePart] = raw.split('T')
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
