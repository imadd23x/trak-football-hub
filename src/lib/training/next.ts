import { trainingEnd, type TrainingEvent } from './sessions'

/* TRAK-339 (Training redo 1/5, spec TRAK-338, 2 Nov prototype): Training home's Next training card, kept apart from
   the screen. The card shows one training and where it is: before the day, on the day, or just finished and waiting
   for its Notes. */

const HOUR = 60 * 60_000
/** How long a finished training waits on the card for its Notes. After that it is just in Past trainings. */
export const NOTES_WAIT = 24 * HOUR

export type Phase = 'before' | 'day' | 'after'

/** The training the card shows, and its phase:
 *  - one under way (started, not ended): the day;
 *  - else one that ended in the last 24 hours with no Notes yet, the newest: after;
 *  - else the soonest coming up: the day when it is today, before otherwise.
 *  Null when there is none. `today` says whether a training starts on today's date, on the academy's clock. */
export function nextTraining<T extends TrainingEvent>(trainings: T[], now: number, noted: (id: string) => boolean,
  today: (training: T) => boolean): { training: T; phase: Phase } | null {
  const start = (t: T) => Date.parse(t.starts_at)
  const live = trainings.filter(t => start(t) <= now && trainingEnd(t) > now).sort((a, b) => start(a) - start(b))[0]
  if (live) return { training: live, phase: 'day' }
  const finished = trainings.filter(t => trainingEnd(t) <= now && trainingEnd(t) > now - NOTES_WAIT && !noted(t.id))
    .sort((a, b) => trainingEnd(b) - trainingEnd(a))[0]
  if (finished) return { training: finished, phase: 'after' }
  const coming = trainings.filter(t => start(t) > now).sort((a, b) => start(a) - start(b))[0]
  return coming ? { training: coming, phase: today(coming) ? 'day' : 'before' } : null
}

/** The card's loop: Logistics (from the schedule) → Plan → Who's here → Notes (optional). */
export const LOOP = [
  { id: 'logistics', label: 'Logistics', description: 'From the schedule' },
  { id: 'plan', label: 'Plan' },
  { id: 'here', label: 'Who’s here' },
  { id: 'notes', label: 'Notes', description: 'Optional' },
]

/** The loop's steps for the card. A step the card has moved past is ticked only if it really happened; otherwise it
 *  says what's missing (live check, 3 Nov: a training that ended with no register showed Who's here ticked). */
export function loopSteps({ current, planned, registered }: { current: number; planned: boolean; registered: boolean }) {
  return LOOP.map((step, i) => i >= current ? step
    : i === 1 && !planned ? { ...step, error: 'No plan written' }
    : i === 2 && !registered ? { ...step, error: 'No register taken' }
    : step)
}

export type Tone = 'success' | 'warning' | 'neutral'

/** The badge a training carries, on the card and in Upcoming trainings. */
export function trainingBadge({ phase, planned, here, draft = false }: { phase: Phase; planned: boolean; here?: number | null; draft?: boolean }): { label: string; tone: Tone } {
  if (phase === 'after') return here != null ? { label: `${here} here`, tone: 'success' } : { label: 'Finished', tone: 'neutral' }
  if (phase === 'day') return { label: 'Today', tone: 'success' }
  // TRAK-340: a plan started and kept as a draft.
  return planned ? { label: 'Plan ready', tone: 'success' } : draft ? { label: 'Draft', tone: 'neutral' } : { label: 'Plan not written', tone: 'warning' }
}

/* Notes: "Would you run this session again?" (Kostas, 2 Nov). */

export const AGAIN = [
  { value: 'yes', label: 'Yes' },
  { value: 'changes', label: 'Yes, with changes' },
  { value: 'no', label: 'No' },
] as const
export type Again = (typeof AGAIN)[number]['value']
export const NOTE_MAX = 500

export const againLabel = (again: string | null | undefined) => AGAIN.find(a => a.value === again)?.label ?? null

/** TRAK-367 (Kostas, 2 Nov): the plans the coach would run again first, the rest as they came. */
export function yesFirst<T extends { id: string }>(plans: T[], yes: (id: string) => boolean): T[] {
  return [...plans.filter(p => yes(p.id)), ...plans.filter(p => !yes(p.id))]
}

/** Past trainings with the words typed in their title, a practice's name or the note, newest first as given. */
export function searchPast<T extends { title: string; practices: { name: string }[]; note: string }>(past: T[], query: string): T[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return past
  return past.filter(p => {
    const text = [p.title, p.note, ...p.practices.map(x => x.name)].join(' ').toLocaleLowerCase()
    return words.every(word => text.includes(word))
  })
}
