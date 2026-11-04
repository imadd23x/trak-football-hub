import type { Json } from '@/integrations/supabase/types'
import { DRILL_LIMITS, blankDrill, type DrillDraft } from './sessions'
import { PART_TYPES, STANDARD, partInfo, playersShort, shelfDrill, SHELF, type PartType, type Players, type ShelfDrill } from './shelf'

/* TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): a plan is a list of parts. Each part has a name (the
   coach can rename it), one drill and its minutes. Kept apart from the screens. The limits are the database's
   (training_plan_practices); change both together. */

export const PARTS_MAX = 12
export const PART_NAME_MAX = 40
export const NOTE_MAX = 500

export type PlayersKind = Players['kind']
export type DrillSource = 'trak' | 'drill' | 'own' | 'library'

/** One drill in a plan: a copy, so changing a drill later never changes the plan. */
export type PlanDrill = DrillDraft & {
  source: DrillSource
  trak_drill: string | null
  drill_id: string | null
  library_session: string | null
  players_kind: PlayersKind | null
  group_size: number | null
}

export type Part = { key: string; type: PartType; name: string; minutes: number; drill: PlanDrill | null }

let seq = 0
export const newKey = () => `part-${Date.now().toString(36)}-${++seq}`

const blank = () => { const { minutes: _m, ...rest } = blankDrill(); return rest }

/** One of Trak's drills, as a plan's drill. */
export function fromShelf(drill: ShelfDrill): PlanDrill {
  return {
    ...blank(), minutes: 0, name: drill.name, how: drill.how, source: 'trak', trak_drill: drill.id, drill_id: null,
    library_session: null, players_kind: drill.players.kind, group_size: drill.players.kind === 'groups' ? drill.players.g : null,
  }
}

export type MyDrill = DrillDraft & { id: string; part_type: string | null; players_kind: string | null; group_size: number | null }

/** One of the coach's drills, as a plan's drill. */
export function fromMyDrill(drill: MyDrill): PlanDrill {
  const { id, part_type: _p, players_kind, group_size, ...draft } = drill
  return { ...draft, source: 'drill', trak_drill: null, drill_id: id, library_session: null,
    players_kind: (players_kind as PlayersKind | null) ?? null, group_size }
}

export type SavedPart = DrillDraft & {
  position: number; source: string; drill_id: string | null; library_session: string | null
  part?: string; part_type?: string | null; trak_drill?: string | null; players_kind?: string | null; group_size?: number | null
}

const knownType = (type: string | null | undefined): PartType =>
  type === 'own' || PART_TYPES.some(p => p.key === type) ? type as PartType : 'own'

/** A saved plan's practices as parts. A plan from before parts (TRAK-295) has none: each practice is its own part,
 *  named after it. */
export function partsFromSaved(practices: SavedPart[]): Part[] {
  return [...practices].sort((a, b) => a.position - b.position).map(p => ({
    key: newKey(),
    type: knownType(p.part_type),
    name: (p.part || p.name).slice(0, PART_NAME_MAX),
    minutes: p.minutes,
    drill: {
      name: p.name, minutes: 0, how: p.how, tell: p.tell, area: p.area, numbers: p.numbers, direction: p.direction,
      targets: p.targets, conditions: p.conditions,
      source: (['trak', 'drill', 'own', 'library'].includes(p.source) ? p.source : 'own') as DrillSource,
      trak_drill: p.trak_drill ?? null, drill_id: p.drill_id, library_session: p.library_session,
      players_kind: (p.players_kind as PlayersKind | null) ?? null, group_size: p.group_size ?? null,
    },
  }))
}

/** Why the plan can't be saved yet, or null. Every part needs a drill. */
export function planProblem(parts: Part[]): string | null {
  if (!parts.length) return 'Add a part first.'
  if (parts.length > PARTS_MAX) return `A plan holds at most ${PARTS_MAX} parts.`
  const empty = parts.find(p => !p.drill)
  return empty ? `Pick a drill for ${empty.name}, or remove the part.` : null
}

/** What save_training_plan() takes: one practice per part, in order. */
export function toSave(parts: Part[]): Json {
  return parts.flatMap(part => part.drill ? [{
    name: part.drill.name.trim().slice(0, DRILL_LIMITS.name), minutes: part.minutes, how: part.drill.how.trim(), tell: part.drill.tell.trim(),
    area: part.drill.area, numbers: part.drill.numbers, direction: part.drill.direction, targets: part.drill.targets,
    conditions: part.drill.conditions, source: part.drill.source, drill_id: part.drill.drill_id,
    library_session: part.drill.library_session, trak_drill: part.drill.trak_drill, part: part.name.trim(), part_type: part.type,
    players_kind: part.drill.players_kind, group_size: part.drill.group_size, save_to_drills: false,
  }] : [])
}

/* ── What the coach has used ──────────────────────────────────────────────── */

/** A drill's key across plans: one of Trak's, or one of the coach's. Written in a plan only, it has none. */
export const drillKey = (d: Pick<PlanDrill, 'source' | 'trak_drill' | 'drill_id'>) =>
  d.source === 'trak' && d.trak_drill ? `trak:${d.trak_drill}` : d.drill_id ? `drill:${d.drill_id}` : null

export type PastPlan = { day: string; practices: SavedPart[] }
export type Usage = { plans: number; byDrill: Map<string, { count: number; last: string; at: number }> }

/** How often each drill was used in the coach's last `max` plans (newest first), and when it was last. */
export function usageOf(past: PastPlan[], max = 8): Usage {
  const recent = past.slice(0, max)
  const byDrill: Usage['byDrill'] = new Map()
  recent.forEach((plan, at) => {
    const keys = new Set(plan.practices.map(p => drillKey({ source: p.source as DrillSource, trak_drill: p.trak_drill ?? null, drill_id: p.drill_id })))
    for (const key of keys) {
      if (!key) continue
      const seen = byDrill.get(key)
      byDrill.set(key, seen ? { ...seen, count: seen.count + 1 } : { count: 1, last: plan.day, at })
    }
  })
  return { plans: recent.length, byDrill }
}

/** The drills that fit a part: Trak's for its type and the coach's own for it; a part of the coach's own takes any. */
export function candidates(type: PartType, mine: MyDrill[]): PlanDrill[] {
  const shelf = type === 'own' ? SHELF : SHELF.filter(d => d.part === type)
  const own = type === 'own' ? mine : mine.filter(d => d.part_type === type)
  return [...own.map(fromMyDrill), ...shelf.map(fromShelf)]
}

const used = (usage: Usage, d: PlanDrill) => { const key = drillKey(d); return key ? usage.byDrill.get(key) : undefined }

/** The part's usual drill: the one used most in the last plans (the latest on a tie), else Trak's first. None for a part
 *  of the coach's own. */
export function usualFor(type: PartType, all: PlanDrill[], usage: Usage): PlanDrill | null {
  if (type === 'own') return null
  let best: PlanDrill | null = null
  for (const d of all) {
    const u = used(usage, d), b = best ? used(usage, best) : undefined
    if (u && (!b || u.count > b.count || (u.count === b.count && u.at < b.at))) best = d
  }
  return best ?? all.find(d => d.source === 'trak') ?? all[0] ?? null
}

/** The same drill: by its key when both have one; otherwise by name, so a drill written in a plan before it was saved
 *  to My drills (or a plan from before parts) doesn't show twice. */
const same = (a: PlanDrill | null, b: PlanDrill | null) => {
  if (!a || !b) return false
  const ka = drillKey(a), kb = drillKey(b)
  return ka && kb ? ka === kb : a.name.trim().toLocaleLowerCase() === b.name.trim().toLocaleLowerCase()
}

/** The three drills a part shows: its usual, then those used lately, then the rest; the picked one is always there. */
export function shownFor(type: PartType, picked: PlanDrill | null, all: PlanDrill[], usage: Usage): PlanDrill[] {
  const usual = usualFor(type, all, usage)
  const rest = all.filter(d => !same(d, usual))
  const lately = rest.filter(d => used(usage, d)).sort((a, b) => used(usage, a)!.at - used(usage, b)!.at)
  const others = rest.filter(d => !used(usage, d))
  const three = [...(usual ? [usual] : []), ...lately, ...others].slice(0, 3)
  if (!picked || three.some(d => same(d, picked))) return three
  return three.length >= 3 ? [three[0], three[1], picked] : [...three, picked]
}

/** The tag on a drill: "Your usual · 5 of your last 8", "Last used Mon 26 Oct", "My drill", "Trak drill", "Only in
 *  this plan". */
export function tagFor(d: PlanDrill, type: PartType, all: PlanDrill[], usage: Usage): string {
  const u = used(usage, d)
  if (u && same(usualFor(type, all, usage), d)) return `Your usual · ${u.count} of your last ${usage.plans}`
  if (u) return `Last used ${u.last}`
  if (d.source === 'drill') return 'My drill'
  if (d.source === 'trak') return 'Trak drill'
  if (d.source === 'library') return 'Library'
  return 'Only in this plan'
}

export const isSameDrill = same

/* ── Shapes ───────────────────────────────────────────────────────────────── */

export type Shape = { type: PartType; name: string; minutes: number }[]

/** The parts of the coach's last plan with parts (Kostas, 2 Nov: "your usual shape"), or null. Plans from before parts
 *  don't count. */
export function lastShape(past: PastPlan[]): Shape | null {
  const plan = past.find(p => p.practices.some(x => x.part))
  return plan ? partsFromSaved(plan.practices).map(({ type, name, minutes }) => ({ type, name, minutes })) : null
}

export const standardShape = (): Shape => STANDARD.map(type => ({ type, name: partInfo(type).name, minutes: partInfo(type).mins }))

/** A new plan from a shape: each part with its usual drill picked. */
export function partsFromShape(shape: Shape, mine: MyDrill[], usage: Usage): Part[] {
  return shape.map(s => ({ key: newKey(), ...s, drill: usualFor(s.type, candidates(s.type, mine), usage) }))
}

export const isStandard = (parts: Pick<Part, 'type' | 'name'>[]) => parts.length === STANDARD.length
  && parts.every((p, i) => p.type === STANDARD[i] && p.name === partInfo(p.type).name)

export const totalMinutes = (parts: Pick<Part, 'minutes'>[]) => parts.reduce((sum, p) => sum + p.minutes, 0)

/** Kostas, 30 Oct: time is soft. "Fits your 90 minutes.", "10 min spare.", "5 min over. That's fine, it's only a guide." */
export function fitLine(total: number, length: number | null): string | null {
  if (!length) return null
  const diff = total - length
  return diff === 0 ? `Fits your ${length} minutes.` : diff > 0 ? `${diff} min over. That’s fine, it’s only a guide.` : `${-diff} min spare.`
}

/** The minute choices for a part: its type's, plus whatever it's set to. */
export function minuteOptions(type: PartType, minutes: number): number[] {
  const options: number[] = [...partInfo(type).options]
  return options.includes(minutes) ? options : [...options, minutes].sort((a, b) => a - b)
}

/** The list with one item moved from `from` to `to`. */
/** What every drill says. */
export type DrillAnswers = { name: string; how: string; kind: PlayersKind | null; size: number }

export const blankAnswers = (): DrillAnswers => ({ name: '', how: '', kind: null, size: 4 })

export function answerProblems({ name, how, kind }: DrillAnswers): Record<string, string> {
  const found: Record<string, string> = {}
  if (!name.trim()) found.name = 'Give the drill a name.'
  if (!how.trim()) found.how = 'Say what the players do.'
  if (!kind) found.kind = 'Say how many players it takes.'
  return found
}

/** What makes two rows the same part, whatever their keys. */
const sameRow = (p: Part) => JSON.stringify([p.type, p.name, p.minutes, p.drill?.name ?? null])

/** TRAK-367: the parts in the same order, by what they are, not their keys. */
export const sameOrder = (a: Part[], b: Part[]) => a.length === b.length && a.every((p, i) => sameRow(p) === sameRow(b[i]))

/** TRAK-367: a saved plan read again: each part keeps the key it had, so a part just moved stays the same row on screen
 *  (and keeps the keyboard's focus). */
export function keepKeys(before: Part[], after: Part[]): Part[] {
  const free = [...before]
  return after.map(part => {
    const at = free.findIndex(p => sameRow(p) === sameRow(part))
    return at < 0 ? part : { ...part, key: free.splice(at, 1)[0].key }
  })
}

export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** How a drill takes its players, in a few words: "In pairs", "Groups of 6 · 4 v 2". */
export function playersLine(drill: Pick<PlanDrill, 'source' | 'trak_drill' | 'players_kind' | 'group_size'>): string | null {
  const shelf = drill.source === 'trak' ? shelfDrill(drill.trak_drill) : undefined
  if (shelf) return playersShort(shelf.players)
  if (drill.players_kind === 'groups') return drill.group_size ? `Groups of ${drill.group_size}` : 'In groups'
  return drill.players_kind ? playersShort({ kind: drill.players_kind } as Players) : null
}

/** Each part's colour: one green, darkest first, lighter down the session. */
export function partColour(index: number, count: number): string {
  const alpha = count <= 1 ? 1 : 1 - (index / (count - 1)) * 0.65
  return `rgb(var(--t-brand) / ${alpha.toFixed(2)})`
}


/** "1 · Rondo" over the drill's name; a plan from before parts names its part after its drill, so just "1" then. */
export const partLine = (part: Part, index: number) => part.drill && part.name === part.drill.name ? `${index + 1}` : `${index + 1} · ${part.name}`
