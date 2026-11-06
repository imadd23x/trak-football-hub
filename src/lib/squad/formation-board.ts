import { lineName, slotsOf, type Format } from '@/lib/games/formations'
import { isPosition, type Position } from '@/lib/positions'

/* TRAK-357 (Season plan 9/18, spec TRAK-348): the rules behind Formations' pitch and bench, shared with the match
   line-up (TRAK-358). A formation's starters are kept as place → player; everyone else is on the bench. Places number
   as Matches' do (slotsOf): 1 is the keeper, then each line from the back, left to right. */

/** A place on the pitch, or a player on the bench: what a drag, a tap or the keyboard moves between. */
export type Spot = `slot:${number}` | `bench:${string}`
export type XI = Record<number, string>
export type Fit = 'listed' | 'also' | 'out' | 'unknown'
type Placeable = { id: string; position: string | null; also?: readonly string[] }

/** The squad's first three (the mockup's; Tarek, 5 Nov: saved for them, once). */
export const FORMATION_SEEDS = [
  { name: 'Attacking tactic', format: 11, shape: '3-4-3' },
  { name: 'Park the bus', format: 11, shape: '5-4-1' },
  { name: 'Balanced', format: 11, shape: '4-3-3' },
] as const

/** The position a place asks for. Matches calls its front line Forward; a player's position calls it Attacker. */
export function slotPosition(shape: string, slot: number): Position {
  const line = lineName(shape, slot)
  return line === 'Forward' ? 'Attacker' : isPosition(line) ? line : 'Midfielder'
}

/** In their position, one they can also play, out of position, or none recorded (never called out of position). */
export function fitOf(player: Placeable, position: Position): Fit {
  if (!isPosition(player.position)) return 'unknown'
  if (player.position === position) return 'listed'
  return player.also?.includes(position) ? 'also' : 'out'
}

/** A first eleven: each place takes the first player in its line, then any gaps take whoever is left, in order. A
 *  squad too small leaves places empty. Nobody twice. */
export function firstXI(players: Placeable[], shape: string): XI {
  const left = [...players], xi: XI = {}
  const slots = slotsOf(shape)
  for (const { slot } of slots) {
    const at = left.findIndex(p => p.position === slotPosition(shape, slot))
    if (at >= 0) xi[slot] = left.splice(at, 1)[0].id
  }
  for (const { slot } of slots) if (!xi[slot] && left.length) xi[slot] = left.shift()!.id
  return xi
}

/** A new shape keeps everyone it can in their line; past a smaller format, the rest go to the bench. */
export function reshapeXI(xi: XI, from: string, to: string, format: Format = 11): XI {
  const was = Object.keys(xi).map(Number).sort((a, b) => a - b).map(slot => ({ id: xi[slot], line: slotPosition(from, slot) }))
  const slots = slotsOf(to).slice(0, format), next: XI = {}
  for (const { slot } of slots) {
    const at = was.findIndex(p => p.line === slotPosition(to, slot))
    if (at >= 0) next[slot] = was.splice(at, 1)[0].id
  }
  for (const { slot } of slots) if (!next[slot] && was.length) next[slot] = was.shift()!.id
  return next
}

const slotOf = (spot: Spot) => Number(spot.slice(5))
const isBench = (spot: Spot): spot is `bench:${string}` => spot.startsWith('bench:')

/** A drag, two taps or the keyboard: a bench player onto a place starts there and whoever held it goes to the bench;
 *  two places swap (an empty one moves the player). Nobody ever starts twice. */
export function swapXI(xi: XI, a: Spot, b: Spot): XI {
  if (isBench(a) && isBench(b)) return xi
  if (isBench(a) || isBench(b)) {
    const [id, slot] = isBench(a) ? [a.slice(6), slotOf(b)] : [(b as string).slice(6), slotOf(a)]
    const already = Object.entries(xi).find(([, holder]) => holder === id)
    if (already) return swapXI(xi, `slot:${Number(already[0])}`, `slot:${slot}`)
    return { ...xi, [slot]: id }
  }
  const next = { ...xi }, x = next[slotOf(a)], y = next[slotOf(b)]
  delete next[slotOf(a)]
  delete next[slotOf(b)]
  if (y) next[slotOf(a)] = y
  if (x) next[slotOf(b)] = x
  return next
}
