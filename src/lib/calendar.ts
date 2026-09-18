/**
 * Calendar validity for the three date-of-birth selects.
 *
 * The day select always offered 1–31, so "31 February" was selectable. That is
 * not merely untidy: `new Date('2010-02-31')` does not fail, it silently rolls
 * over to 3 March. So the age the consent gate is calculated from was a date
 * the player never entered, while the literal string still went to Postgres,
 * which does reject it — leaving signup stuck on a database error the player
 * could not act on.
 */

/** Days in a month. `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate()
}

/** True only if year/month/day is a date that actually exists. */
export function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12) return false
  if (day < 1) return false
  return day <= daysInMonth(year, month)
}
