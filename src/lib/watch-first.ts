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

export type WatchedPlayer = { playerId: string; name: string; since: string; ready: boolean; why: string | null; progress: string; step: 'positions' | 'objectives' }

/** Every watched player without objectives (one with objectives is set up), with whether they're due and where the
 *  coach sets them up: Positions while they have none, else Player objectives. Oldest watch first. */
export function watchedPlayers({ players, watches, objectives, sessions, rule, timeZone, now }: {
  players: { id: string; player_name: string; position: string | null }[]
  watches: { squad_player_id: string; since: string }[]
  /** Players with an open objective. */
  objectives: Set<string>
  /** Each player's register, by player. */
  sessions: Record<string, RegisterSession[]>
  rule: WatchRule
  timeZone: string
  now: Date
}): WatchedPlayer[] {
  const byId = new Map(players.map(p => [p.id, p]))
  return watches
    .filter(w => byId.has(w.squad_player_id) && !objectives.has(w.squad_player_id))
    .sort((a, b) => a.since.localeCompare(b.since))
    .map(w => {
      const player = byId.get(w.squad_player_id)!
      const state = watchState({ since: w.since, rule, timeZone, sessions: sessions[player.id] ?? [], now })
      return { playerId: player.id, name: player.player_name, since: w.since, ...state, step: player.position ? 'objectives' : 'positions' }
    })
}

/** The rule a squad's watches follow. A squad without trainings in Trak would never see a reminder by trainings, so
 *  it follows weeks: "after 2 weeks" in place of a trainings rule (Tarek, 6 Nov). */
export const effectiveRule = (rule: WatchRule, hasTrainings: boolean): WatchRule => (hasTrainings || rule.startsWith('w') ? rule : 'w2')
/** The rules a squad is offered: all five, or the weeks alone without trainings. */
export const rulesFor = (hasTrainings: boolean) => WATCH_RULES.filter(r => hasTrainings || r.value.startsWith('w'))
