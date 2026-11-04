import type { KeyboardEvent } from 'react'
import { Reorder, useDragControls, type DragControls } from 'motion/react'
import { Check, GripVertical, Pencil, Plus, Search, Users, X } from 'lucide-react'
import { fitLine, partColour, partLine, playersLine, totalMinutes, type Part, type PlanDrill } from '@/lib/training/parts'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'

/* TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): the planner's pieces. A drill tile (its description only
   once it's picked, Kostas 2 Nov), the time bar, and Your session: the whole session at a glance, where the coach shapes
   it (drag or arrow keys to move a part, × to remove one, Add a part). */

export function DrillTile({ drill, picked, tag, onPick }: { drill: PlanDrill; picked: boolean; tag: string; onPick: () => void }) {
  const players = playersLine(drill)
  // As the mockup (Kostas, 3 Nov): the tick sits in the corner of the picked drill, the name has the width, the rest is small.
  return <button type="button" aria-pressed={picked} onClick={onPick}
    className={`relative flex h-full w-full flex-col items-start gap-1.5 rounded-[14px] border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${picked ? 'border-2 border-brand bg-brand/5' : 'border-line bg-surface hover:bg-raised'}`}>
    {picked && <span className="absolute right-3 top-3 inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-brand text-on-brand">
      <Check aria-hidden size={13} /></span>}
    <span className="pr-7 text-[15px] font-medium leading-snug text-ink break-words">{drill.name}</span>
    {picked && drill.how && <span className="text-[13px] leading-snug text-ink-2 break-words">{drill.how}</span>}
    {players && <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[13px] text-ink-2"><Users aria-hidden size={14} />{players}</span>}
    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tag.startsWith('Your usual') || tag === 'My drill' ? 'bg-brand/10 text-brand' : 'bg-raised text-ink-2'} ${players ? '' : 'mt-auto'}`}>{tag}</span>
  </button>
}

export function ActionTile({ icon, label, onClick }: { icon: 'plus' | 'search'; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}
    className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-line bg-surface p-3.5 text-center text-brand hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    {icon === 'plus' ? <Plus aria-hidden size={18} /> : <Search aria-hidden size={18} />}
    <span className="text-[15px] font-medium text-ink">{label}</span>
  </button>
}

/** The session's minutes as one bar, each part its share; spare time shows as a gap. */
export function TimeBar({ parts, length, current }: { parts: Part[]; length: number | null; current?: string }) {
  const total = totalMinutes(parts)
  return <div role="img" aria-label={length ? `${total} of ${length} minutes planned` : `${total} minutes planned`}
    className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-raised">
    {parts.map((part, i) => part.minutes > 0 && <span key={part.key} title={`${part.name}: ${part.minutes} min`}
      className={part.key === current ? 'ring-2 ring-inset ring-ink/40' : ''}
      style={{ flexGrow: part.minutes, background: partColour(i, parts.length) }} />)}
    {length && total < length && <span style={{ flexGrow: length - total }} />}
  </div>
}

export function TotalLine({ parts, length }: { parts: Part[]; length: number | null }) {
  const total = totalMinutes(parts)
  return <span className={`text-sm font-medium ${length && total > length ? 'text-warning' : 'text-ink-2'}`}>
    {length ? `${total} of ${length} min` : `${total} min`}</span>
}

/** Your session: the parts in order. While planning, each opens its step; drag or the arrow keys on its handle move it,
 *  and × removes it. */
export function SessionCard({ parts, length, current, onOpen, onReorder, onMove, onRemove, onAdd, onStandard, fromShape, standard }: {
  parts: Part[]; length: number | null; current: string; onOpen: (key: string) => void; onReorder: (parts: Part[]) => void
  onMove: (index: number, by: -1 | 1) => void; onRemove: (index: number) => void; onAdd: () => void; onStandard: () => void
  fromShape: boolean; standard: boolean
}) {
  const fit = fitLine(totalMinutes(parts), length)
  const at = parts.findIndex(p => p.key === current)
  return <aside aria-labelledby="your-session" className="arc grid content-start gap-3 rounded-2xl border border-line bg-surface p-5">
    <div className="flex items-baseline justify-between gap-3">
      <h2 id="your-session" className="text-lg font-medium text-ink">Your session</h2>
      <TotalLine parts={parts} length={length} />
    </div>
    <TimeBar parts={parts} length={length} current={current} />
    {fit && <p className={`text-sm ${length && totalMinutes(parts) > length ? 'text-warning' : 'text-ink-3'}`}>{fit}</p>}
    <p className="text-[12px] text-ink-3">Drag a part to move it, or use the arrow keys on its handle. × removes it.</p>
    <Reorder.Group as="ol" axis="y" values={parts} onReorder={onReorder} aria-label="Parts of the session" className="grid gap-1.5">
      {parts.map((part, i) => <SessionRow key={part.key} part={part} index={i} count={parts.length}
        state={part.key === current ? 'now' : at >= 0 && i < at ? 'done' : 'next'}
        onOpen={() => onOpen(part.key)} onMove={by => onMove(i, by)} onRemove={() => onRemove(i)} />)}
    </Reorder.Group>
    <div className="grid justify-items-start gap-2 pt-1">
      <Button size="sm" variant="secondary" onClick={onAdd}><Plus aria-hidden size={16} />Add a part</Button>
      {fromShape && <p className="text-[13px] text-ink-3">Started from the parts you used last time.</p>}
      {!standard && <button type="button" onClick={onStandard}
        className="min-h-9 rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        Start from Trak’s 5 parts</button>}
    </div>
  </aside>
}

/** What moves a part, in Your session and on Review: drag it, or the up and down arrow keys. `busy` ignores both for now,
 *  without taking the keyboard's focus off it. */
function MoveHandle({ name, index, count, controls, onMove, busy = false }: {
  name: string; index: number; count: number; controls: DragControls; onMove: (by: -1 | 1) => void; busy?: boolean
}) {
  const keys = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    if (busy) return
    if (event.key === 'ArrowUp' && index > 0) onMove(-1)
    if (event.key === 'ArrowDown' && index < count - 1) onMove(1)
  }
  return <button type="button" aria-label={`Move ${name}. Use the up and down arrow keys.`} title="Drag to move" onKeyDown={keys}
    onPointerDown={event => { if (!busy && typeof (event.target as Element).setPointerCapture === 'function') controls.start(event) }} style={{ touchAction: 'none' }}
    className="inline-flex h-11 w-7 flex-none cursor-grab items-center justify-center rounded-lg text-ink-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <GripVertical aria-hidden size={16} /></button>
}

function SessionRow({ part, index, count, state, onOpen, onMove, onRemove }: {
  part: Part; index: number; count: number; state: 'now' | 'done' | 'next'; onOpen: () => void; onMove: (by: -1 | 1) => void; onRemove: () => void
}) {
  const controls = useDragControls()
  return <Reorder.Item as="li" value={part} dragListener={false} dragControls={controls}
    className="flex items-center gap-1 rounded-xl bg-surface">
    <MoveHandle name={part.name} index={index} count={count} controls={controls} onMove={onMove} />
    <button type="button" onClick={onOpen} aria-current={state === 'now' ? 'step' : undefined}
      className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${state === 'now' ? 'bg-brand/10' : 'hover:bg-raised'}`}>
      <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full border border-line text-[12px] text-ink-2">
        {state === 'done' && part.drill ? <Check aria-hidden size={14} /> : index + 1}</span>
      <span className="grid min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
          <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: partColour(index, count) }} />
          <span className="truncate">{part.name}</span></span>
        {part.drill?.name !== part.name && <span className="truncate text-[13px] text-ink-3">{part.drill?.name ?? 'No drill yet'}</span>}
      </span>
      <span className="flex-none text-[13px] text-ink-2">{part.minutes} min</span>
    </button>
    <button type="button" aria-label={`Remove ${part.name}`} title="Remove this part" onClick={onRemove}
      className="inline-flex h-11 w-9 flex-none items-center justify-center rounded-lg text-ink-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <X aria-hidden size={16} /></button>
  </Reorder.Item>
}


/** The plan as a list: each part's minutes, name, drill and players, with Edit (or Pick a drill) and ×. TRAK-341: the
 *  planner's Review step and a saved plan's Review page show the same list. TRAK-367 (Kostas, 3 Nov): a part moves here
 *  as it does in Your session. `onDrop` is the end of a drag. */
export function PlanRows({ parts, onEdit, onRemove, onReorder, onMove, onDrop, busy = false }: {
  parts: Part[]; onEdit: (index: number) => void; onRemove: (index: number) => void; onReorder: (parts: Part[]) => void
  onMove: (index: number, by: -1 | 1) => void; onDrop?: () => void; busy?: boolean
}) {
  if (!parts.length) return <p className="py-3 text-[15px] text-ink-2">No parts in this plan yet. Add one below.</p>
  return <Reorder.Group as="ol" axis="y" values={parts} onReorder={onReorder} aria-label="The plan" className="grid divide-y divide-line">
    {parts.map((part, i) => <PlanRow key={part.key} part={part} index={i} count={parts.length} onEdit={() => onEdit(i)}
      onRemove={() => onRemove(i)} onMove={by => onMove(i, by)} onDrop={onDrop} busy={busy} />)}
  </Reorder.Group>
}

function PlanRow({ part, index, count, onEdit, onRemove, onMove, onDrop, busy }: {
  part: Part; index: number; count: number; onEdit: () => void; onRemove: () => void; onMove: (by: -1 | 1) => void; onDrop?: () => void; busy: boolean
}) {
  const controls = useDragControls()
  // TRAK-342: once Who's here set it up for the players who came, that set-up shows instead.
  const players = part.drill?.numbers.trim() ? `Today: ${part.drill.numbers.trim()}` : part.drill ? playersLine(part.drill) : null
  return <Reorder.Item as="li" value={part} dragListener={false} dragControls={controls} onDragEnd={onDrop}
    className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface py-3">
    <MoveHandle name={part.name} index={index} count={count} controls={controls} onMove={onMove} busy={busy} />
    <span className="w-10 flex-none text-center text-base font-medium text-ink">{part.minutes}<span className="block text-[11px] font-normal text-ink-3">min</span></span>
    <span className="grid min-w-0 flex-[1_1_11rem] gap-0.5">
      <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: partColour(index, count) }} />{partLine(part, index)}</span>
      <span className={`text-[15px] font-medium break-words ${part.drill ? 'text-ink' : 'text-ink-3'}`}>{part.drill?.name ?? 'No drill yet'}</span>
      {players && <span className="text-[13px] text-ink-3">{players}</span>}
    </span>
    <span className="flex flex-none gap-1">
      <Button size="sm" variant="ghost" disabled={busy} aria-label={`${part.drill ? 'Edit' : 'Pick a drill for'} ${part.name}`} onClick={onEdit}>
        <Pencil aria-hidden size={14} />{part.drill ? 'Edit' : 'Pick a drill'}</Button>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${part.name}`} onClick={onRemove}><X aria-hidden size={16} /></Button>
    </span>
  </Reorder.Item>
}
