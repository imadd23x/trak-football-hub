import { Link } from 'react-router-dom'
import { drillPath, fit, type LibraryDrill } from '@/lib/training/library'
import { DrillPitch } from './DrillPitch'
import { CardBookmark } from './BookmarkButton'

/* TRAK-387 (Drill Library 3/11): a picture-first drill card (Kostas, 6 Nov, from Tarek's mockup). The same fit as the
   drill's page, so the card and the page always match. `note` says how a search found it ("Also called waves"). */

const FOCUS = { team: '', individual: 'Individual', goalkeeping: 'Goalkeeping' } as const

export function DrillCard({ drill, players, level, note = '' }: { drill: LibraryDrill; players: number; level: number; note?: string }) {
  const { details } = fit(drill, players, level)
  const sub = [note, FOCUS[drill.focus]].filter(Boolean).join(' · ')
  return (
    <Link to={drillPath(drill.id)}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <DrillPitch drill={drill} players={players} level={level} variant="card" />
      <span className="grid gap-0.5 px-3 pt-2 pb-2.5 tablet:px-3.5 tablet:pb-3">
        <span className="text-[15px] font-medium leading-snug text-ink tablet:text-[17px]">{drill.name}</span>
        {sub && <span className="text-[13px] leading-snug text-ink-3">{sub}</span>}
        <span className="mt-1 hidden text-[13px] leading-snug text-brand tablet:block">{details.numbers} · {details.area}</span>
      </span>
    </Link>
  )
}

/** Cards in a grid: two across on a phone, as many as fit on a laptop. Each has its bookmark (TRAK-390). */
export function DrillCards({ drills, players, level, notes, label }: {
  drills: LibraryDrill[]; players: number; level: number; notes?: (d: LibraryDrill) => string; label?: string
}) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-2.5 tablet:gap-3 tablet:[grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
      {drills.map(d => <li key={d.id} className="relative min-w-0">
        <DrillCard drill={d} players={players} level={level} note={notes?.(d)} />
        <CardBookmark drill={d} />
      </li>)}
    </ul>
  )
}
