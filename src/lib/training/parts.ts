import { partName } from './words'
import { i18n } from '@/lib/i18n'
import type { Json } from '@/integrations/supabase/types'
import { DRILL_LIMITS, blankDrill, type DrillDraft } from './sessions'
import { PART_TYPES, STANDARD, partInfo, playersShort, shelfDrill, type PartType, type Players, type ShelfDrill } from './shelf'
import { LEVELS, LIBRARY, START_LEVEL, drillOrder, fit, libraryDrill, partFor, playersFor, type LibraryDrill } from './library'

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
  /** TRAK-391: a Library drill's level (0 easiest), as the coach set it on its page. Drafts from before it have none. */
  trak_level?: number | null
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
    trak_level: null,
  }
}

const clip = (text: string, max: number) => text.trim().slice(0, max)

/** TRAK-391: a Library drill as a plan's drill, fitted to the players and level the coach set on its page. The five
 *  details are the fitted ones in words, so View and Home's Today card show the drill as the coach saw it. */
export function fromLibrary(drill: LibraryDrill, players: number, level: number): PlanDrill {
  const at = Math.min(LEVELS - 1, Math.max(0, Math.round(level)))
  const { details } = fit(drill, players, at)
  const takes = playersFor(drill)
  const detail = (text: string) => clip(text, DRILL_LIMITS.detail)
  return {
    name: clip(drill.name, DRILL_LIMITS.name), minutes: 0, how: clip(drill.how.join('\n'), DRILL_LIMITS.how),
    tell: clip(drill.watch.join('\n'), DRILL_LIMITS.tell), area: detail(details.area), numbers: detail(details.numbers),
    direction: detail(details.direction), targets: detail(details.targets), conditions: detail(details.conditions),
    source: 'trak', trak_drill: drill.id, drill_id: null, library_session: null, players_kind: takes.kind,
    group_size: takes.kind === 'groups' ? takes.g : null, trak_level: at,
  }
}

/** TRAK-391: the part a Library drill joins a plan as: its kind's part, with that part's usual minutes. */
export function libraryPart(drill: LibraryDrill, players: number, level: number): Part {
  const type = partFor(drill)
  return { key: newKey(), type, name: partInfo(type).name, minutes: partInfo(type).mins, drill: fromLibrary(drill, players, level) }
}

/** TRAK-392: the Library drill a plan's drill is, or undefined (a drill from an older plan: Trak's old shelf, the
 *  coach's own, the FA Library). */
export const libraryOf = (d: Pick<PlanDrill, 'source' | 'trak_drill'> | null | undefined): LibraryDrill | undefined =>
  d?.source === 'trak' ? libraryDrill(d.trak_drill ?? undefined) : undefined

export type SavedPart = DrillDraft & {
  position: number; source: string; drill_id: string | null; library_session: string | null
  part?: string; part_type?: string | null; trak_drill?: string | null; players_kind?: string | null; group_size?: number | null
  trak_level?: number | null
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
      players_kind: (p.players_kind as PlayersKind | null) ?? null, group_size: p.group_size ?? null, trak_level: p.trak_level ?? null,
    },
  }))
}

/** Why the plan can't be saved yet, or null. Every part needs a drill. */
export function planProblem(parts: Part[]): string | null {
  if (!parts.length) return i18n.t('coachTraining:addPartFirst')
  if (parts.length > PARTS_MAX) return i18n.t('coachTraining:planMax', { max: PARTS_MAX })
  const empty = parts.find(p => !p.drill)
  return empty ? i18n.t('coachTraining:pickDrillFor', { part: partName(empty.name) }) : null
}

/** What save_training_plan() takes: one practice per part, in order. */
export function toSave(parts: Part[]): Json {
  return parts.flatMap(part => part.drill ? [{
    name: part.drill.name.trim().slice(0, DRILL_LIMITS.name), minutes: part.minutes, how: part.drill.how.trim(), tell: part.drill.tell.trim(),
    area: part.drill.area, numbers: part.drill.numbers, direction: part.drill.direction, targets: part.drill.targets,
    conditions: part.drill.conditions, source: part.drill.source, drill_id: part.drill.drill_id,
    library_session: part.drill.library_session, trak_drill: part.drill.trak_drill, part: part.name.trim(), part_type: part.type,
    players_kind: part.drill.players_kind, group_size: part.drill.group_size, trak_level: part.drill.trak_level ?? null,
    save_to_drills: false,
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

/** TRAK-392: whether a part has Library drills of its own. Trak's five do; a part the coach named, and Set pieces,
 *  Finishing and Cool-down (no Library drills for them yet), pick from every drill and have no usual. */
export const hasOwnDrills = (type: PartType) => type !== 'own' && LIBRARY.some(d => partFor(d) === type)

/** TRAK-392: the Library drills a part offers, in the Library's order (by kind, then drill type, team drills before
 *  individual and keeper ones). */
export function libraryFor(type: PartType): LibraryDrill[] {
  const drills = hasOwnDrills(type) ? LIBRARY.filter(d => partFor(d) === type) : [...LIBRARY]
  return drills.sort((a, b) => drillOrder(a) - drillOrder(b))
}

/** The drills that fit a part, from the Library (TRAK-392; was Trak's shelf and the coach's own), fitted to the squad
 *  at the standard level. */
export function candidates(type: PartType, players: number): PlanDrill[] {
  return libraryFor(type).map(d => fromLibrary(d, players, START_LEVEL))
}

const forTeam = (d: PlanDrill) => libraryOf(d)?.focus === 'team'

const used = (usage: Usage, d: PlanDrill) => { const key = drillKey(d); return key ? usage.byDrill.get(key) : undefined }

/** The part's usual drill: the one used most in the last plans (the latest on a tie), else the starter drill (the
 *  part's first team drill). None for a part that picks from every drill. */
export function usualFor(type: PartType, all: PlanDrill[], usage: Usage): PlanDrill | null {
  if (!hasOwnDrills(type)) return null
  let best: PlanDrill | null = null
  for (const d of all) {
    const u = used(usage, d), b = best ? used(usage, best) : undefined
    if (u && (!b || u.count > b.count || (u.count === b.count && u.at < b.at))) best = d
  }
  return best ?? all.find(forTeam) ?? all[0] ?? null
}

/** The same drill: by its key when both have one; otherwise by name, so a drill written in a plan before it was saved
 *  to My drills (or a plan from before parts) doesn't show twice. */
const same = (a: PlanDrill | null, b: PlanDrill | null) => {
  if (!a || !b) return false
  const ka = drillKey(a), kb = drillKey(b)
  return ka && kb ? ka === kb : a.name.trim().toLocaleLowerCase() === b.name.trim().toLocaleLowerCase()
}

/** The three drills a part shows: its usual, then those used lately, then the rest, team drills only (the mockup);
 *  the picked one is always there. */
export function shownFor(type: PartType, picked: PlanDrill | null, all: PlanDrill[], usage: Usage): PlanDrill[] {
  const usual = usualFor(type, all, usage)
  const rest = all.filter(d => !same(d, usual) && (forTeam(d) || !!used(usage, d)))
  const lately = rest.filter(d => used(usage, d)).sort((a, b) => used(usage, a)!.at - used(usage, b)!.at)
  const others = rest.filter(d => !used(usage, d))
  const three = [...(usual ? [usual] : []), ...lately, ...others].slice(0, 3)
  if (!picked || three.some(d => same(d, picked))) return three
  return three.length >= 3 ? [three[0], three[1], picked] : [...three, picked]
}

/** The tag on a drill: "Your usual · 5 of your last 8", "Last used Mon 26 Oct", "Starter drill", "In My drills" (a
 *  bookmark, TRAK-390), or none; a drill from an older plan says what it was: "Trak drill", "My drill", "Library",
 *  "Only in this plan". */
export function tagFor(d: PlanDrill, type: PartType, all: PlanDrill[], usage: Usage, bookmarks: readonly string[] = []): string {
  const u = used(usage, d)
  // TRAK-408: in the language showing (English as it was).
  if (u && same(usualFor(type, all, usage), d)) return i18n.t('coachTraining:tagUsual', { count: u.count, plans: usage.plans })
  if (u) return i18n.t('coachTraining:tagLastUsed', { day: u.last })
  const lib = libraryOf(d)
  if (lib) return same(usualFor(type, all, usage), d) ? i18n.t('coachTraining:tagStarter') : bookmarks.includes(lib.id) ? i18n.t('coachTraining:tagInMyDrills') : ''
  if (d.source === 'drill') return i18n.t('coachTraining:tagMyDrill')
  if (d.source === 'trak') return i18n.t('coachTraining:tagTrakDrill')
  if (d.source === 'library') return i18n.t('coachTraining:tagLibrary')
  return i18n.t('coachTraining:tagOnlyHere')
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

/** A new plan from a shape: each part with its usual drill picked, fitted to the squad. */
export function partsFromShape(shape: Shape, players: number, usage: Usage): Part[] {
  return shape.map(s => ({ key: newKey(), ...s, drill: usualFor(s.type, candidates(s.type, players), usage) }))
}

export const isStandard = (parts: Pick<Part, 'type' | 'name'>[]) => parts.length === STANDARD.length
  && parts.every((p, i) => p.type === STANDARD[i] && p.name === partInfo(p.type).name)

export const totalMinutes = (parts: Pick<Part, 'minutes'>[]) => parts.reduce((sum, p) => sum + p.minutes, 0)

/** Kostas, 30 Oct: time is soft. "Fits your 90 minutes.", "10 min spare.", "5 min over. That's fine, it's only a guide." */
export function fitLine(total: number, length: number | null): string | null {
  if (!length) return null
  const diff = total - length
  return diff === 0 ? i18n.t('coachTraining:fitsMinutes', { length }) : diff > 0 ? i18n.t('coachTraining:minOver', { diff }) : i18n.t('coachTraining:minSpare', { diff: -diff })
}

/** The minute choices for a part: its type's, plus whatever it's set to. */
export function minuteOptions(type: PartType, minutes: number): number[] {
  const options: number[] = [...partInfo(type).options]
  return options.includes(minutes) ? options : [...options, minutes].sort((a, b) => a - b)
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

/** The list with one item moved from `from` to `to`. */
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
  if (drill.players_kind === 'groups') return drill.group_size ? i18n.t('coachTraining:groupsOf', { g: drill.group_size }) : i18n.t('coachTraining:inGroups')
  return drill.players_kind ? playersShort({ kind: drill.players_kind } as Players) : null
}

/** Each part's colour: one green, darkest first, lighter down the session. */
export function partColour(index: number, count: number): string {
  const alpha = count <= 1 ? 1 : 1 - (index / (count - 1)) * 0.65
  return `rgb(var(--t-brand) / ${alpha.toFixed(2)})`
}


/** "1 · Rondo" over the drill's name; a plan from before parts names its part after its drill, so just "1" then. */
export const partLine = (part: Part, index: number) => part.drill && part.name === part.drill.name ? `${index + 1}` : `${index + 1} · ${partName(part.name)}`
