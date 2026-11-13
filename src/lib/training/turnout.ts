import { i18n } from '@/lib/i18n'
import { fromShelf, libraryOf, type Part, type PlanDrill } from './parts'
import { shelfDrill, type Players, type ShelfDrill } from './shelf'
import { DETAILS, PLAYERS_TODAY, START_LEVEL, fit, type Details, type LibraryDrill } from './library'

/* TRAK-342 (Training redo 4/5, spec TRAK-338, 2 Nov prototype): Who's here. A plan is made for the whole squad; once
   the register is saved (Kostas, 2 Nov: suggestions only after attendance is confirmed, not per tap), Trak checks each
   part against how many came: the same set-up still works, it needs adjusting ("3 grids of 4 v 1"), or the drill
   doesn't work with that many and Trak offers a swap. Kept apart from the screens.
   TRAK-393 (Drill Library 8/11): a Library drill is fitted again with the Library's own fitting, for the players who
   came at the level the coach chose, so the advice matches the drill's page: each detail that changes, from what was
   planned to what fits now. A drill from an older plan keeps the advice above. */

/** How a drill takes its players: Trak's drills say so; one of the coach's says it in its own words (Write your own's
 *  "How many players?"). Null when nobody said. */
export function playersOf(drill: Pick<PlanDrill, 'source' | 'trak_drill' | 'players_kind' | 'group_size'>): Players | null {
  const shelf = drill.source === 'trak' ? shelfDrill(drill.trak_drill) : undefined
  if (shelf) return shelf.players
  switch (drill.players_kind) {
    case 'any': return { kind: 'any', min: 1 }
    case 'pairs': return { kind: 'pairs' }
    case 'teams': return { kind: 'teams', min: 6 }
    case 'groups': {
      const g = drill.group_size ?? 4
      return { kind: 'groups', g, lo: Math.max(2, g - 1), hi: g + 1, unit: 'group' }
    }
    default: return null
  }
}

export type Setup = { ok: true; text: string } | { ok: false }

/* TRAK-408: the set-up is said in the language showing (English as it was). A unit Trak has no word for keeps the old English. */
const plural = (unit: string, count: number) => count === 1 ? unit : unit.endsWith('ch') ? `${unit}es` : `${unit}s`
const UNITS = ['square', 'group', 'diamond', 'triangle', 'grid', 'area', 'wave', 'pitch']
const unitsOf = (unit: string, count: number, size: number) => UNITS.includes(unit)
  ? i18n.t(`coachTraining:unit_${unit}` as 'coachTraining:unit_group', { count, size }) : `${count} ${plural(unit, count)} of ${size}`
/** `n` players into `k` groups as evenly as can be: 15 into 3 is 5, 5, 5; 14 into 3 is 5, 5, 4. */
const split = (n: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0))

/** How a drill sets up for `n` players: "everyone together", "7 pairs and 1 group of 3", "7 v 7 + 1 floater",
 *  "3 grids of 5 · 4 v 1"; or not ok when it doesn't work with that many. */
export function setupFor(players: Players, n: number): Setup {
  if (players.kind === 'any') return n >= (players.min ?? 1) ? { ok: true, text: i18n.t('coachTraining:everyoneTogether') } : { ok: false }
  if (players.kind === 'pairs') {
    if (n < 2) return { ok: false }
    const pairs = (count: number) => i18n.t('coachTraining:pairs', { count })
    if (n % 2 === 0) return { ok: true, text: pairs(n / 2) }
    return { ok: true, text: n === 3 ? i18n.t('coachTraining:groupOf3') : i18n.t('coachTraining:pairsAndThree', { pairs: pairs((n - 3) / 2) }) }
  }
  if (players.kind === 'teams') {
    if (n < (players.min ?? 2)) return { ok: false }
    const side = Math.floor(n / 2)
    return { ok: true, text: i18n.t(n % 2 ? 'coachTraining:teamsFloater' : 'coachTraining:teams', { side }) }
  }
  const base = Math.max(1, Math.round(n / players.g))
  for (const k of [base, base - 1, base + 1]) {
    if (k < 1) continue
    const sizes = split(n, k)
    if (sizes.every(size => size >= players.lo && size <= players.hi)) {
      const counts = new Map<number, number>()
      for (const size of [...sizes].sort((a, b) => b - a)) counts.set(size, (counts.get(size) ?? 0) + 1)
      const text = [...counts].map(([size, count]) => {
        const label = players.labels?.[size]
        return `${unitsOf(players.unit, count, size)}${label ? ` (${label})` : ''}`
      }).join(i18n.t('coachSquad:fmAnd'))
      return { ok: true, text }
    }
  }
  return { ok: false }
}

export type Adaptation =
  | { status: 'same'; planned: Setup; now: Setup; message: string }
  | { status: 'adjust'; planned: Setup; now: { ok: true; text: string }; message: string
      /** TRAK-393: a Library drill's five details, fitted for those here. */
      details?: Details }
  | { status: 'swap'; planned: Setup; alt: ShelfDrill | null; now: Setup; message: string }
  | { status: 'unknown'; message: string }

/** TRAK-393: a Library drill fitted again for `here` players, at its level, against the details it was planned with.
 *  Library drills are drawn for 8 to 20 players: fewer than 8 and the coach picks another; more than 20 fit as 20. */
function refit(drill: PlanDrill, lib: LibraryDrill, here: number, squad: number): Adaptation {
  const planned: Setup = { ok: true, text: drill.numbers }
  if (here === squad) return { status: 'same', planned, now: planned, message: i18n.t('coachTraining:sameEveryone') }
  if (here < PLAYERS_TODAY.min) return { status: 'swap', planned, alt: null, now: { ok: false },
    message: i18n.t('coachTraining:setFor', { name: drill.name, min: PLAYERS_TODAY.min, max: PLAYERS_TODAY.max, here }) }
  const details = fit(lib, Math.min(PLAYERS_TODAY.max, here), drill.trak_level ?? START_LEVEL).details
  const changed = DETAILS.filter(({ key }) => details[key] !== drill[key])
  if (!changed.length) return { status: 'same', planned, now: planned, message: i18n.t('coachTraining:sameSetup') }
  return { status: 'adjust', planned, now: { ok: true, text: details.numbers }, details,
    message: changed.map(({ key }) => i18n.t('coachTraining:detailChange', { detail: i18n.t(`coachTraining:detail_${key}`), from: drill[key] || '—', to: details[key] })).join(' ') }
}

/** What a part needs with `here` players when it was planned for `squad`. */
export function adapt(drill: PlanDrill, here: number, squad: number): Adaptation {
  const lib = libraryOf(drill)
  if (lib) return refit(drill, lib, here, squad)
  const players = playersOf(drill)
  if (!players) return { status: 'unknown', message: i18n.t('coachTraining:unknownPlayers') }
  const planned = setupFor(players, squad)
  const now = setupFor(players, here)
  if (here === squad) return { status: 'same', planned, now, message: i18n.t('coachTraining:sameEveryone') }
  if (!now.ok) {
    const swapTo = drill.source === 'trak' ? shelfDrill(drill.trak_drill)?.swap : undefined
    const alt = swapTo ? shelfDrill(swapTo) ?? null : null
    const altNow = alt ? setupFor(alt.players, here) : null
    if (alt && altNow?.ok) return { status: 'swap', planned, alt, now: altNow, message: i18n.t('coachTraining:swapTo', { name: drill.name, here, alt: alt.name, text: altNow.text }) }
    return { status: 'swap', planned, alt: null, now: { ok: false }, message: i18n.t('coachTraining:pickAnother', { name: drill.name, here }) }
  }
  if (planned.ok && now.text === planned.text) {
    return { status: 'same', planned, now, message: players.kind === 'any' ? i18n.t('coachTraining:sameAny') : i18n.t('coachTraining:sameSetup') }
  }
  const smaller = players.kind === 'teams' && squad - here >= 3 ? i18n.t('coachTraining:smallerPitch') : ''
  return { status: 'adjust', planned, now, message: `${i18n.t('coachTraining:changeTo', { text: now.text })}${smaller}` }
}

/** A part with Trak's suggestion used: the new set-up goes in its Numbers (a Library drill takes all five fitted
 *  details, TRAK-393); a swap takes the other drill, same minutes. */
export function applySuggestion(part: Part, adaptation: Adaptation): Part {
  if (!part.drill) return part
  if (adaptation.status === 'adjust' && adaptation.details) return { ...part, drill: { ...part.drill, ...adaptation.details } }
  if (adaptation.status === 'adjust') return { ...part, drill: { ...part.drill, numbers: adaptation.now.text } }
  if (adaptation.status === 'swap' && adaptation.alt && adaptation.now.ok) {
    return { ...part, drill: { ...fromShelf(adaptation.alt), numbers: adaptation.now.text } }
  }
  return part
}
