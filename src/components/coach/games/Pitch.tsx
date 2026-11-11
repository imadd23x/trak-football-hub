import { i18n, useTranslation } from '@/lib/i18n'
import type { HTMLAttributes } from 'react'
import { Check } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { markerWords, markersOf, type PlayerPlan } from '@/lib/games/lineup'
import { slotPosition } from '@/lib/squad/formation-board'
import { BoardBenchFace, BoardPitch, BoardPlace, type FaceMarks } from '@/components/coach/squad/formations/FormationBoard'
import type { usePointerSwap } from '@/components/coach/squad/formations/usePointerSwap'

/* TRAK-285 (Games 3/8): the line-up's pitch. Each slot of the formation is a button: an empty one opens the player
   picker, a filled one the player's sheet. TRAK-358 (Season plan 10/18, spec TRAK-348): it's Formations' pitch,
   portrait and attacking upwards, and a player drags onto a place, onto another face, or onto Bench or Not selected.
   Every face, on the pitch and off it, carries its markers: ✓ bottom right for a job (for a Not selected player, a
   note), i top right for any context, and a ring for the expectation, yellow for Stretch and green for Lead (Tarek,
   6 Nov: the spec's colours, not TRAK-370's badge colours, which stay on the badges). Coach only, like what they show.
   Each marker is said in the face's name too, so colour is never the only signal. */

export type LineUpSpot = `slot:${number}` | `player:${string}` | 'list:bench' | 'list:not_selected' | 'list:not_attending'
export type LineUpSwap = ReturnType<typeof usePointerSwap<LineUpSpot>>
export type PitchPlayer = { id: string; name: string; absent: boolean; plan: PlayerPlan }

const RING = { stretch: 'shadow-[0_0_0_3px_rgb(var(--t-attention))]', lead: 'shadow-[0_0_0_3px_rgb(var(--t-success))]' } as const

function marks(name: string, plan: PlayerPlan, absent: boolean): FaceMarks {
  const { done, context, ring } = markersOf(plan)
  return { name, done, context, absent, ring: ring ? RING[ring] : '' }
}
const said = (plan: PlayerPlan, absent: boolean) =>
  [...markerWords(plan), ...(absent ? [i18n.t('coachMatches:cantMakeItWord')] : [])].map(word => `, ${word}`).join('')
/** A drop target only; it starts no drag. */
const target = (swap: LineUpSwap | null, spot: LineUpSpot) => (swap ? { 'data-spot': spot } : {})

export function Pitch({ shape, format, starters, selected, onSelect, swap, className }: {
  shape: string
  format: number
  /** The starter in each slot. */
  starters: Map<number, PitchPlayer>
  selected: number | null
  onSelect: (slot: number) => void
  /** Dragging, until kick-off locks the line-up. */
  swap: LineUpSwap | null
  /** A narrower cap on the pitch, such as one that keeps it within the screen's height. */
  className?: string
}) {
  const phone = useIsMobile()
  return <BoardPitch label={i18n.t('coachMatches:pitchLabel', { shape })} shape={shape} format={format} className={className} place={(slot, at) => {
    const player = starters.get(slot)
    const spot: LineUpSpot = `slot:${slot}`
    const drag = player && swap ? swap.bind(spot, player.name) : target(swap, spot)
    return <BoardPlace key={slot} {...drag} at={at} on={selected === slot} over={swap?.drag?.over === spot}
      face={player ? marks(player.name, player.plan, player.absent) : null} line={slotPosition(shape, slot)} size={phone ? 'sm' : 'md'}
      aria-label={player ? i18n.t('coachMatches:slotFilled', { name: player.name, slot, said: said(player.plan, player.absent) }) : i18n.t('coachMatches:slotEmpty', { slot })}
      data-ring={(player && markersOf(player.plan).ring) || undefined}
      onClick={() => { if (!swap?.wasDrag()) onSelect(slot) }} />
  }} />
}

const KEY_MARK = 'grid size-4 place-items-center rounded-full text-[10px] font-bold leading-none'

/** What each marker means, under the pitch. */
export function MarkersKey() {
  const { t } = useTranslation()
  return <ul aria-label={t('coachMatches:key')} className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-sm text-ink-3">
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className={`${KEY_MARK} bg-brand text-on-brand`}><Check size={10} strokeWidth={3} /></span>
      {t('coachMatches:keyJob')}</li>
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className={`${KEY_MARK} bg-ink font-serif italic text-surface`}>i</span>{t('coachMatches:keyContext')}</li>
    <li className="flex items-center gap-2"><span aria-hidden="true" className={`size-3.5 rounded-full ${RING.stretch}`} />{t('coachMatches:keyStretch')}</li>
    <li className="flex items-center gap-2"><span aria-hidden="true" className={`size-3.5 rounded-full ${RING.lead}`} />{t('coachMatches:keyLead')}</li>
  </ul>
}

/** A face off the pitch, on the Bench, Not selected or Not attending tab: it opens the player's sheet, and drags onto
 *  the pitch. A family's "Can't make it" shows on it wherever the child is. */
export function ListFace({ player, plan, list, detail, on, onOpen, swap }: {
  player: { id: string; name: string; absent?: boolean }
  plan: PlayerPlan
  list: 'bench' | 'not selected' | 'not attending'
  detail: string
  on: boolean
  onOpen: () => void
  swap: LineUpSwap | null
}) {
  const spot: LineUpSpot = `player:${player.id}`
  const drag: HTMLAttributes<HTMLButtonElement> = swap ? swap.bind(spot, player.name) : {}
  return <BoardBenchFace {...drag} on={on} over={swap?.drag?.over === spot} face={marks(player.name, plan, !!player.absent)} detail={detail}
    aria-label={i18n.t('coachMatches:listFace', { name: player.name, list: i18n.t(list === 'bench' ? 'coachMatches:listBench' : list === 'not selected' ? 'coachMatches:listNotSelected' : 'coachMatches:listNotAttending'), said: said(plan, !!player.absent) })} data-ring={markersOf(plan).ring ?? undefined}
    onClick={() => { if (!swap?.wasDrag()) onOpen() }} />
}
