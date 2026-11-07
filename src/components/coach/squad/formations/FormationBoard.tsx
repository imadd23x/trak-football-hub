import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Check, TriangleAlert, Undo2 } from 'lucide-react'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useIsMobile } from '@/hooks/use-mobile'
import { lineName, slotsOf, type Format } from '@/lib/games/formations'
import type { Position } from '@/lib/positions'
import { fitOf, positionsShort, shortPosition, slotPosition, type Fit, type Spot, type XI } from '@/lib/squad/formation-board'
import type { Dragging } from './usePointerSwap'
import { usePointerSwap } from './usePointerSwap'

/* TRAK-357 (Season plan 9/18, spec TRAK-348): one pitch beside one bench, for Formations and, next, the match line-up
   (TRAK-358). The pitch is portrait and attacks upwards, with Matches' places (slotsOf) turned so our goal is at the
   bottom. Players swap by a real drag, by tapping one and then another, or with Enter or Space on each; Escape lets
   go. Rings: orange outside the player's position and Can also play; dashed when no position is recorded, never then
   called out of position. Every ring is said in words too. From Tarek's parked My Formations build (31 Oct).
   TRAK-358: the pitch, its places, the bench's faces and the drag's face are shared with the match line-up, whose
   faces also carry markers on their corners (a ✓ bottom right, an i top right). */

export type BoardPlayer = { id: string; name: string; shirt: number | null; position: string | null; also: Position[]; canPlay: boolean }

const first = (name: string) => name.split(/\s+/)[0] ?? name
const lower = (position: string) => position.toLowerCase()
/** A place's height from the top: Matches puts the lines from y 8 (our keeper) to 88 (the front line); here they
 *  span 12% to 88%, so a face and its name always stay inside the pitch. */
const topOf = (y: number) => 12 + ((88 - y) * 76) / 80
const MARK = 'absolute grid size-4 place-items-center rounded-full border border-surface text-[10px] font-bold leading-none'

function fitWords(player: BoardPlayer, fit: Fit) {
  if (!player.canPlay) return "Can't be picked any more: they left the squad, or consent isn't in place."
  if (fit === 'listed') return 'Plays here.'
  if (fit === 'also') return 'Can also play here.'
  if (fit === 'unknown') return 'No position recorded.'
  const also = player.also.length ? `, can also play ${player.also.map(lower).join(' and ')}` : ''
  return `Out of position: plays ${lower(player.position!)}${also}.`
}
function ringClass(player: BoardPlayer, fit: Fit) {
  if (!player.canPlay) return 'shadow-[0_0_0_3px_rgb(var(--t-danger))]'
  if (fit === 'out') return 'shadow-[0_0_0_3px_rgb(var(--t-orange))]'
  if (fit === 'unknown') return 'outline-dashed outline-2 outline-offset-1 outline-line-strong'
  return ''
}

function Markings() {
  return <svg viewBox="0 0 100 125" preserveAspectRatio="none" className="absolute inset-0 size-full text-brand" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.6}>
      <rect x="1" y="1" width="98" height="123" rx="2" />
      <line x1="1" y1="62.5" x2="99" y2="62.5" />
      <circle cx="50" cy="62.5" r="11" />
      <rect x="24" y="1" width="52" height="17" />
      <rect x="24" y="107" width="52" height="17" />
    </g>
  </svg>
}

/** The pitch, portrait and attacking upwards, with a place for each of the shape's first `format` slots. `place`
 *  draws one, at the spot it's given. */
export function BoardPitch({ label, shape, format, place }: {
  label: string; shape: string; format: number; place: (slot: number, at: CSSProperties) => ReactNode
}) {
  return <div className="relative mx-auto aspect-[4/5] w-full max-w-[460px] overflow-hidden rounded-xl border border-line bg-brand/5"
    role="group" aria-label={label}>
    <Markings />
    {slotsOf(shape).slice(0, format).map(({ slot, x, y }) => place(slot, { left: `${x}%`, top: `${topOf(y)}%` }))}
  </div>
}

export type FaceMarks = { name: string; ring?: string; done?: boolean; context?: boolean; absent?: boolean }

/** A drawn face in its ring. TRAK-358: a ✓ bottom right, an i top right, and a "can't make it" warning top left. The
 *  marks are drawn only; the face's button says them in words. */
export function BoardFace({ name, ring = '', done = false, context = false, absent = false, size }: FaceMarks & { size: 'sm' | 'md' }) {
  return <span className={`relative rounded-full ${ring}`}>
    <PlayerFace name={name} size={size} aria-hidden="true" />
    {absent && <TriangleAlert size={14} aria-hidden="true" data-mark="absent" className="absolute -left-1.5 -top-1.5 rounded-full bg-surface text-warning" />}
    {context && <span aria-hidden="true" data-mark="context" className={`${MARK} -right-1.5 -top-1.5 bg-ink font-serif italic text-surface`}>i</span>}
    {done && <span aria-hidden="true" data-mark="done" className={`${MARK} -bottom-1.5 -right-1.5 bg-brand text-on-brand`}><Check size={10} strokeWidth={3} /></span>}
  </span>
}

type PlaceProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  at: CSSProperties; on: boolean; over: boolean; face: FaceMarks | null; line: Position; size: 'sm' | 'md'
}

/** One place on the pitch: the face and first name, or an empty "+", and the line it asks for. Highlighted while
 *  selected, or while a drag is over it. */
export function BoardPlace({ at, on, over, face, line, size, style, ...button }: PlaceProps) {
  return <button type="button" {...button} aria-pressed={on}
    className={`absolute grid w-[56px] -translate-x-1/2 -translate-y-1/2 select-none justify-items-center gap-[3px] rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:transition-colors tablet:w-[76px] ${
      over ? 'bg-brand/20 ring-2 ring-brand' : on ? 'bg-brand/15 ring-2 ring-brand' : ''}`}
    style={{ ...style, ...at }}>
    {face ? <>
      <BoardFace {...face} size={size} />
      <span className="max-w-full truncate rounded bg-surface/90 px-0.5 text-[11px] font-medium leading-4 text-ink tablet:text-[12px]">{first(face.name)}</span>
    </> : <span aria-hidden="true" className="grid size-7 place-items-center rounded-full border border-dashed border-ink/40 bg-surface/70 text-ink-3 tablet:size-9">+</span>}
    <span aria-hidden="true" className="hidden text-[11px] leading-3 text-ink-3 tablet:block">{shortPosition(line)}</span>
  </button>
}

/** A face off the pitch, as the bench shows it: the face, the first name, and a line under it. */
export function BoardBenchFace({ on, over, face, detail, ...button }: ButtonHTMLAttributes<HTMLButtonElement> & {
  on: boolean; over: boolean; face: FaceMarks; detail: string
}) {
  return <button type="button" {...button} aria-pressed={on}
    className={`grid w-full select-none justify-items-center gap-1 rounded-xl border p-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:transition-colors ${
      over ? 'border-brand bg-brand/20' : on ? 'border-brand bg-brand/15' : 'border-line bg-surface'}`}>
    <BoardFace {...face} size="md" />
    <span className="max-w-full truncate text-sm font-medium text-ink">{first(face.name)}</span>
    <span className="max-w-full truncate text-xs text-ink-3">{detail}</span>
  </button>
}

/** The face that follows a finger or the mouse while dragging. */
export function DragGhost<S extends string>({ drag }: { drag: Dragging<S> | null }) {
  return drag && <div aria-hidden="true" className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg"
    style={{ left: drag.x, top: drag.y }}><PlayerFace name={drag.name} size="md" /></div>
}

export function FormationBoard({ title, shape, format, starters, players, bench, onSwap, onUndo, canUndo }: {
  title: string
  shape: string
  format: Format
  starters: XI
  /** Everyone who can appear on the board, by id. */
  players: Map<string, BoardPlayer>
  /** Who's not starting, in the order the bench shows them. */
  bench: BoardPlayer[]
  onSwap: (from: Spot, to: Spot) => void
  onUndo: () => void
  canUndo: boolean
}) {
  const [selected, setSelected] = useState<Spot | null>(null)
  const swapping = usePointerSwap((from, to) => { setSelected(null); onSwap(from, to) })
  const { drag, bind, wasDrag } = swapping
  const phone = useIsMobile()
  const slots = slotsOf(shape).slice(0, format)
  const fits = new Map(slots.map(({ slot }) => {
    const player = players.get(starters[slot])
    return [slot, player ? fitOf(player, slotPosition(shape, slot)) : null]
  }))
  const filled = slots.filter(({ slot }) => players.has(starters[slot])).length
  const count = (fit: Fit) => slots.filter(({ slot }) => fits.get(slot) === fit && players.get(starters[slot])?.canPlay).length
  const gone = slots.filter(({ slot }) => players.get(starters[slot])?.canPlay === false).length

  // Escape lets go of a selection.
  useEffect(() => {
    if (!selected) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [selected])

  // Two taps swap as a drag does: the first selects, the second swaps with it. Two on the bench, or two empty places,
  // just move the selection.
  const tap = (spot: Spot) => {
    if (wasDrag()) return
    const empty = (s: Spot) => s.startsWith('slot:') && !players.has(starters[Number(s.slice(5))])
    const onBench = (s: Spot) => s.startsWith('bench:')
    if (!selected || selected === spot) { setSelected(selected === spot ? null : spot); return }
    if ((onBench(selected) && onBench(spot)) || (empty(selected) && empty(spot))) { setSelected(spot); return }
    setSelected(null)
    onSwap(selected, spot)
  }
  const selectedName = !selected ? null : selected.startsWith('bench:') ? players.get(selected.slice(6))?.name : players.get(starters[Number(selected.slice(5))])?.name

  return <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] laptop:items-start">
    <div className="grid gap-3">
      <BoardPitch label={`${title}, ${shape}, starting players. Attacking upwards.`} shape={shape} format={format} place={(slot, at) => {
        const spot: Spot = `slot:${slot}`
        const player = players.get(starters[slot])
        const fit = fits.get(slot)!
        const line = lineName(shape, slot)
        const on = selected === spot
        const label = player ? `${player.name}, ${line}, place ${slot}. ${fitWords(player, fit)}${on ? ' Selected.' : ''}`
          : `Place ${slot}, ${line}, empty.${on ? ' Selected.' : ''}`
        return <BoardPlace key={slot} {...bind(spot, player?.name ?? `Place ${slot}`)} at={at} on={on} over={drag?.over === spot}
          face={player ? { name: player.name, ring: ringClass(player, fit) } : null} line={slotPosition(shape, slot)} size={phone ? 'sm' : 'md'}
          aria-label={label} title={player ? `${player.name} · ${fitWords(player, fit)}` : undefined}
          data-fit={player ? (player.canPlay ? fit : 'gone') : 'empty'} onClick={() => tap(spot)} />
      }} />
      <DragGhost drag={drag} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
        <span>{filled === slots.length ? `${filled} starters · ${bench.length} on the bench`
          : `${filled} of ${slots.length} starters · ${slots.length - filled} ${slots.length - filled === 1 ? 'place' : 'places'} empty · ${bench.length} on the bench`}</span>
        {count('out') > 0 && <span className="flex items-center gap-2"><span aria-hidden="true" className="size-3.5 rounded-full shadow-[0_0_0_3px_rgb(var(--t-orange))]" />
          {count('out')} out of position</span>}
        {count('unknown') > 0 && <span className="flex items-center gap-2"><span aria-hidden="true" className="size-3.5 rounded-full outline-dashed outline-2 outline-line-strong" />
          {count('unknown')} with no position recorded</span>}
        {gone > 0 && <span className="flex items-center gap-2 text-danger"><span aria-hidden="true" className="size-3.5 rounded-full shadow-[0_0_0_3px_rgb(var(--t-danger))]" />
          {gone} can't be picked any more</span>}
        <button type="button" onClick={onUndo} disabled={!canUndo}
          className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-brand disabled:text-ink-3 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Undo2 size={16} aria-hidden="true" />Undo last change</button>
      </div>
      <p role="status" className="min-h-5 text-sm text-ink-2">{selected ? (selectedName
        ? `${selectedName} selected. Tap ${selected.startsWith('bench:') ? 'a place on the pitch' : 'another player, on the pitch or the bench,'} to swap, or press Escape.`
        : 'Empty place selected. Tap a player to put there, or press Escape.') : ''}</p>
    </div>

    <section aria-labelledby="formation-bench" className="grid content-start gap-3">
      <div className="grid gap-0.5">
        <h3 id="formation-bench" className="text-base font-medium text-ink">Bench <span className="font-normal text-ink-3">· {bench.length}</span></h3>
        <p className="text-sm text-ink-3">Drag a player onto a place, or tap one and then another.</p>
      </div>
      {bench.length === 0 ? <p className="text-sm text-ink-2">Everyone is starting.</p>
        : <ul role="group" aria-label="Bench" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 p-0">
          {bench.map(player => {
            const spot: Spot = `bench:${player.id}`
            const on = selected === spot
            const where = positionsShort(player.position, player.also)
            return <li key={player.id}>
              <BoardBenchFace {...bind(spot, player.name)} on={on} over={drag?.over === spot} onClick={() => tap(spot)}
                face={{ name: player.name }} detail={`${player.shirt != null ? `#${player.shirt} · ` : ''}${where}`}
                aria-label={`${player.name}, bench${player.shirt != null ? `, number ${player.shirt}` : ''}, ${where}.${on ? ' Selected.' : ''}`} />
            </li>
          })}
        </ul>}
    </section>
  </div>
}
