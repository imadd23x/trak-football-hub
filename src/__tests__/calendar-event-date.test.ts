import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards 20260918000001, which gives coach_calendar_events a real calendar
 * date and a way to say the time is not known.
 *
 * The table stored only `starts_at timestamptz`, so "time to be confirmed"
 * was encoded as local midnight — indistinguishable from a genuine midnight
 * event, and a value that moves to the previous day when read in a
 * different timezone. An untimed event entered as 1 March in Dubai read as
 * 28 February 20:00 in Athens.
 *
 * These are static checks over the migration files. They cannot prove the
 * live table is correct; they fail if someone removes the columns, or
 * reintroduces the two mistakes that are easy to make here.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

function calendarMigration(): string {
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  let latest = ''
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    if (sql.includes('coach_calendar_events') && sql.includes('event_date')) latest = sql
  }
  return latest
}

describe('coach_calendar_events can express a date and an unknown time', () => {
  const sql = calendarMigration()

  it('adds the calendar date and wall-clock columns', () => {
    expect(sql, 'no migration adds event_date to coach_calendar_events').not.toBe('')
    for (const col of ['event_date', 'start_time', 'end_time']) {
      expect(
        sql.includes(col),
        `${col} is missing. Without it the table cannot distinguish "time not known yet" ` +
          `from a real midnight event, and the date moves between timezones.`,
      ).toBe(true)
    }
  })

  it('never rewrites starts_at', () => {
    // Recovering a true instant for a historical row needs the timezone the
    // coach entered it in, and nothing records that — organizations has no
    // timezone column. Any migration that "corrects" starts_at is guessing,
    // and would destroy the one value the wall clock is recoverable from.
    expect(
      /UPDATE\s+public\.coach_calendar_events[\s\S]{0,400}?SET[\s\S]{0,200}?\bstarts_at\s*=/i.test(sql),
      'This migration rewrites starts_at. The true instant cannot be reconstructed without an ' +
        'academy timezone, which does not exist in the schema — rewriting it would replace a ' +
        'recoverable wall clock with a guess.',
    ).toBe(false)
  })

  it('leaves event_date nullable until writers populate it', () => {
    // A NOT NULL here rejects every calendar save between this migration and
    // the frontend change that starts sending event_date.
    expect(
      /ADD COLUMN IF NOT EXISTS\s+event_date\s+date\s+NOT NULL/i.test(sql),
      'event_date is NOT NULL, which rejects every insert from writers that do not set it yet. ' +
        'Make it NOT NULL in a follow-up once CoachSchedule and the schedule parser populate it.',
    ).toBe(false)
  })

  it('recovers the wall clock the coach typed, via the naive-as-UTC convention', () => {
    expect(
      sql.includes("AT TIME ZONE 'UTC'"),
      'The backfill no longer reads starts_at AT TIME ZONE \'UTC\'. Existing rows were written ' +
        'as a naive string and read as UTC, which is precisely what makes the original wall ' +
        'clock recoverable; any other derivation invents a time.',
    ).toBe(true)
  })

  it('treats midnight as time-unknown rather than a real session', () => {
    expect(
      /NULLIF\(\s*\(\s*starts_at AT TIME ZONE 'UTC'\s*\)::time\s*,\s*'00:00:00'\s*\)/i.test(sql),
      'Midnight is no longer mapped to NULL. The existing code uses midnight to mean "time to ' +
        'be confirmed", so a straight copy would render TBC events as sessions in the middle ' +
        'of the night.',
    ).toBe(true)
  })
})
