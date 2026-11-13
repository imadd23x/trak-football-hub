import {
  formProblem, pastDateProblem, repeatProblem, rowToForm, seriesDates, whatProblem,
  type EventForm, type EventKind, type EventRow, type Repeat,
} from '@/lib/coach-events'
import { localTodayISO } from '@/lib/event-time'
import { i18n } from '@/lib/i18n'

/** TRAK-407: the words the form's lists show, in the language showing: t(KIND_WORD.match). */
export const KIND_WORD = { match: 'coachSchedule:kindMatch', training: 'coachSchedule:kindTraining', other: 'coachSchedule:kindOther' } as const satisfies Record<EventKind, string>
export const STEP_WORD = { what: 'coachSchedule:stepWhat', when: 'coachSchedule:stepWhen', families: 'coachSchedule:stepFamilies', review: 'coachSchedule:stepReview' } as const
export const COMPETITION_WORD = { league: 'coachSchedule:competitionLeague', tournament: 'coachSchedule:competitionTournament', friendly: 'coachSchedule:competitionFriendly' } as const
export const WEEKDAY_WORD = ['coachSchedule:weekdayMon', 'coachSchedule:weekdayTue', 'coachSchedule:weekdayWed', 'coachSchedule:weekdayThu', 'coachSchedule:weekdayFri', 'coachSchedule:weekdaySat', 'coachSchedule:weekdaySun'] as const
export const THEME_WORD = { technical: 'coachSchedule:themeTechnical', attacking: 'coachSchedule:themeAttacking', defending: 'coachSchedule:themeDefending', transition: 'coachSchedule:themeTransition',
  goalkeeping: 'coachSchedule:themeGoalkeeping', physical: 'coachSchedule:themePhysical', psychological: 'coachSchedule:themePsychological' } as const

/* TRAK-331 (Imad, 2 Nov): what the event sheet (EventEditSheet) and the pages that save it share, moved out of
   Schedule as it was. */

/** A write that changed no row was refused (RLS filters, it doesn't error). */
export function failed(error: unknown, data: unknown[] | null) {
  return !!error || !data?.length
}

export const SAVE_FAILED = "Couldn't save the event. Check your connection and try again; your details are still here."

export const inputClass = 'w-full bg-ground border border-line rounded-[12px] px-3 py-2.5 text-[14px] text-ink placeholder-ink-3 outline-none'
export const font = { fontFamily: 'var(--t-font)' }
export const mono = { fontFamily: 'var(--t-font-mono)' }

export const KIND_LABEL: Record<EventKind, string> = { match: 'Match', training: 'Training', other: 'Other' }

export type Scope = 'one' | 'following'
/** The sheet while it's open: the event (null for a new one), what's typed, and the step. */
export type EditSheet = { row: EventRow | null; form: EventForm; repeat: Repeat; scope: Scope; step: number; error: string | null }

export const EVENT_STEPS = [
  { id: 'what', label: 'What' },
  { id: 'when', label: 'When' },
  { id: 'families', label: 'For families' },
  { id: 'review', label: 'Review' },
]
export const REVIEW = EVENT_STEPS.length - 1
/** TRAK-367: the step with the note for families, for a link straight to it. */
export const NOTE_STEP = 2

/** TRAK-127: a past date on New event, or moved to on an edit. TRAK-288: where Games is on, a new match that has
 *  been played is saved to be evaluated instead (Imad, 28 Oct), so its date isn't a problem. */
export function pastProblem(form: EventForm, editing: EventRow | null, games = false, training = false) {
  if (playedMatch(form, editing, games) || playedTraining(form, editing, training)) return null
  return pastDateProblem(form.date, localTodayISO(), editing ? rowToForm(editing).date : null)
}
export const playedMatch = (form: EventForm, editing: EventRow | null, games: boolean) =>
  games && !editing && form.kind === 'match' && pastDateProblem(form.date, localTodayISO()) !== null
/** TRAK-426 (Kostas, 12 Nov): where Training is on, a training already held is a New event Training too, saved,
 *  published and opened on its register (Who's here), as a played match opens on its evaluation. */
export const playedTraining = (form: EventForm, editing: EventRow | null, training: boolean) =>
  training && !editing && form.kind === 'training' && pastDateProblem(form.date, localTodayISO()) !== null

/** TRAK-288: where Games is on, New event asks a match's competition, so publishing its evaluation can read it. */
export const competitionProblem = (form: EventForm, editing: EventRow | null, games: boolean) =>
  games && !editing && form.kind === 'match' && !form.competition ? i18n.t('coachSchedule:problemCompetition') : null

/** What stops Next on a step: only what that step can fix. */
export function stepProblem(step: number, form: EventForm, repeat: Repeat, editing: EventRow | null, games: boolean, training = false) {
  if (step === 0) return whatProblem(form) ?? competitionProblem(form, editing, games)
  if (step === 1) return formProblem(form) ?? pastProblem(form, editing, games, training)
    ?? (editing || playedTraining(form, editing, training) ? null : repeatProblem(form, repeat))
  return null
}

/** How many events Review's save makes: a new weekly series is several. */
export function seriesCount(sheet: { row: EventRow | null; form: EventForm; repeat: Repeat }) {
  const { row, form, repeat } = sheet
  // A training already held (TRAK-426) is one event: Review's save never repeats it.
  return !row && repeat.on && form.kind !== 'match' && pastDateProblem(form.date, localTodayISO()) === null && !repeatProblem(form, repeat)
    ? seriesDates(form.date, repeat.until, repeat.days).length : 1
}

export const inSeries = (row: EventRow | null): row is EventRow & { series_id: string; event_date: string } =>
  !!row?.series_id && !!row.event_date
