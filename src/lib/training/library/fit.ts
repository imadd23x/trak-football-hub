import type { LibraryDrill } from './drills'

/* TRAK-385 (Drill Library 1/11): how Trak fits a Library drill to a squad. Every drill has 8 levels, easiest first;
   Steve's five physical characteristics (area, numbers, targets, direction, conditions) come out of the drill's
   template, the number of players and the level. Ported from the 8 Nov mockup; the numbers are Claude's, not yet
   checked by Steve. */

export const LEVELS = 8
/** Kostas, 8 Nov: every drill starts at the standard level, level 4 of 8 (Trak has no team level to start from). */
export const START_LEVEL = 3
/** The mockup's Players today runs from 8 to 20. */
export const PLAYERS_TODAY = { min: 8, max: 20 } as const
/** A drill fitted to a squad we don't know the size of. */
export const FALLBACK_PLAYERS = 15

/** How many players a squad's drills are fitted to: the roster, kept to what a drill can be drawn for. */
export const squadPlayers = (roster: number | null | undefined) =>
  roster ? Math.min(PLAYERS_TODAY.max, Math.max(PLAYERS_TODAY.min, roster)) : FALLBACK_PLAYERS

/** Steve's five characteristics, in his order. The keys are the plan's own (PlanDrill in ../parts.ts). */
export const DETAILS = [
  { key: 'area', name: 'Area shape and size' },
  { key: 'numbers', name: 'Numbers' },
  { key: 'targets', name: 'Targets' },
  { key: 'direction', name: 'Direction' },
  { key: 'conditions', name: 'Conditions' },
] as const

export type DetailKey = (typeof DETAILS)[number]['key']
export type Details = Record<DetailKey, string>

type Grid = { att: number; def: number }

/** What the pitch picture (TRAK-386) draws, to scale in metres. */
export type Draw =
  | { type: 'scatter'; att: number; def: number; side: number; noBall?: boolean }
  | { type: 'square'; grids: Grid[]; side: number }
  | { type: 'game'; s: number; sb?: number; j: number; L: number; W: number; oneGoal?: boolean; noGoals?: boolean; target?: boolean; keeper: '' | 'left' | 'right' }
  | { type: 'pairs'; pairs: number; odd: boolean; gap: number }
  | { type: 'shoot'; g: number; n: number; dist: number; angle: boolean }

/** Who a dot on the picture is: the main group (attackers, Team A, players), the other group (defenders, Team B) or
 *  the extras (keepers, spare players, the target). The pitch picture (TRAK-386) picks each one's colour. */
export type Role = 'main' | 'other' | 'extra'

export type Fitted = { details: Details; draw: Draw; legend: [role: Role, label: string][] }

/* Each template's numbers, level by level (easiest first). */
const SQ = [[.2, 24, 0], [.25, 19, 3], [.25, 15, 3], [.25, 15, 2], [.3, 12, 2], [.33, 10, 2], [.36, 9, 1], [.4, 8, 1]] // defenders' share, room per player (m²), touches
const BE = [[.15, 24], [.2, 20], [.2, 16], [.25, 16], [.25, 13], [.3, 13], [.3, 11], [.35, 11]] // defenders' share, room per player
const GA = [[2, 120, 0], [2, 100, 0], [1, 100, 0], [1, 85, 0], [1, 70, 3], [0, 70, 2], [0, 55, 2], [0, 45, 1]] // spare players, room per player, touches
const PR = [[6, 3, 'stronger foot'], [8, 3, 'stronger foot'], [8, 2, 'stronger foot'], [10, 2, 'either foot'], [12, 2, 'either foot'], [12, 1, 'either foot'], [15, 1, 'either foot'], [15, 1, 'weaker foot only']] as const // gap (m), touches, foot
const SH = [[8, 'Ball still, 2 touches'], [10, 'Ball still, 2 touches'], [12, 'Ball still, 2 touches'], [12, 'Ball rolling, 2 touches'], [14, 'Ball rolling, 2 touches'], [14, 'Ball rolling, 1 touch'], [16, 'Ball rolling, 1 touch'], [16, 'Ball from the side, 1 touch']] as const
const KP = [[16, 'Served at chest height'], [14, 'Served at chest height'], [14, 'Served low'], [12, 'Served low'], [12, 'Driven low'], [10, 'Driven low'], [10, 'Driven to either side'], [8, 'Driven to either side']] as const
const GR = [[10, 0], [10, 3], [12, 3], [12, 2], [14, 2], [14, 2], [16, 1], [16, 1]] // square size (m), touches
const FN = [[3, 1, 40, 30, 0], [3, 1, 35, 30, 0], [3, 2, 35, 30, 0], [4, 2, 35, 30, 0], [4, 3, 35, 25, 3], [4, 3, 30, 25, 2], [5, 4, 30, 25, 2], [5, 4, 30, 25, 1]] // attackers, defenders, length, width, touches
const FM = [[3, 40, 30, 0], [4, 35, 30, 0], [4, 35, 30, 0], [5, 35, 30, 0], [5, 35, 25, 3], [6, 30, 25, 2], [6, 30, 25, 2], [7, 30, 25, 1]] // players each side, length, width, touches
const FR = [22, 22, 20, 20, 18, 18, 16, 15] // box size (m)
const LP = [20, 20, 25, 25, 30, 30, 35, 40] // long passes and keepers' distribution: gap (m), TRAK-388

const MAIN: Role = 'main', OTHER: Role = 'other', EXTRA: Role = 'extra'

const touches = (t: number) => t === 0 ? 'Any touches' : t === 1 ? '1 touch' : `${t} touches`
const round5 = (x: number) => Math.max(15, Math.round(x / 5) * 5)
const join = (...parts: string[]) => parts.filter(Boolean).join('. ')
const level = (i: number) => Math.min(LEVELS - 1, Math.max(0, Math.round(i)))

/** The drill's own rule at a level. */
export const ruleAt = (d: Pick<LibraryDrill, 'rule'>, i: number) =>
  d.rule === undefined ? '' : typeof d.rule === 'string' ? d.rule : d.rule[level(i)]

const details = (area: string, numbers: string, targets: string, direction: string, conditions: string): Details =>
  ({ area, numbers, targets, direction, conditions })

/** The drill fitted to `n` players at level `i` (0–7). */
export function fit(d: LibraryDrill, n: number, i: number): Fitted {
  i = level(i)
  const rule = ruleAt(d, i)
  switch (d.template) {
    case 'warm':
      return { details: details('20x20 m', `${n} players`, 'None', 'Non-directional', rule),
        draw: { type: 'scatter', att: n, def: 0, side: 20, noBall: true }, legend: [[MAIN, 'Players']] }
    case 'free': {
      // TRAK-388: `solo` drills give everyone a ball and no partner (Dribble through the gates).
      const side = FR[i], pairs = Math.floor(n / 2)
      const numbers = d.solo ? `${n} players, a ball each` : n % 2 ? `${pairs - 1} pairs and a group of 3` : `${pairs} pairs`
      return { details: details(`${side}x${side} m`, numbers, d.targets || 'None. Follow your partner', 'Non-directional', rule),
        draw: { type: 'scatter', att: n, def: 0, side }, legend: [[MAIN, 'Players']] }
    }
    case 'groups': {
      const [side, t] = GR[i], g = Math.max(2, Math.round(n / 5)), base = Math.floor(n / g), extra = n % g
      const grids = Array.from({ length: g }, (_, k) => {
        const s = base + (k < extra ? 1 : 0), def = d.shadow ? (s >= 6 ? 2 : 1) : 0
        return { att: s - def, def }
      })
      return { details: details(`${side}x${side} m each`, `${n} players, ${g} groups`, 'The next cone', 'Non-directional. Round the square', join(touches(t), rule)),
        draw: { type: 'square', grids, side }, legend: d.shadow ? [[MAIN, 'Passers'], [OTHER, 'Movers']] : [[MAIN, 'Players']] }
    }
    case 'func': {
      // TRAK-388: `group` fixes the numbers in each turn (1 v 1 to goal); the level still sets the room and touches.
      const [a0, b0, L0, W0, t] = FN[i], [a, b] = d.group ?? [a0, b0]
      // 10 Nov read-through: fewer players in each turn get a smaller area, in proportion (1 v 1 is about 20x15 m).
      const k = Math.sqrt((a + b) / (a0 + b0)), L = round5(L0 * k), W = round5(W0 * k)
      return { details: details(`${L}x${W} m`, `${n} players, groups of ${a}v${b} and a keeper`, 'One goal', 'Directional. Attack the goal', join(touches(t), rule)),
        draw: { type: 'game', s: a, sb: b, j: 0, L, W, oneGoal: true, keeper: '' }, legend: [[MAIN, 'Attackers'], [OTHER, 'Defenders']] }
    }
    case 'funcm': {
      // 10 Nov read-through: at most about three wait to rotate in, so an easier level never leaves half the squad idle.
      const [a0, L, W, t] = FM[i], half = Math.floor((n - 1) / 2), a = Math.min(half, Math.max(a0, half - 1)), rest = n - a * 2 - 1
      return { details: details(`${L}x${W} m`, `${n} players, ${a}v${a} and a keeper${rest ? `, ${rest} rotate in` : ''}`, 'One goal', 'Directional. Attack the goal', join(touches(t), rule)),
        draw: { type: 'game', s: a, sb: a, j: 0, L, W, oneGoal: true, keeper: 'right' }, legend: [[MAIN, 'Attackers'], [OTHER, 'Defenders'], [EXTRA, 'Keeper']] }
    }
    case 'square': {
      if (d.ballEach) {
        const [r, a] = BE[i], def = Math.max(1, Math.round(n * r)), side = Math.round(Math.sqrt(a * n))
        return { details: details(`${side}x${side} m`, `${n - def} with a ball, ${def} hunting`, 'Keep your ball', 'Non-directional', rule),
          draw: { type: 'scatter', att: n - def, def, side }, legend: [[MAIN, 'With a ball'], [OTHER, 'Defenders']] }
      }
      const [r, a, t] = SQ[i], g = d.grids === 2 ? 2 : d.third ? 1 : n >= 14 ? 2 : 1
      const sizes = g === 2 ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n]
      const grids = sizes.map(s => { const def = Math.max(1, Math.round(s * (d.third ? 1 / 3 : r))); return { att: s - def, def } })
      // 10 Nov read-through: a three-team game plays inside the area, so it needs far more room than a rondo round it.
      const side = Math.round(Math.sqrt(a * (d.third ? 2.5 : 1) * sizes[0]))
      const ov = g === 1 ? `${grids[0].att}v${grids[0].def}`
        : grids[0].att === grids[1].att && grids[0].def === grids[1].def ? `${grids[0].att}v${grids[0].def} in each grid`
        : `${grids[0].att}v${grids[0].def} and ${grids[1].att}v${grids[1].def}`
      return { details: details(`${side}x${side} m${g === 2 ? ' each' : ''}`, `${n} players, ${ov}`, d.targets || 'Keep the ball', 'Non-directional', join(touches(t), rule)),
        draw: { type: 'square', grids, side }, legend: [[MAIN, 'Attackers'], [OTHER, 'Defenders']] }
    }
    case 'game': {
      const [j0, a, t] = GA[i], N = n - (d.keeper ? 1 : 0)
      const j = d.keeper ? N % 2 : (N - j0) % 2 ? j0 + 1 : j0, s = (N - j) / 2
      const L = round5(Math.sqrt(n * a * 1.5)), W = round5(L / 1.5)
      const legend: Fitted['legend'] = [[MAIN, 'Team A'], [OTHER, 'Team B']]
      if (j) legend.push([EXTRA, 'Spare player'])
      if (d.keeper) legend.push([EXTRA, 'Keeper'])
      return {
        details: details(`${L}x${W} m`, `${n} players, ${s}v${s}${j ? ` + ${j} spare` : ''}${d.keeper ? ' and a keeper' : ''}`,
          d.targets || (d.noGoals ? 'Keep the ball' : 'Two goals'), d.noGoals ? 'Non-directional' : 'Directional. Attack one end', join(touches(t), rule)),
        draw: { type: 'game', s, j, L, W, noGoals: d.noGoals, target: d.overlay === 'target', keeper: d.keeper ? 'left' : '' }, legend,
      }
    }
    case 'pairs': {
      // TRAK-388: `long` drills (long passes, a keeper's throws and kicks) are 20 to 40 m apart.
      const [gap0, t, foot] = PR[i], gap = d.long ? LP[i] : gap0, pairs = Math.floor(n / 2), odd = n % 2 === 1
      return { details: details(`${gap} m between partners`, odd ? `${pairs - 1} pairs and a group of 3` : `${pairs} pairs`, 'Your partner', 'Non-directional. Back and forth', d.rule ? rule : `${touches(t)}, ${foot}`),
        draw: { type: 'pairs', pairs, odd, gap }, legend: [[MAIN, 'Players']] }
    }
    case 'shoot': {
      const [dist, c] = (d.focus === 'goalkeeping' ? KP : SH)[i], g = n > 10 ? 2 : 1
      // TRAK-388: a drill's own rule replaces the serve (Sweep behind the line).
      return { details: details(`${dist} m from goal`, `${n} players, ${g === 2 ? 'two goals' : 'one goal'}`, 'One goal', 'Directional. At goal', d.rule ? rule : c),
        draw: { type: 'shoot', g, n, dist, angle: !!d.angle }, legend: [[MAIN, d.focus === 'goalkeeping' ? 'Servers' : 'Shooters'], [EXTRA, 'Keeper']] }
    }
  }
}

const sameDetails = (a: Details, b: Details) => DETAILS.every(({ key }) => a[key] === b[key])

/** Easier (-1) or Harder (+1): the next level that really changes something for `n` players, so the button never
 *  does nothing; null at the end of the scale. */
export function nextLevel(d: LibraryDrill, n: number, i: number, by: -1 | 1): number | null {
  const now = fit(d, n, i).details
  for (let k = level(i) + by; k >= 0 && k < LEVELS; k += by) if (!sameDetails(now, fit(d, n, k).details)) return k
  return null
}

export type Direction = 'easier' | 'harder'

/** The sentence that teaches: why a change makes the drill easier or harder. Empty when there's nothing to say. */
export function reason(key: DetailKey, dir: Direction, d: Pick<LibraryDrill, 'template' | 'focus'>): string {
  const shoot = d.template === 'shoot', pairs = d.template === 'pairs', keeper = d.focus === 'goalkeeping'
  const harder = dir === 'harder'
  if (d.template === 'groups' && key === 'area') return harder ? 'Longer passes ask for more control.' : 'Shorter passes are easier to control.'
  if ((d.template === 'warm' || d.template === 'free') && key === 'conditions') return harder ? 'A faster pace asks for more control.' : 'A slower pace is easier to start with.'
  if (d.template === 'funcm' && key === 'numbers') return harder ? 'More players on the pitch means more to read.' : 'Fewer players makes each decision simpler.'
  switch (key) {
    case 'area':
      if (keeper) return harder ? 'Closer shots give the keeper less time.' : 'A longer shot gives the keeper more time.'
      if (shoot) return harder ? 'Further out needs a cleaner strike.' : 'Closer in makes the strike simpler.'
      if (pairs) return harder ? 'A bigger gap asks for more control.' : 'A smaller gap is easier to control.'
      return harder ? 'Less room means less time on the ball.' : 'More room gives players time to look up.'
    case 'numbers': return harder ? 'Fewer spare players means passes are harder to find.' : 'More spare players means there’s always someone to pass to.'
    case 'conditions': return harder ? 'A tighter rule means quicker decisions.' : 'A looser rule gives players more time.'
    default: return ''
  }
}

export type Change = { key: DetailKey; name: string; from: string; to: string; why: string }

/** What the last press changed, as the drill page and View drill say it: Easier, Harder or Players today. */
export type Changed = { title: string; items: Change[] }

export const changedBy = (by: -1 | 1, items: Change[]): Changed =>
  ({ title: by > 0 ? 'Harder. Here’s what Trak changed:' : 'Easier. Here’s what Trak changed:', items })

/** What changed between two fits of the same drill, detail by detail. `dir` adds the why; null (Players today) leaves
 *  it out, because more players isn't easier or harder. */
export function changes(a: Fitted, b: Fitted, dir: Direction | null, d: Pick<LibraryDrill, 'template' | 'focus'>): Change[] {
  return DETAILS.filter(({ key }) => a.details[key] !== b.details[key])
    .map(({ key, name }) => ({ key, name, from: a.details[key], to: b.details[key], why: dir ? reason(key, dir, d) : '' }))
}

/** Easier or Harder in one go: the new level and what changed, or null when there's no further to go. */
export function step(d: LibraryDrill, n: number, i: number, by: -1 | 1): { level: number; changes: Change[] } | null {
  const to = nextLevel(d, n, i, by)
  return to === null ? null : { level: to, changes: changes(fit(d, n, i), fit(d, n, to), by > 0 ? 'harder' : 'easier', d) }
}

/** Players today: the drill refitted for `to` players at the same level, and what changed. */
export function refit(d: LibraryDrill, from: number, to: number, i: number): Change[] {
  return changes(fit(d, from, i), fit(d, to, i), null, d)
}
