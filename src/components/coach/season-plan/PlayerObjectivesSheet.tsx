import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/arc/alert/alert'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import type { WatchAction } from '@/components/coach/season-plan/WatchFirst'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { isPosition, type Position } from '@/lib/positions'
import {
  MAX_PLAYER_OBJECTIVES, PLAYER_OBJECTIVE_MAX, addOwnObjective, libraryFor, togglePlayerObjective, type ObjectivePick,
} from '@/lib/player-objectives'
import { usePlayerObjectives, useSavePlayerObjectives } from './usePlayerObjectives'

/* TRAK-354 (Season plan 6/18, spec TRAK-348): a player's objectives, picked in one bottom sheet (as TRAK-353's
   panel, Tarek 5 Nov), opened from a name in step 3 and from the player's page. Up to two: the six for their position,
   those supporting the squad's season objectives first, or the coach's own. A third is refused with the reason. One
   Save writes the list; Players see them once the plan is shared (TRAK-356, TRAK-366). */

const AS: Record<Position, string> = { Goalkeeper: 'a goalkeeper', Defender: 'a defender', Midfielder: 'a midfielder', Attacker: 'an attacker' }
const same = (a: ObjectivePick[], b: ObjectivePick[]) =>
  JSON.stringify(a.map(o => [o.title, o.seasonObjectiveId]).sort()) === JSON.stringify(b.map(o => [o.title, o.seasonObjectiveId]).sort())
const card = (on: boolean) =>
  `grid min-h-16 content-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-brand bg-brand/10' : 'border-line bg-surface'}`

export type ObjectivesPlayer = { id: string; name: string; position: string | null }

export function PlayerObjectivesSheet({ coachId, player, seasonObjectives, open, onOpenChange, saveLabel = 'Save', saveNeedsChange = false, quiet = false, onSaved, watch }: {
  coachId: string
  player: ObjectivesPlayer
  /** The squad's season objectives, so a library objective can say which one it supports. */
  seasonObjectives: { id: string; title: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  saveLabel?: string
  /** The player's page: Save waits for a change. In step 3, Save · next moves on either way. */
  saveNeedsChange?: boolean
  /** In step 3 the next player opening says it saved; elsewhere a toast does. */
  quiet?: boolean
  onSaved: () => void
  /** TRAK-355: in a set-up step, Watch first (or Keep watching) instead of setting them up now. */
  watch?: WatchAction
}) {
  const objectives = usePlayerObjectives(coachId, open)
  const first = player.name.split(' ')[0]
  return <BottomSheet className="arc" open={open} onOpenChange={onOpenChange} title={`${first}'s objectives`} description="Only you see this until the plan is shared." initialDetent={1}>
    {objectives.isError ? <LoadError what={`${first}'s objectives`} onRetry={() => { void objectives.refetch() }} />
      : !objectives.data ? <LoadingSkeleton label={`Loading ${first}'s objectives…`} lines={3} />
      // Keyed by player, so Save · next starts the next one fresh.
      : <Picker key={player.id} coachId={coachId} player={player} first={first} seasonObjectives={seasonObjectives}
        saved={objectives.of(player.id).map(({ title, source, seasonObjectiveId }) => ({ title, source, seasonObjectiveId }))}
        saveLabel={saveLabel} saveNeedsChange={saveNeedsChange} quiet={quiet} onSaved={onSaved} watch={watch} onCancel={() => onOpenChange(false)} />}
  </BottomSheet>
}

function Picker({ coachId, player, first, seasonObjectives, saved, saveLabel, saveNeedsChange, quiet, onSaved, watch, onCancel }: {
  coachId: string; player: ObjectivesPlayer; first: string; seasonObjectives: { id: string; title: string }[]; saved: ObjectivePick[]
  saveLabel: string; saveNeedsChange: boolean; quiet: boolean; onSaved: () => void; watch?: WatchAction; onCancel: () => void
}) {
  const [picked, setPicked] = useState<ObjectivePick[]>(saved)
  const [refused, setRefused] = useState(false)
  const [own, setOwn] = useState('')
  const [failed, setFailed] = useState(false)
  const save = useSavePlayerObjectives(coachId)
  const changed = !same(picked, saved)

  // No position, no objectives: there is no library to pick from (spec TRAK-348).
  if (!isPosition(player.position)) return <div className="grid gap-4 pb-4">
    <p className="text-sm text-ink-2">Give {first} a position first. Their objectives come from it.</p>
    <span className="justify-self-start"><Button variant="secondary" onClick={onCancel}>Close</Button></span>
  </div>

  const library = libraryFor(player.position, seasonObjectives)
  const yours = picked.filter(o => o.source === 'own')
  const pickedTitle = (title: string) => picked.some(o => o.title.toLowerCase() === title.toLowerCase())
  const toggle = (pick: ObjectivePick) => { const next = togglePlayerObjective(picked, pick); setPicked(next.picked); setRefused(next.refused) }
  const addOwn = () => { const next = addOwnObjective(picked, own, library); setPicked(next.picked); setRefused(next.refused); if (!next.refused) setOwn('') }
  const onOwnKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); addOwn() } }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!changed) { onSaved(); return }
    setFailed(false)
    save.mutate({ id: player.id, picked }, {
      onSuccess: () => { if (!quiet) toast.success(`Saved ${first}'s objectives`); onSaved() },
      onError: () => setFailed(true),
    })
  }

  return <form onSubmit={submit} className="grid gap-5 pb-4">
    <div className="grid gap-1">
      <h3 className="text-base font-medium text-ink">Pick one or two objectives for {first}</h3>
      <p className="text-sm text-ink-3">Six for {AS[player.position]}. {picked.length} of {MAX_PLAYER_OBJECTIVES} picked.</p>
    </div>
    <div role="group" aria-label={`Objectives for ${first}`} className="grid gap-2 laptop:grid-cols-2">
      {library.map(o => {
        const on = pickedTitle(o.title)
        return <button key={o.title} type="button" aria-pressed={on} className={card(on)}
          onClick={() => toggle({ title: o.title, source: 'library', seasonObjectiveId: o.seasonObjectiveId })}>
          <span className="text-sm font-medium text-ink">{o.title}</span>
          <span className="text-xs text-ink-3">{o.supports ? `Supports: ${o.supports}` : 'Their own'}</span>
        </button>
      })}
      {yours.map(o => <button key={o.title} type="button" aria-pressed="true" className={card(true)} onClick={() => toggle(o)}>
        <span className="text-sm font-medium text-ink">{o.title}</span>
        <span className="text-xs text-ink-3">Your own</span>
      </button>)}
    </div>
    <p role="status" className="min-h-5 text-sm text-ink-2">{refused ? 'Up to two at once. Untick one first.' : ''}</p>

    <div className="grid gap-2">
      <label htmlFor={`own-objective-${player.id}`} className="text-sm font-medium text-ink">Create your own</label>
      <div className="flex flex-wrap gap-2">
        <input id={`own-objective-${player.id}`} value={own} maxLength={PLAYER_OBJECTIVE_MAX} onChange={e => setOwn(e.target.value)} onKeyDown={onOwnKey}
          placeholder="One sentence the player can picture"
          className="min-h-11 min-w-0 flex-1 basis-60 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        <Button type="button" variant="secondary" onClick={addOwn} disabled={!own.trim()}>Create</Button>
      </div>
    </div>

    {failed && <Alert tone="danger" title="Couldn't save. Check your connection and try again." />}
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      {watch && <Button type="button" variant="secondary" loading={watch.pending} onClick={watch.onWatch}>{watch.label}</Button>}
      <Button type="submit" disabled={saveNeedsChange && !changed} loading={save.isPending}>{saveLabel}</Button>
    </div>
  </form>
}
