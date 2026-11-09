/* TRAK-365 (Season plan 17/18, spec TRAK-348): objectives in the evaluation. Each open objective of an evaluated player
   gets Not yet, Some progress or On track; Met closes it. Home groups the players by their worst open objective's latest
   status, worst first, with the way it moved since the evaluation before. The database says who is stuck (three Not yets
   in a row, stuck_player_objectives()); this file only groups what has been published. */

export type Progress = 'not_yet' | 'some_progress' | 'on_track' | 'met'
export const PROGRESS_OPTIONS: { value: Progress; label: string }[] = [
  { value: 'not_yet', label: 'Not yet' }, { value: 'some_progress', label: 'Some progress' },
  { value: 'on_track', label: 'On track' }, { value: 'met', label: 'Met' },
]
export const progressLabel = (status: Progress | 'unrated') => status === 'unrated' ? 'Not rated yet' : PROGRESS_OPTIONS.find(o => o.value === status)!.label
export const isProgress = (value: unknown): value is Progress => PROGRESS_OPTIONS.some(o => o.value === value)

/** A published status of one objective, on the date of the evaluation that gave it. */
export type ProgressRow = { objectiveId: string; status: Progress; dueOn: string }

/** Each objective's latest status and the one before it (null for the first). */
export function latestProgress(rows: ProgressRow[]): Map<string, { now: Progress; before: Progress | null }> {
  const byObjective = new Map<string, ProgressRow[]>()
  for (const row of rows) byObjective.set(row.objectiveId, [...(byObjective.get(row.objectiveId) ?? []), row])
  return new Map([...byObjective].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => b.dueOn.localeCompare(a.dueOn))
    return [id, { now: sorted[0].status, before: sorted[1]?.status ?? null }]
  }))
}

/** Worst first. Met never counts: a met objective is closed. */
const RANK: Record<Exclude<Progress, 'met'>, number> = { not_yet: 0, some_progress: 1, on_track: 2 }
export type PlayerProgress = { status: Exclude<Progress, 'met'> | 'unrated'; trend: -1 | 0 | 1 | null }

/** A player's status is their worst open objective's latest; the trend is how that worst moved since the evaluation
 *  before (1 better, -1 worse, 0 the same, null when there was no evaluation before). An objective with no status yet
 *  makes the player "unrated" unless another has one. */
export function playerProgress(openIds: string[], latest: Map<string, { now: Progress; before: Progress | null }>): PlayerProgress {
  const nows = openIds.flatMap(id => { const l = latest.get(id); return l && l.now !== 'met' ? [RANK[l.now]] : [] })
  if (nows.length === 0) return { status: 'unrated', trend: null }
  const worst = Math.min(...nows)
  const befores = openIds.flatMap(id => { const l = latest.get(id); return l?.before && l.before !== 'met' ? [RANK[l.before]] : [] })
  const status = (Object.keys(RANK) as (keyof typeof RANK)[]).find(k => RANK[k] === worst)!
  return { status, trend: befores.length === 0 ? null : Math.sign(worst - Math.min(...befores)) as -1 | 0 | 1 }
}

export const STATUS_ORDER: PlayerProgress['status'][] = ['not_yet', 'some_progress', 'on_track', 'unrated']

/** What the evaluation sends for one player: how each open objective is going, and the coach's own new ones. */
export type ObjectivesEntry = { progress: Record<string, Progress>; add: string[] }
export const emptyObjectives = (): ObjectivesEntry => ({ progress: {}, add: [] })

/** The objectives still open after Met and adds, and so whether another can be added (a player keeps two at most). */
export function openAfter(open: { id: string }[], entry: ObjectivesEntry): number {
  return open.filter(o => entry.progress[o.id] !== 'met').length + entry.add.length
}

/** Whether every open objective has a status: the evaluation won't go without. */
export const allRated = (open: { id: string }[], entry: ObjectivesEntry) => open.every(o => !!entry.progress[o.id])

/** One player's added objective, as one trimmed line, or null when it's empty, too long, or already on their list. */
export function cleanAddition(text: string, taken: string[], max = 120): string | null {
  const title = text.trim().replace(/\s+/g, ' ')
  if (!title || title.length > max || taken.some(t => t.toLowerCase() === title.toLowerCase())) return null
  return title
}

/** What publish_evaluation_with_objectives() is sent: only players who have objectives, or add one. */
export function toObjectivesPayload(players: string[], open: (id: string) => { id: string }[], entries: Record<string, ObjectivesEntry>) {
  return players.flatMap(id => {
    const entry = entries[id] ?? emptyObjectives()
    const list = open(id)
    if (list.length === 0 && entry.add.length === 0) return []
    return [{ squad_player_id: id, progress: list.map(o => ({ player_objective_id: o.id, status: entry.progress[o.id] })), add: entry.add }]
  })
}
