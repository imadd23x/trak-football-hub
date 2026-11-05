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
