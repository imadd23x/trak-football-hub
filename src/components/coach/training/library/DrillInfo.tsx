import { useId } from 'react'
import { DETAILS, type Changed, type Details, type LibraryDrill } from '@/lib/training/library'

/* TRAK-392 (Drill Library 7/11): the parts of a drill shown both on its page (TRAK-389) and in Plan session's View
   drill pop-up, so the two read the same: what the last press changed, the five details with the changed ones marked,
   and why, how to play and what to watch for. */

export const CHIP = 'rounded-full border border-line bg-raised px-2.5 py-0.5 text-[13px] font-medium text-ink-2'
export const SIDE_HEADING = 'text-xs font-medium uppercase tracking-[0.08em] text-ink-3'

/** What the last press changed, or what pressing does. */
export function ChangeNote({ changed, idle }: { changed: Changed | null; idle: string }) {
  return changed ? <div role="status" className="grid gap-1.5 rounded-xl bg-warning/15 px-3.5 py-3 text-[15px] text-ink">
      <p className="font-medium">{changed.title}</p>
      {changed.items.length ? <ul className="grid gap-1">{changed.items.map(c =>
        <li key={c.key}>{c.name}: {c.from} to {c.to}.{c.why ? ` ${c.why}` : ''}</li>)}</ul>
        : <p>Nothing changes with that many.</p>}
    </div>
    : <p role="status" className="rounded-xl bg-raised px-3.5 py-3 text-[15px] text-ink-2">{idle}</p>
}

/** The five details, the ones the last press changed marked. */
export function DetailList({ details, changed }: { details: Details; changed: Changed | null }) {
  const hit = new Set(changed?.items.map(c => c.key))
  return <dl className="grid overflow-hidden rounded-xl border border-line tablet:grid-cols-5">
    {DETAILS.map(({ key, name }) => <div key={key} data-changed={hit.has(key) || undefined}
      className={`flex justify-between gap-3 border-b border-line px-3 py-2.5 last:border-b-0 tablet:grid tablet:content-start tablet:gap-0.5 tablet:border-b-0 tablet:border-r tablet:last:border-r-0 ${hit.has(key) ? 'bg-warning/15' : ''}`}>
      <dt className="flex-none text-xs text-ink-3">{name}</dt>
      <dd className="text-right text-sm font-medium text-ink [overflow-wrap:anywhere] tablet:text-left">{details[key] || '—'}</dd>
    </div>)}
  </dl>
}

/** Why this works, How to play, Watch for. */
export function AboutDrill({ drill }: { drill: LibraryDrill }) {
  const id = useId()
  return <>
    <section aria-labelledby={`${id}-why`} className="grid gap-1.5">
      <h2 id={`${id}-why`} className={SIDE_HEADING}>Why this works</h2>
      <p className="text-[17px] text-ink">{drill.why}</p>
    </section>
    <section aria-labelledby={`${id}-how`} className="grid gap-1.5">
      <h2 id={`${id}-how`} className={SIDE_HEADING}>How to play</h2>
      <ol className="grid list-decimal gap-2 pl-5 text-[15px] text-ink marker:text-ink-3">{drill.how.map(line => <li key={line}>{line}</li>)}</ol>
    </section>
    <section aria-labelledby={`${id}-watch`} className="grid gap-1.5">
      <h2 id={`${id}-watch`} className={SIDE_HEADING}>Watch for</h2>
      <ul className="grid list-disc gap-1.5 pl-5 text-[15px] text-ink marker:text-brand">{drill.watch.map(w => <li key={w}>{w}</li>)}</ul>
    </section>
  </>
}
