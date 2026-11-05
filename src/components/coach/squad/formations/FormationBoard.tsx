import { useEffect, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useIsMobile } from '@/hooks/use-mobile'
import { lineName, slotsOf, type Format } from '@/lib/games/formations'
import { POSITIONS, type Position } from '@/lib/positions'
import { fitOf, slotPosition, type Fit, type Spot, type XI } from '@/lib/squad/formation-board'
import { usePointerSwap } from './usePointerSwap'

/* TRAK-357 (Season plan 9/18, spec TRAK-348): one pitch beside one bench, for Formations and, next, the match line-up
   (TRAK-358). The pitch is portrait and attacks upwards, with Matches' places (slotsOf) turned so our goal is at the
   bottom. Players swap by a real drag, by tapping one and then another, or with Enter or Space on each; Escape lets
   go. Rings: orange outside the player's position and Can also play; dashed when no position is recorded, never then
   called out of position. Every ring is said in words too. From Tarek's parked My Formations build (31 Oct). */

export type BoardPlayer = { id: string; name: string; shirt: number | null; position: string | null; also: Position[]; canPlay: boolean }

const first = (name: string) => name.split(/\s+/)[0] ?? name
const short = (position: Position) => POSITIONS.find(p => p.value === position)!.short
const lower = (position: string) => position.toLowerCase()
/** A place's height from the top: Matches puts the lines from y 8 (our keeper) to 88 (the front line); here they
 *  span 12% to 88%, so a face and its name always stay inside the pitch. */
const topOf = (y: number) => 12 + ((88 - y) * 76) / 80

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
  const fits = slots.map(({ slot }) => {
    const player = players.get(starters[slot])
    return player ? fitOf(player, slotPosition(shape, slot)) : null
  })
  const filled = slots.filter(({ slot }) => players.has(starters[slot])).length
  const count = (fit: Fit) => slots.filter(({ slot }, i) => fits[i] === fit && players.get(starters[slot])?.canPlay).length
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
      <div className="relative mx-auto aspect-[4/5] w-full max-w-[460px] overflow-hidden rounded-xl border border-line bg-brand/5"
        role="group" aria-label={`${title}, ${shape}, starting players. Attacking upwards.`}>
        <Markings />
        {slots.map(({ slot, x, y }, i) => {
          const spot: Spot = `slot:${slot}`
          const player = players.get(starters[slot])
          const line = lineName(shape, slot)
          const on = selected === spot
          const label = player ? `${player.name}, ${line}, place ${slot}. ${fitWords(player, fits[i]!)}${on ? ' Selected.' : ''}`
            : `Place ${slot}, ${line}, empty.${on ? ' Selected.' : ''}`
          const { style, ...handlers } = bind(spot, player?.name ?? `Place ${slot}`)
          return <button key={slot} type="button" {...handlers} aria-pressed={on} aria-label={label}
            title={player ? `${player.name} · ${fitWords(player, fits[i]!)}` : undefined}
            data-fit={player ? (player.canPlay ? fits[i] : 'gone') : 'empty'} onClick={() => tap(spot)}
            className={`absolute grid w-[56px] -translate-x-1/2 -translate-y-1/2 select-none justify-items-center gap-[3px] rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:transition-colors tablet:w-[76px] ${
              drag?.over === spot ? 'bg-brand/20 ring-2 ring-brand' : on ? 'bg-brand/15 ring-2 ring-brand' : ''}`}
            style={{ ...style, left: `${x}%`, top: `${topOf(y)}%` }}>
            {player ? <>
              <span className={`rounded-full ${ringClass(player, fits[i]!)}`}><PlayerFace name={player.name} size={phone ? 'sm' : 'md'} aria-hidden="true" /></span>
              <span className="max-w-full truncate rounded bg-surface/90 px-0.5 text-[11px] font-medium leading-4 text-ink tablet:text-[12px]">{first(player.name)}</span>
            </> : <span aria-hidden="true" className="grid size-7 place-items-center rounded-full border border-dashed border-ink/40 bg-surface/70 text-ink-3 tablet:size-9">+</span>}
            <span aria-hidden="true" className="hidden text-[11px] leading-3 text-ink-3 tablet:block">{short(slotPosition(shape, slot))}</span>
          </button>
        })}
      </div>
      {drag && <div aria-hidden="true" className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg"
        style={{ left: drag.x, top: drag.y }}><PlayerFace name={drag.name} size="md" /></div>}

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
            const where = [player.position, ...player.also].filter(Boolean).map(p => short(p as Position)).join(' / ') || 'No position'
            const { style, ...handlers } = bind(spot, player.name)
            return <li key={player.id}>
              <button type="button" {...handlers} style={style} aria-pressed={on} onClick={() => tap(spot)}
                aria-label={`${player.name}, bench${player.shirt != null ? `, number ${player.shirt}` : ''}, ${where}.${on ? ' Selected.' : ''}`}
                className={`grid w-full select-none justify-items-center gap-1 rounded-xl border p-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:transition-colors ${
                  drag?.over === spot ? 'border-brand bg-brand/20' : on ? 'border-brand bg-brand/15' : 'border-line bg-surface'}`}>
                <PlayerFace name={player.name} size="md" aria-hidden="true" />
                <span className="max-w-full truncate text-sm font-medium text-ink">{first(player.name)}</span>
                <span className="max-w-full truncate text-xs text-ink-3">{player.shirt != null ? `#${player.shirt} · ` : ''}{where}</span>
              </button>
            </li>
          })}
        </ul>}
    </section>
  </div>
}
