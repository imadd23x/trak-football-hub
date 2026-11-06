import { SEASON_OBJECTIVE_PRESETS } from '@/lib/season-plan'
import type { Position } from '@/lib/positions'

/* TRAK-354 (Season plan 6/18, spec TRAK-348): player objectives. Each placed player works on up to two at once, from
   the six for their position (the mockup's LIB, 2 Nov) or the coach's own. A library objective supports one of the
   six season-objective presets; it says so, and is listed first, when the squad's plan has that season objective. */

export const MAX_PLAYER_OBJECTIVES = 2
export const PLAYER_OBJECTIVE_MAX = 120

/** `supports`: the index of the season-objective preset it serves, or -1 for one that's the player's own. */
export const PLAYER_OBJECTIVE_LIBRARY: Record<Position, readonly { title: string; supports: number }[]> = {
  Goalkeeper: [
    { title: 'Sweeps behind a high line', supports: 0 }, { title: 'Plays it out short when we can', supports: 1 },
    { title: 'Finds the winger with a fast throw', supports: 2 }, { title: 'Commands the box on crosses', supports: 4 },
    { title: 'Talks the back line through set pieces', supports: 4 }, { title: 'Sets up again quickly after a save', supports: 5 },
  ],
  Defender: [
    { title: 'Steps in to win it the moment we lose it', supports: 0 }, { title: 'Breaks a line with a pass into midfield', supports: 1 },
    { title: 'Overlaps when the winger comes inside', supports: 2 }, { title: 'Holds the line together', supports: 3 },
    { title: 'Wins their headers', supports: 4 }, { title: 'Defends 1v1 on the outside', supports: -1 },
  ],
  Midfielder: [
    { title: 'Wins it back in midfield within 5 seconds', supports: 0 }, { title: 'Plays forward on the half-turn', supports: 1 },
    { title: 'Switches play to the free winger', supports: 2 }, { title: 'Scans before receiving', supports: 1 },
    { title: 'Arrives late in the box', supports: -1 }, { title: 'Screens the back four', supports: 3 },
  ],
  Attacker: [
    { title: 'Presses their centre backs first', supports: 0 }, { title: 'Drops between the lines to link play', supports: 1 },
    { title: 'Takes their man on 1v1 early', supports: 2 }, { title: 'Attacks the near post on every cross', supports: 2 },
    { title: 'Attacks the far post', supports: 4 }, { title: 'Runs in behind', supports: -1 },
  ],
}

export type ObjectivePick = { title: string; source: 'library' | 'own'; seasonObjectiveId: string | null }
export type LibraryObjective = { title: string; seasonObjectiveId: string | null; supports: string | null }

/** A position's six, with the season objective each supports in this squad's plan, those that support one first. */
export function libraryFor(position: Position, seasonObjectives: { id: string; title: string }[]): LibraryObjective[] {
  const list = PLAYER_OBJECTIVE_LIBRARY[position].map(({ title, supports }) => {
    const preset = supports >= 0 ? SEASON_OBJECTIVE_PRESETS[supports].title : null
    const match = preset ? seasonObjectives.find(o => o.title === preset) : undefined
    return { title, seasonObjectiveId: match?.id ?? null, supports: match?.title ?? null }
  })
  return [...list.filter(o => o.supports), ...list.filter(o => !o.supports)]
}

/** Ticks or unticks one. A third is refused and the picks stay as they were. */
export function togglePlayerObjective(picked: ObjectivePick[], pick: ObjectivePick) {
  const same = (o: ObjectivePick) => o.title.toLowerCase() === pick.title.toLowerCase()
  if (picked.some(same)) return { picked: picked.filter(o => !same(o)), refused: false }
  if (picked.length >= MAX_PLAYER_OBJECTIVES) return { picked, refused: true }
  return { picked: [...picked, pick], refused: false }
}

/** The coach's own, as one line. Written the way a library one is spelt, it picks that one instead. */
export function addOwnObjective(picked: ObjectivePick[], text: string, library: LibraryObjective[]) {
  const title = text.trim().replace(/\s+/g, ' ')
  if (!title) return { picked, refused: false }
  const hit = library.find(o => o.title.toLowerCase() === title.toLowerCase())
  const pick: ObjectivePick = hit ? { title: hit.title, source: 'library', seasonObjectiveId: hit.seasonObjectiveId } : { title, source: 'own', seasonObjectiveId: null }
  if (picked.some(o => o.title.toLowerCase() === pick.title.toLowerCase())) return { picked, refused: false }
  return togglePlayerObjective(picked, pick)
}
