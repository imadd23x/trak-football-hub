import { HAIR_COLOURS } from '@/lib/fixed-colours'

/* TRAK-349: the one thing about a player's drawn face that varies is the hair, picked from the name. The skin tone is
   the same for every child (Tarek, 3 Nov), so nothing here can pick one. */

export { HAIR_COLOURS }
export const HAIR_STYLE_COUNT = 3

/** TRAK-617: the hair a coach selected for a player: a style (0 to HAIR_STYLE_COUNT - 1) and a colour (a position in
 *  HAIR_COLOURS). The database checks the same ranges. */
export type HairPick = { style: number; colour: number }

/** The mockup's hash, so a name keeps the hair it had there, and the same child looks the same everywhere.
 *  TRAK-617: where the player's coach selected the hair, that selection instead. */
export function hairOf(name: string, pick?: HairPick | null) {
  if (pick) return { colour: HAIR_COLOURS[pick.colour], style: pick.style }
  let hash = 7
  for (const ch of name.trim()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { colour: HAIR_COLOURS[(hash >>> 3) % HAIR_COLOURS.length], style: (hash >>> 6) % HAIR_STYLE_COUNT }
}
