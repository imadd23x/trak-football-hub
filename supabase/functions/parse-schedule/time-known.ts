/**
 * The unknown-time contract for parse-schedule's output.
 *
 * `coach_calendar_events` can now say "this is the day, the time is not known
 * yet" (`20260918000001`), but an instant cannot express that. The importer
 * therefore had to guess from the value: midnight means TBC. That guess is
 * wrong for exactly one case — a genuine midnight kick-off — and there is no
 * way for a caller to tell the two apart after the fact.
 *
 * The parser is the only place that still knows, because it saw the input. So
 * it reports `time_known` explicitly and callers stop guessing.
 *
 * Kept in its own module, free of Deno and URL imports, so the behaviour is
 * reachable from the vitest suite rather than only assertable as text.
 */

/**
 * The midnight heuristic, in one place.
 *
 * This is what the importer does today, and it is the fallback for when the
 * model omits `time_known` despite the tool schema requiring it. It is not the
 * primary answer — a model-supplied value always wins, including for the
 * midnight event this gets wrong.
 */
export function inferTimeKnown(startsAt: unknown): boolean {
  if (typeof startsAt !== "string") return false;
  // No time component at all ("2026-03-01") is a date, so the time is unknown.
  if (!/T\d{2}:\d{2}/.test(startsAt)) return false;
  // Midnight was the existing "time unknown" signal.
  if (/T00:00(:00)?/.test(startsAt)) return false;
  return true;
}

/**
 * Guarantees every event carries a boolean `time_known`.
 *
 * `required` in a tool schema is a strong hint, not a guarantee. Without this,
 * a caller gets `undefined` some of the time and has to write the fallback
 * itself — which is the duplication that let the two date paths in
 * `CoachSchedule` drift apart in the first place.
 *
 * Mutates in place and returns the same value it was given, so it can wrap the
 * parsed payload without changing its shape.
 */
export function fillTimeKnown<T>(parsed: T): T {
  const events = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(events)) return parsed;
  for (const ev of events) {
    if (ev && typeof ev === "object" && typeof (ev as { time_known?: unknown }).time_known !== "boolean") {
      (ev as { time_known: boolean }).time_known = inferTimeKnown((ev as { starts_at?: unknown }).starts_at);
    }
  }
  return parsed;
}
