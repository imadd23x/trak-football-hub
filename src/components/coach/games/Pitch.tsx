import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { slotsOf } from '@/lib/games/formations'

/* TRAK-285 (Games 3/8): the line-up's pitch, drawn light and attacking to the right, as the mockup draws it.
   PitchDiagram.tsx isn't reused: it's a static drill drawing in the old dark palette. TRAK-317 (Imad, 30 Oct): a starter
   expected to stretch is yellow (TRAK-270's attention yellow), so the coach sees the big asks at a glance. Coach only,
   like the expectation itself. TRAK-330 (Imad, 2 Nov): the pitch fills its column, and each slot is its picker (an Arc
   morph select, LineUpAndJobs), drawn here as the slot's circle. */

export type PitchPlayer = { name: string; shirt: number | null; absent: boolean; stretch?: boolean }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()

/** The markings, in a 150 × 100 box: our goal on the left. */
function Markings() {
  return <svg viewBox="0 0 150 100" preserveAspectRatio="none" className="absolute inset-0 size-full text-brand" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={0.6} vectorEffect="non-scaling-stroke">
      <rect x="1" y="1" width="148" height="98" rx="2" />
      <line x1="75" y1="1" x2="75" y2="99" />
      <ellipse cx="75" cy="50" rx="10" ry="15" />
      <rect x="1" y="24" width="20" height="52" />
      <rect x="129" y="24" width="20" height="52" />
    </g>
  </svg>
}

/** A slot's circle: + while it's empty, then the starter's shirt number (initials without one), yellow for a stretch.
 *  A starter whose family says they can't make it carries a warning. */
export function SlotMark({ player }: { player?: PitchPlayer }) {
  const stretch = !!player?.stretch
  return <span data-stretch={stretch || undefined}
    className={`relative grid size-9 place-items-center rounded-full border text-[13px] font-medium ${
      stretch ? 'border-ink/60 bg-[rgb(var(--t-attention))] text-ink'
        : player ? 'border-ink/60 bg-surface text-ink' : 'border-dashed border-ink/40 bg-surface/70 text-ink-3'}`}>
    {player ? player.shirt ?? initials(player.name) : '+'}
    {player?.absent && <TriangleAlert size={14} className="absolute -right-1.5 -top-1.5 rounded-full bg-surface text-warning" aria-hidden="true" />}
  </span>
}

/** `slot` draws each slot's control at its place; `side` is the half of the pitch it's in, for which way a list opens. */
export function Pitch({ shape, slot }: { shape: string; slot: (slot: number, side: 'start' | 'end') => ReactNode }) {
  return (
    <div className="relative aspect-[3/2] w-full rounded-xl border border-line bg-brand/5">
      <Markings />
      {/* Placed with no transform, so a slot's open list (raised by Arc) sits over the slots drawn after it. */}
      {slotsOf(shape).map(({ slot: number, x, y }) => <div key={number} className="absolute" style={{ left: `calc(${y}% - 18px)`, top: `calc(${x}% - 18px)` }}>
        {slot(number, y > 50 ? 'end' : 'start')}
      </div>)}
    </div>
  )
}
