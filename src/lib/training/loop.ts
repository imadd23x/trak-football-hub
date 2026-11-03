/* TRAK-298 (Training 5/5, spec TRAK-293): every training's loop and where one is. Each
   step comes from what already exists, so nothing new is stored: a saved plan, a register taken (the event's
   completed session, TRAK-138), and the clock. Kostas, 28 Oct: Close is automatic: a training is closed once it has
   ended and its register is taken. TRAK-309 (Kostas, 29 Oct): no Run it step; it asked nothing of the coach and only
   waited for the end, as Close does. The plan at the pitch side is View. */

export const LOOP_STEPS = ['Logistics', 'Plan', 'Who’s here', 'Notes'] as const

export type LoopFacts = {
  planned: boolean
  /** The register is taken: the training has its completed session. */
  registered: boolean
  /** TRAK-339: the coach answered Notes, or skipped them. */
  noted?: boolean
  started: boolean
  /** Over: its end, or as trainingEnd() reads it. */
  over: boolean
}

export type LoopState = {
  /** Each step, done or not. Logistics comes from the schedule, so it is always done. */
  done: [boolean, boolean, boolean, boolean]
  /** The first step not done; 4 when every step is. */
  at: number
  /** Ended with its register taken, or its Notes answered or skipped. */
  closed: boolean
}

/* TRAK-339 (Training redo 1/5, spec TRAK-338, 2 Nov prototype): the loop is Logistics (from the schedule) → Plan → Who's
   here → Notes (optional, after the training). Kostas's rule of 28 Oct still closes a training: ended with its
   register taken; skipping or saving Notes closes it too. */
export function loopState({ planned, registered, noted = false, over }: LoopFacts): LoopState {
  const closed = over && (registered || noted)
  const done: LoopState['done'] = [true, planned, registered, noted]
  const at = done.indexOf(false)
  return { done, at: at < 0 ? 4 : at, closed }
}

/** What the current step says beside its name. The plan is written before, so it is always "now"; Who's here is
 *  "now" once the training has started, else "next"; Notes are optional. */
export function loopNote(state: LoopState, started: boolean): string {
  if (state.at === 3) return 'optional'
  return state.at === 1 || (state.at === 2 && started) ? 'now' : 'next'
}

/** "18:00" plus minutes, on a 24-hour clock: when each practice starts in View. */
export function clockPlus(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** When each practice starts, from the training's start: [18:00, 18:15, 18:40…]. Null when it has no time. */
export function practiceStarts(start: string | null, practices: { minutes: number }[]): (string | null)[] {
  let offset = 0
  return practices.map(practice => {
    const at = start ? clockPlus(start, offset) : null
    offset += practice.minutes
    return at
  })
}
