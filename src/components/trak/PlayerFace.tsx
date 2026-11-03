import { Avatar, type AvatarProps } from '@/components/arc/avatar/avatar'
import { hairOf } from '@/lib/player-face'

/* TRAK-349: a player's drawn face, from the season objectives mockup (2 Nov), in place of their initials. Every child
   has the same neutral, non-realistic skin tone, never one chosen per child (Tarek, 3 Nov). Only the hair varies,
   picked from the name, so a child looks the same on every screen. The shirt is the brand colour. It's never a photo:
   nothing is stored or fetched (G7). Coaches, parents and clubs keep Arc's initials and logos. */

/** Opaque, so the head and neck don't darken where they overlap. */
const SKIN = 'color-mix(in oklab, rgb(var(--t-ink)) 24%, rgb(var(--t-surface)))'
const GROUND = 'color-mix(in oklab, rgb(var(--t-brand)) 10%, rgb(var(--t-surface)))'
/** One per `HAIR_STYLE_COUNT`, in the mockup's order. */
const HAIR_STYLES = [
  <path key="crop" d="M11.5 17c-.5-6.5 3.5-10.5 8.5-10.5s9 4 8.5 10.5c-1.5-3-4.5-4.6-8.5-4.6s-7 1.6-8.5 4.6z" />,
  <path key="short" d="M12.2 15.2c.8-5 3.8-8 7.8-8s7 3 7.8 8c-2.2-1.4-4.8-2-7.8-2s-5.6.6-7.8 2z" />,
  <g key="curls"><circle cx="13.6" cy="14" r="3" /><circle cx="16.8" cy="10.6" r="3.3" /><circle cx="21" cy="9.6" r="3.4" /><circle cx="25" cy="11.2" r="3.1" /><circle cx="27" cy="14.8" r="2.6" /></g>,
]

/** The drawing alone. It fills the nearest positioned box, clipped to a circle. */
export function FaceDrawing({ name }: { name: string }) {
  const hair = hairOf(name)
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false" data-face=""
      className="pointer-events-none absolute inset-0 size-full [clip-path:circle(50%)]">
      <rect width="40" height="40" style={{ fill: GROUND }} />
      <path d="M5 41c0-8.5 6.5-13 15-13s15 4.5 15 13z" className="fill-brand" />
      <path d="M16.6 28.3 20 31.6l3.4-3.3z" className="fill-on-brand" opacity={0.85} />
      <rect x="16.8" y="22" width="6.4" height="7" rx="2" data-skin="" style={{ fill: SKIN }} />
      <circle cx="20" cy="17.5" r="7.6" data-skin="" style={{ fill: SKIN }} />
      <g fill={hair.colour} data-hair={hair.style}>{HAIR_STYLES[hair.style]}</g>
    </svg>
  )
}

export type PlayerFaceProps = Omit<AvatarProps, 'src' | 'fallback'>

/** A player's avatar: Arc's frame, label and status, with the drawn face instead of initials. It takes no photo. */
export function PlayerFace(props: PlayerFaceProps) {
  return <Avatar {...props} fallback={<FaceDrawing name={props.name} />} />
}
