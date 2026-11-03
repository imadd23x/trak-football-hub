import { fromShelf, type Part, type PlanDrill } from './parts'
import { shelfDrill, type Players, type ShelfDrill } from './shelf'

/* TRAK-342 (Training redo 4/5, spec TRAK-338, 2 Nov prototype): Who's here. A plan is made for the whole squad; once
   the register is saved (Kostas, 2 Nov: suggestions only after attendance is confirmed, not per tap), Trak checks each
   part against how many came: the same set-up still works, it needs adjusting ("3 grids of 4 v 1"), or the drill
   doesn't work with that many and Trak offers a swap. Kept apart from the screens. */

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

const plural = (unit: string, count: number) => count === 1 ? unit : unit.endsWith('ch') ? `${unit}es` : `${unit}s`
/** `n` players into `k` groups as evenly as can be: 15 into 3 is 5, 5, 5; 14 into 3 is 5, 5, 4. */
const split = (n: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0))

/** How a drill sets up for `n` players: "everyone together", "7 pairs and 1 group of 3", "7 v 7 + 1 floater",
 *  "3 grids of 5 · 4 v 1"; or not ok when it doesn't work with that many. */
export function setupFor(players: Players, n: number): Setup {
  if (players.kind === 'any') return n >= (players.min ?? 1) ? { ok: true, text: 'everyone together' } : { ok: false }
  if (players.kind === 'pairs') {
    if (n < 2) return { ok: false }
    const pairs = (count: number) => `${count} ${count === 1 ? 'pair' : 'pairs'}`
    if (n % 2 === 0) return { ok: true, text: pairs(n / 2) }
    return { ok: true, text: n === 3 ? '1 group of 3' : `${pairs((n - 3) / 2)} and 1 group of 3` }
  }
  if (players.kind === 'teams') {
    if (n < (players.min ?? 2)) return { ok: false }
    const side = Math.floor(n / 2)
    return { ok: true, text: n % 2 ? `${side} v ${side} + 1 floater` : `${side} v ${side}` }
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
        return `${count} ${plural(players.unit, count)} of ${size}${label ? ` (${label})` : ''}`
      }).join(' and ')
      return { ok: true, text }
    }
  }
  return { ok: false }
}

export type Adaptation =
  | { status: 'same'; planned: Setup; now: Setup; message: string }
  | { status: 'adjust'; planned: Setup; now: { ok: true; text: string }; message: string }
  | { status: 'swap'; planned: Setup; alt: ShelfDrill | null; now: Setup; message: string }
  | { status: 'unknown'; message: string }

/** What a part needs with `here` players when it was planned for `squad`. */
export function adapt(drill: PlanDrill, here: number, squad: number): Adaptation {
  const players = playersOf(drill)
  if (!players) return { status: 'unknown', message: 'Trak doesn’t know how many players this drill takes. Check it yourself.' }
  const planned = setupFor(players, squad)
  const now = setupFor(players, here)
  if (here === squad) return { status: 'same', planned, now, message: 'Everyone’s here. No change.' }
  if (!now.ok) {
    const swapTo = drill.source === 'trak' ? shelfDrill(drill.trak_drill)?.swap : undefined
    const alt = swapTo ? shelfDrill(swapTo) ?? null : null
    const altNow = alt ? setupFor(alt.players, here) : null
    if (alt && altNow?.ok) return { status: 'swap', planned, alt, now: altNow, message: `${drill.name} doesn’t work well with ${here}. Swap to ${alt.name}: ${altNow.text}.` }
    return { status: 'swap', planned, alt: null, now: { ok: false }, message: `${drill.name} doesn’t work well with ${here}. Pick another drill.` }
  }
  if (planned.ok && now.text === planned.text) {
    return { status: 'same', planned, now, message: players.kind === 'any' ? 'Works with any number. No change.' : 'The same set-up still works.' }
  }
  const smaller = players.kind === 'teams' && squad - here >= 3 ? ' Make the pitch a little smaller.' : ''
  return { status: 'adjust', planned, now, message: `Change to ${now.text}.${smaller}` }
}

/** A part with Trak's suggestion used: the new set-up goes in its Numbers; a swap takes the other drill, same minutes. */
export function applySuggestion(part: Part, adaptation: Adaptation): Part {
  if (!part.drill) return part
  if (adaptation.status === 'adjust') return { ...part, drill: { ...part.drill, numbers: adaptation.now.text } }
  if (adaptation.status === 'swap' && adaptation.alt && adaptation.now.ok) {
    return { ...part, drill: { ...fromShelf(adaptation.alt), numbers: adaptation.now.text } }
  }
  return part
}
