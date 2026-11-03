import { HAIR_COLOURS } from '@/lib/fixed-colours'

/* TRAK-349: the one thing about a player's drawn face that varies is the hair, picked from the name. The skin tone is
   the same for every child (Tarek, 3 Nov), so nothing here can pick one. */

export { HAIR_COLOURS }
export const HAIR_STYLE_COUNT = 3

/** The mockup's hash, so a name keeps the hair it had there, and the same child looks the same everywhere. */
export function hairOf(name: string) {
  let hash = 7
  for (const ch of name.trim()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { colour: HAIR_COLOURS[(hash >>> 3) % HAIR_COLOURS.length], style: (hash >>> 6) % HAIR_STYLE_COUNT }
}
