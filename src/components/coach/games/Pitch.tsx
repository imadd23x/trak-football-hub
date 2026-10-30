import { TriangleAlert } from 'lucide-react'
import { slotsOf } from '@/lib/games/formations'

/* TRAK-285 (Games 3/8): the line-up's pitch, drawn light and attacking to the right, as the mockup draws it. Each slot
   of the formation is a button: an empty one opens the player picker, a filled one the player's sheet. PitchDiagram.tsx
   isn't reused: it's a static drill drawing in the old dark palette. TRAK-317 (Imad, 30 Oct): a starter expected to
   stretch is yellow (TRAK-270's attention yellow), so the coach sees the big asks at a glance. Coach only, like the
   expectation itself. */

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

export function Pitch({ shape, starters, selected, onSelect }: {
  shape: string
  /** The starter in each slot. */
  starters: Map<number, PitchPlayer>
  selected: number | null
  onSelect: (slot: number) => void
}) {
  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-line bg-brand/5">
      <Markings />
      {slotsOf(shape).map(({ slot, x, y }) => {
        const player = starters.get(slot)
        const on = selected === slot
        const stretch = !!player?.stretch
        return <button key={slot} type="button" onClick={() => onSelect(slot)} aria-pressed={on} data-stretch={stretch || undefined}
          aria-label={player ? `${player.name}, slot ${slot}${stretch ? ', stretch' : ''}${player.absent ? ", can't make it" : ''}` : `Slot ${slot}, empty`}
          className={`absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            on ? `border-ink bg-ink text-surface${stretch ? ' shadow-[0_0_0_3px_rgb(var(--t-attention))]' : ''}`
              : stretch ? 'border-ink/60 bg-[rgb(var(--t-attention))] text-ink'
              : player ? 'border-ink/60 bg-surface text-ink' : 'border-dashed border-ink/40 bg-surface/70 text-ink-3'}`}
          style={{ left: `${y}%`, top: `${x}%` }}>
          {player ? player.shirt ?? initials(player.name) : '+'}
          {player?.absent && <TriangleAlert size={14} className="absolute -right-1.5 -top-1.5 rounded-full bg-surface text-warning" aria-hidden="true" />}
        </button>
      })}
    </div>
  )
}

/** A formation card's picture: the shape's slots on a tiny pitch. */
export function MiniPitch({ shape }: { shape: string }) {
  return <svg viewBox="0 0 150 100" className="h-8 w-12 text-brand" aria-hidden="true">
    <rect x="2" y="2" width="146" height="96" rx="8" fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.3} strokeWidth={3} />
    <line x1="75" y1="2" x2="75" y2="98" stroke="currentColor" strokeOpacity={0.3} strokeWidth={3} />
    {slotsOf(shape).map(({ slot, x, y }) => <circle key={slot} cx={y * 1.5} cy={x} r={6} fill="currentColor" />)}
  </svg>
}
