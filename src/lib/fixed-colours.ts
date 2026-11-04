import type { CSSProperties } from 'react'

/**
 * TRAK-189: the few colours that don't follow Trak's theme, in one place.
 * Everything else uses the role tokens (--t-* in src/index.css).
 */
/** WhatsApp's own green, on its share icon. */
export const WHATSAPP_GREEN = '#25D366'
/** Text on a WhatsApp-green button (TRAK-168's Share to WhatsApp after Cancel): black, 11:1. */
export const ON_WHATSAPP_GREEN = '#000000'
/** TRAK-264: the Library's tiles, headers and pictures sit on a library's colour (an assessment
 *  band's readable shade, lib/types.ts, which stays the same in every theme): white on it, 4.5:1 or more. */
export const ON_LIBRARY = '#FFFFFF'
/** The thin rings drawn on a library's colour. */
export const ON_LIBRARY_RING = 'rgb(255 255 255 / 0.3)'
/** A round button on a library's colour, and on its pale tint. */
export const ON_LIBRARY_BUTTON = 'rgb(0 0 0 / 0.22)'
export const ON_TINT_BUTTON = 'rgb(255 255 255 / 0.7)'
/** TRAK-334: a page's trail (CoachTrail) on a library's colour: white, as the header's own text, with ring-white chevrons. */
export const ON_COLOUR_TRAIL = { '--text-secondary': ON_LIBRARY, '--text-muted': ON_LIBRARY, '--accent-strong': ON_LIBRARY, '--border-strong': ON_LIBRARY_RING } as CSSProperties
/** TRAK-349: the hair on a player's drawn face (lib/player-face.ts), from the mockup. Hair is hair in every theme. */
export const HAIR_COLOURS = ['#1F1A17', '#3B2A1F', '#6B4428', '#A8763E', '#2B2B2B'] as const
