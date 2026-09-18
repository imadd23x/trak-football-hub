-- ============================================================
-- coach_calendar_events cannot say "the time is not known yet"
--
-- Raised by Tarek against S7 (#20/#30) and handed over as a migration on
-- this table. The table stores only:
--
--   starts_at timestamptz NOT NULL
--   ends_at   timestamptz NULL
--
-- An instant is not a calendar date, and there is no way to record that a
-- coach scheduled a session for a day without yet knowing the time. Both
-- gaps produce the same visible failure: an untimed event entered as
-- 1 March in Dubai is stored as that day's local midnight, which is
-- 28 February 20:00 in Athens — the event moves to the previous day, and
-- the fact that the time was unknown is lost, so it renders as a real
-- 20:00 session that nobody scheduled.
--
-- The existing code signals "time unknown" by writing local midnight, which
-- is the same value a genuine midnight event would have and shifts date
-- across zones. A calendar needs the date to be a date.
--
-- ── What this adds ──────────────────────────────────────────
--
--   event_date  date  — the calendar day, as the coach chose it
--   start_time  time  — the wall clock; NULL means the time is not known
--   end_time    time  — same, for the end
--
-- starts_at and ends_at are left exactly as they are. They stay the
-- cross-zone instant and remain what current readers use; nothing breaks on
-- deploy. New readers should prefer event_date/start_time, which are what
-- the coach actually entered and do not move between zones.
--
-- ── Why the backfill is exact, not a guess ──────────────────
--
-- Every row in this table was written by the naive-string bug S7 describes:
-- the UI built `${date}T${time}:00` with no offset and handed it to a
-- timestamptz column, so PostgREST read it as UTC. That bug is what makes
-- the original wall clock exactly recoverable — `starts_at AT TIME ZONE
-- 'UTC'` returns precisely the date and time the coach typed. Verified
-- against the live table: 20 rows, the earliest reading 2026-04-28
-- 18:00:00+00, which is a coach typing 18:00, not an instant.
--
-- ⚠️ ORDERING. That recovery is only valid for rows written under the old
-- convention. Once #30's `toInstant` ships, new rows carry a true instant
-- with an offset and `AT TIME ZONE 'UTC'` is no longer the wall clock. This
-- migration must reach production BEFORE #30's frontend, or any event
-- created in between gets a wrong event_date/start_time. CI deploys
-- migrations ahead of the frontend within a single merge, so the safe
-- orders are: this merges first, or this and #30 merge together.
--
-- ── Why these columns are nullable ──────────────────────────
--
-- event_date is the natural NOT NULL, and it is deliberately left nullable
-- here. No writer sets it yet, so a NOT NULL would reject every calendar
-- save between this migration and the frontend change. It should be made
-- NOT NULL in a follow-up once CoachSchedule and the schedule parser
-- populate it — that file is currently in #30 and is Tarek's to change.
--
-- ── What this does NOT fix ──────────────────────────────────
--
-- Legacy starts_at values remain wrong as instants. Recovering the true
-- instant needs the timezone the coach entered it in, and nothing records
-- that: organizations has no timezone column. Rendering from
-- event_date/start_time sidesteps it, because within an academy the writer
-- and every reader share a zone — but a genuine cross-zone instant for a
-- historical row cannot be reconstructed from the data we have. If the
-- pilot needs that, an academy timezone is the prerequisite and it is a
-- team decision, not something to infer from a Greek-sounding club name.
-- ============================================================

ALTER TABLE public.coach_calendar_events
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time   time;

COMMENT ON COLUMN public.coach_calendar_events.event_date IS
  'The calendar day the coach chose. Authoritative for display; does not move between timezones the way starts_at does.';
COMMENT ON COLUMN public.coach_calendar_events.start_time IS
  'Wall clock at the academy. NULL means the time is not known yet (TBC) — previously encoded as local midnight, which was indistinguishable from a real midnight event.';
COMMENT ON COLUMN public.coach_calendar_events.end_time IS
  'Wall clock at the academy. NULL means no end time was given.';

-- Backfill. Faithful to what each row displays today rather than to what
-- anyone might have intended: seeded demo rows carry now() noise
-- (12:46:22.649) rather than a typed time, and re-seeding is the fix for
-- those, not a heuristic here.
--
-- Midnight becomes NULL because that is the convention the current code
-- already uses for "time unknown" (isTimeTBC checks for midnight). A
-- genuine 00:00 training session is not a real case, and reading one as
-- TBC is the safer of the two errors: it shows "time to be confirmed"
-- rather than inventing a session in the middle of the night.
UPDATE public.coach_calendar_events
SET event_date = (starts_at AT TIME ZONE 'UTC')::date,
    start_time = NULLIF((starts_at AT TIME ZONE 'UTC')::time, '00:00:00'),
    end_time   = CASE
                   WHEN ends_at IS NULL THEN NULL
                   ELSE NULLIF((ends_at AT TIME ZONE 'UTC')::time, '00:00:00')
                 END
WHERE event_date IS NULL;

-- The schedule reads a coach's events for a day, and will read by
-- event_date once the frontend moves over.
CREATE INDEX IF NOT EXISTS idx_coach_calendar_events_coach_date
  ON public.coach_calendar_events (coach_user_id, event_date);

-- An end before a start on the same day is not a real event. Left as a
-- trigger-free CHECK so it cannot be violated by any writer, and scoped to
-- the case where both times are known.
ALTER TABLE public.coach_calendar_events
  DROP CONSTRAINT IF EXISTS coach_calendar_events_time_order;
ALTER TABLE public.coach_calendar_events
  ADD CONSTRAINT coach_calendar_events_time_order
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time >= start_time)
  NOT VALID;

-- NOT VALID above means existing rows are not re-checked, so the migration
-- cannot fail on historical data; new and updated rows are checked. Validate
-- separately once the backfilled rows have been reviewed:
--   ALTER TABLE public.coach_calendar_events
--     VALIDATE CONSTRAINT coach_calendar_events_time_order;
