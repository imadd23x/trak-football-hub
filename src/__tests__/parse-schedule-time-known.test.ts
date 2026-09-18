import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inferTimeKnown, fillTimeKnown } from '../../supabase/functions/parse-schedule/time-known'

/**
 * Guards the unknown-time contract on parse-schedule's output.
 *
 * `20260918000001` gave `coach_calendar_events` a real calendar day plus a
 * nullable `start_time`, so the table can finally record "the day is set, the
 * time is not known yet". Nothing upstream could say which it was, so the
 * importer inferred it from the value: midnight means TBC.
 *
 * That inference is wrong for exactly one input — an event the coach's own
 * schedule places at midnight — and once the row is written, nothing can
 * recover which of the two it was. Tarek raised this on #42 while converting
 * the importer paths, and deferred it here because the edge function is K8's.
 *
 * The parser is the last point that still knows, because it saw the text.
 */

const INDEX = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'parse-schedule', 'index.ts'),
  'utf8',
)

describe('inferTimeKnown — the fallback, used only when the model omits the field', () => {
  it('reads a stated time as known', () => {
    expect(inferTimeKnown('2026-03-01T18:30:00')).toBe(true)
    expect(inferTimeKnown('2026-03-01T18:30:00+04:00')).toBe(true)
    expect(inferTimeKnown('2026-03-01T09:05')).toBe(true)
  })

  it('reads a bare date as time unknown', () => {
    expect(inferTimeKnown('2026-03-01')).toBe(false)
  })

  it('reads midnight as time unknown, which is the whole ambiguity', () => {
    expect(inferTimeKnown('2026-03-01T00:00:00')).toBe(false)
    expect(inferTimeKnown('2026-03-01T00:00')).toBe(false)
  })

  it('does not treat a non-string as a time', () => {
    expect(inferTimeKnown(undefined)).toBe(false)
    expect(inferTimeKnown(null)).toBe(false)
    expect(inferTimeKnown(20260301)).toBe(false)
  })

  it('does not mistake 00:00 inside a date or offset for a midnight time', () => {
    // A +00:00 offset contains "00:00" but the event is at 18:30.
    expect(inferTimeKnown('2026-03-01T18:30:00+00:00')).toBe(true)
  })
})

describe('fillTimeKnown — every event carries a boolean', () => {
  it("keeps the model's answer, including for a genuine midnight kick-off", () => {
    // This is the case the heuristic gets wrong and the model can get right.
    // If the fallback ever overrides a stated value, this is the regression.
    const parsed = fillTimeKnown({
      events: [{ title: 'Midnight friendly', starts_at: '2026-03-01T00:00:00', time_known: true }],
    })
    expect(parsed.events[0].time_known).toBe(true)
  })

  it("keeps an explicit false even when a time is present", () => {
    const parsed = fillTimeKnown({
      events: [{ title: 'Guessed', starts_at: '2026-03-01T18:00:00', time_known: false }],
    })
    expect(parsed.events[0].time_known).toBe(false)
  })

  it('fills the field when the model omitted it', () => {
    const parsed = fillTimeKnown({
      events: [
        { title: 'Timed', starts_at: '2026-03-01T18:00:00' },
        { title: 'Day only', starts_at: '2026-03-02' },
      ],
    })
    expect(parsed.events.map((e: any) => e.time_known)).toEqual([true, false])
  })

  it('leaves a payload with no events array alone rather than throwing', () => {
    expect(() => fillTimeKnown({ error: 'nope' })).not.toThrow()
    expect(() => fillTimeKnown(null)).not.toThrow()
    expect(() => fillTimeKnown({ events: 'not an array' })).not.toThrow()
  })

  it('survives a malformed event entry', () => {
    const parsed = fillTimeKnown({
      events: [null, 'nonsense', { title: 'ok', starts_at: '2026-03-01T18:00:00' }] as any[],
    })
    expect(parsed.events[2].time_known).toBe(true)
  })
})

describe('the function actually applies the contract', () => {
  it('declares time_known as required in the tool schema', () => {
    // A field the model may silently drop is not a contract callers can use.
    expect(
      /required:\s*\[[^\]]*"time_known"/.test(INDEX),
      'time_known is not in the tool schema\'s required list, so the model may omit it.',
    ).toBe(true)
  })

  it('calls fillTimeKnown before returning', () => {
    expect(
      INDEX.includes('fillTimeKnown(parsed)'),
      'parse-schedule returns the parsed payload without guaranteeing time_known, so callers ' +
        'get undefined some of the time and go back to guessing from midnight.',
    ).toBe(true)
  })

  it('tells the model that an explicit midnight is a known time', () => {
    // The prompt is the only thing that can get the one ambiguous case right.
    expect(
      /midnight/i.test(INDEX) && /time_known/.test(INDEX),
      'the system prompt does not tell the model how to treat an explicit midnight kick-off, ' +
        'which is the single case the midnight heuristic cannot get right.',
    ).toBe(true)
  })
})
