import { useId, useMemo } from 'react'
import { PITCH } from '@/lib/fixed-colours'
import { CANVAS, cardView, describePitch, fit, layout, type LibraryDrill, type Role, type Shape } from '@/lib/training/library'

/* TRAK-386 (Drill Library 2/11): a Library drill's set-up, drawn to scale for the players and level given (Kostas,
   6 Nov: borrow Tarek's picture cards, keep our own pitch drawing). Two sizes: `full` for the drill page, the whole
   canvas with the size line; `card` zooms onto the drill to fill a card and hides the size line. The colours are
   fixed (lib/fixed-colours.ts): a pitch is green in every theme. */

const FILL: Record<Role, string> = { main: PITCH.main, other: PITCH.other, extra: PITCH.extra }
const n1 = (v: number) => Number(v.toFixed(1))

function ShapeView({ p, arrowHead, card }: { p: Shape; arrowHead: string; card: boolean }) {
  switch (p.s) {
    case 'area': return <rect x={n1(p.x)} y={n1(p.y)} width={n1(p.w)} height={n1(p.h)} fill={PITCH.area} stroke={PITCH.line} strokeWidth={2} />
    case 'zone': return <rect x={n1(p.x)} y={n1(p.y)} width={n1(p.w)} height={n1(p.h)} fill={p.edge ? PITCH.middle : PITCH.zone} {...(p.edge ? { stroke: PITCH.faint, strokeDasharray: '5 5' } : {})} />
    case 'lines': return <path d={p.d} stroke={p.strong ? PITCH.line : PITCH.faint} strokeWidth={2} fill="none" {...(p.dashed ? { strokeDasharray: '5 5' } : {})} />
    case 'goal': return <rect x={n1(p.x)} y={n1(p.y)} width={n1(p.w)} height={n1(p.h)} fill={PITCH.main} />
    case 'target': return <rect x={n1(p.x)} y={n1(p.y)} width={n1(p.w)} height={n1(p.h)} fill={PITCH.extra} />
    case 'cone': return <path d={`M${n1(p.x - 5)} ${n1(p.y + 4)}L${n1(p.x)} ${n1(p.y - 6)}L${n1(p.x + 5)} ${n1(p.y + 4)}Z`} fill={PITCH.extra} stroke={PITCH.edge} strokeWidth={1} />
    case 'player': return <circle cx={n1(p.x)} cy={n1(p.y)} r={p.r} fill={FILL[p.role]} stroke={PITCH.edge} strokeWidth={1.5} />
    case 'spare': return <rect x={n1(p.x - 8)} y={n1(p.y - 8)} width={16} height={16} transform={`rotate(45 ${n1(p.x)} ${n1(p.y)})`} fill={PITCH.extra} stroke={PITCH.edge} strokeWidth={1.5} />
    case 'ball': return <circle cx={n1(p.x)} cy={n1(p.y)} r={4} fill={PITCH.main} stroke={PITCH.edge} strokeWidth={1.5} />
    case 'arrow': return <line x1={n1(p.x1)} y1={n1(p.y1)} x2={n1(p.x2)} y2={n1(p.y2)} stroke={PITCH.main} strokeWidth={2} strokeDasharray="6 5" markerEnd={`url(#${arrowHead})`} />
    case 'size': return card ? null : <text x={n1(p.x)} y={n1(p.y)} fill={PITCH.main} fontSize={17} textAnchor="middle" style={{ fontFamily: 'inherit' }}>{p.text}</text>
  }
}

type Props = {
  drill: LibraryDrill
  /** How many players it's fitted for. */
  players: number
  /** The level, 0–7 (START_LEVEL is the standard). */
  level: number
  variant?: 'full' | 'card'
  className?: string
}

/** The drill fitted and laid out. */
function useDrillPicture(drill: LibraryDrill, players: number, level: number) {
  return useMemo(() => {
    const fitted = fit(drill, players, level)
    return { fitted, shapes: layout(drill, fitted) }
  }, [drill, players, level])
}

export function DrillPitch({ drill, players, level, variant = 'full', className = '' }: Props) {
  const { fitted, shapes } = useDrillPicture(drill, players, level)
  const card = variant === 'card'
  return <PitchSvg shapes={shapes} card={card} label={card ? null : describePitch(drill, fitted)} className={className} variant={variant} />
}

/** Any shapes on the whole canvas, to scale, with the size line: Change any practice's examples (TRAK-394). */
export function PitchPicture({ shapes, label, className = '' }: { shapes: Shape[]; label: string; className?: string }) {
  return <PitchSvg shapes={shapes} card={false} label={label} className={className} variant="full" />
}

/** The grass and the shapes. A card zooms onto them and is hidden from screen readers; a full picture is labelled. */
function PitchSvg({ shapes, card, label, className, variant }: { shapes: Shape[]; card: boolean; label: string | null; className: string; variant: 'full' | 'card' }) {
  const arrowHead = `pitch-arrow-${useId().replace(/:/g, '')}`
  const view = card ? cardView(shapes) : { x: 0, y: 0, ...CANVAS }
  return (
    <div className={`overflow-hidden leading-none ${card ? '' : 'rounded-[10px]'} ${className}`} style={{ background: PITCH.grass }}>
      <svg
        viewBox={`${n1(view.x)} ${n1(view.y)} ${n1(view.w)} ${n1(view.h)}`}
        className="block h-auto w-full"
        {...(label === null ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
        data-variant={variant}
      >
        <defs>
          <marker id={arrowHead} markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
            <path d="M0 0L6 3L0 6Z" fill={PITCH.main} />
          </marker>
        </defs>
        {shapes.map((p, i) => <ShapeView key={i} p={p} arrowHead={arrowHead} card={card} />)}
      </svg>
    </div>
  )
}

/** The key under a full picture: what each colour means for this drill ("Attackers", "Defenders", "Keeper"). */
export function PitchKey({ legend, className = '' }: { legend: readonly (readonly [Role, string])[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ink-2 ${className}`} aria-label="Key">
      {legend.map(([role, label]) => (
        <li key={`${role}-${label}`} className="inline-flex items-center gap-1.5">
          <i aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: FILL[role], border: `1.5px solid ${PITCH.edge}` }} />
          {label}
        </li>
      ))}
    </ul>
  )
}
