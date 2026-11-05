/* TRAK-352 (Season plan 4/18, spec TRAK-348): the four positions a coach places a player in. The academy's roster
   carries none, so a player with no position (or anything but these four) is "No position yet". There is no
   midfielder fallback anywhere. Only players with consent are listed; the rest are counted. */

export const POSITIONS = [
  { value: 'Goalkeeper', short: 'GK', line: 'Goalkeepers' },
  { value: 'Defender', short: 'DEF', line: 'Defenders' },
  { value: 'Midfielder', short: 'MID', line: 'Midfielders' },
  { value: 'Attacker', short: 'ATT', line: 'Attackers' },
] as const

export type Position = (typeof POSITIONS)[number]['value']

export const isPosition = (value: string | null | undefined): value is Position => POSITIONS.some(p => p.value === value)

type Placeable = { id: string; player_name: string; position: string | null; age_group?: string | null }

/** The Positions step's view of a squad: who still needs a position, everyone else by line, and how many wait for
 *  consent (they aren't listed). Names in order within each group. */
export function positionsBoard<P extends Placeable>(players: P[], waiting: Set<string>) {
  const listed = players.filter(p => !waiting.has(p.id)).sort((a, b) => a.player_name.localeCompare(b.player_name))
  const unplaced = listed.filter(p => !isPosition(p.position))
  const lines = POSITIONS.map(position => ({ ...position, players: listed.filter(p => p.position === position.value) }))
  return { total: listed.length, placed: listed.length - unplaced.length, unplaced, lines, waiting: players.length - listed.length }
}

/* TRAK-353 (Season plan 5/18): Can also play and roles. Up to two of the other three positions; any number of roles,
   from the presets for the positions a player plays (the mockup's, from the 28 Oct canvas), or the coach's own. */

export const ROLES: Record<Position, readonly string[]> = {
  Goalkeeper: ['Sweeper-keeper', 'Shot-stopper', 'Distributor'],
  Defender: ['Ball-playing centre back', 'Stopper', 'Covering centre back', 'Attacking full-back', 'Defensive full-back', 'Inverted full-back'],
  Midfielder: ['Controller', 'Box-to-box', 'Ball-winner', 'Wide midfielder'],
  Attacker: ['Winger', 'Inside forward', 'Runner', 'Target striker', 'False nine'],
}
const PRESETS = new Set(Object.values(ROLES).flat())
const AS: Record<Position, string> = { Goalkeeper: 'As a goalkeeper', Defender: 'As a defender', Midfielder: 'As a midfielder', Attacker: 'As an attacker' }
export const ALSO_MAX = 2

/** The panel's roles: the main position's presets, each Can also play's, then Yours (the coach's own, and any role
 *  the player holds that no group above shows, such as one from before a move). None until there's a position. */
export function roleGroups(main: Position | null, also: Position[], chosen: string[], own: string[]) {
  if (!main) return []
  const groups = [main, ...also.filter(p => p !== main)].map(p => ({ heading: AS[p], roles: [...ROLES[p]] }))
  const shown = new Set(groups.flatMap(g => g.roles))
  const yours = [...new Set([...own, ...chosen.filter(r => !shown.has(r))])].sort((a, b) => a.localeCompare(b))
  return yours.length ? [...groups, { heading: 'Yours', roles: yours }] : groups
}

/** The coach's own roles: those their players hold that aren't presets, each once. A role written for one player
 *  shows for the rest this way. */
export const ownRoles = (held: string[]) => [...new Set(held.filter(r => !PRESETS.has(r)))].sort((a, b) => a.localeCompare(b))

/** Ticks or unticks a Can also play. A third, or the main position, is refused and the list stays as it was. */
export function toggleAlso(also: Position[], position: Position, main: Position | null) {
  if (also.includes(position)) return { also: also.filter(p => p !== position), refused: false }
  if (position === main || also.length >= ALSO_MAX) return { also, refused: true }
  return { also: [...also, position], refused: false }
}

/** A new main position leaves Can also play, as the database does. */
export const pickMain = (main: Position, also: Position[]) => also.filter(p => p !== main)

/** Home's Needs you: per squad, how many consented players still need a position. Squads with none are left out. */
export function unplacedBySquad(players: Placeable[], waiting: Set<string>): { squad: string | null; count: number }[] {
  const counts = new Map<string | null, number>()
  for (const p of players) {
    if (waiting.has(p.id) || isPosition(p.position)) continue
    const squad = p.age_group ?? null
    counts.set(squad, (counts.get(squad) ?? 0) + 1)
  }
  return [...counts].map(([squad, count]) => ({ squad, count })).sort((a, b) => (a.squad ?? '').localeCompare(b.squad ?? ''))
}
