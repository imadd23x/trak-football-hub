/* TRAK-355 (Season plan 7/18, spec TRAK-348): watch first. Instead of setting a player up now, the coach watches them,
   and Trak brings them back to Needs you by the squad's rule: after 1, 2 or 4 weeks, or after 2 or 4 trainings the
   player attended (from the register); whatever the rule, after 28 days at the latest. Days are the academy's own,
   in its time zone. A cancelled training has no register, so it never counts. Nothing goes out while watching. */

export type WatchRule = 'w1' | 'w2' | 'w4' | 't2' | 't4'
export const WATCH_RULES: { value: WatchRule; label: string }[] = [
  { value: 'w1', label: '1 week' }, { value: 'w2', label: '2 weeks' }, { value: 'w4', label: '4 weeks' },
  { value: 't2', label: '2 trainings' }, { value: 't4', label: '4 trainings' },
]
export const DEFAULT_WATCH_RULE: WatchRule = 't2'
export const SAFETY_NET_DAYS = 28

export const isWatchRule = (value: string | null | undefined): value is WatchRule => WATCH_RULES.some(r => r.value === value)
/** "after 2 trainings" */
export const ruleText = (rule: WatchRule) => `after ${WATCH_RULES.find(r => r.value === rule)!.label}`

/** A session from the register: its day, whether it was a training, and whether this player was there. */
export type RegisterSession = { date: string; type: string; present: boolean }

/** The academy's calendar day for an instant, as YYYY-MM-DD. */
export function dayIn(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function watchState({ since, rule, timeZone, sessions, now }: {
  since: string
  rule: WatchRule
  timeZone: string
  sessions: RegisterSession[]
  now: Date
}): { ready: boolean; why: string | null; progress: string } {
  const start = dayIn(timeZone, new Date(since))
  const days = dayNumber(dayIn(timeZone, now)) - dayNumber(start)
  const n = Number(rule.slice(1))
  const byTrainings = rule.startsWith('t')
  // Trainings after the day the watch began, that the player was at.
  const went = sessions.filter(s => s.type === 'training' && s.present && s.date > start).length
  const hit = byTrainings ? went >= n : days >= n * 7
  const net = days >= SAFETY_NET_DAYS
  return {
    ready: hit || net,
    why: hit ? `Watched ${plural(n, byTrainings ? 'training' : 'week')}` : net ? '4 weeks, the latest' : null,
    progress: byTrainings ? `${Math.min(went, n)} of ${plural(n, 'training')} so far` : `${Math.min(Math.floor(days / 7), n)} of ${plural(n, 'week')} so far`,
  }
}
