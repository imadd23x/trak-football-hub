import { useState } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { gameTitle, gameWhen, useGames } from '@/components/coach/games/useGames'
import { useSavedLineUps, type Formation } from './useFormations'

/* TRAK-360 (Season plan 12/18, spec TRAK-348): Use for matches. The squad's upcoming matches that aren't cancelled; the
   coach picks one or more and each gets a copy of the saved formation, a draft only they see. A match that already has
   a saved line-up is named first, and the copy replaces it only after the coach says so. */

export function UseForMatchesSheet({ formation, squad, using, problem, onClose, onUse }: {
  formation: Formation
  squad: string
  using: boolean
  problem: string | null
  onClose: () => void
  onUse: (eventIds: string[]) => void
}) {
  const games = useGames()
  // Upcoming: not kicked off, as the database requires. Read once, so the list doesn't shift while it is open.
  const [now] = useState(() => Date.now())
  // A match with no squad stored (a coach with one squad doesn't pick one) is the coach's, so it's offered here too.
  const matches = (games.data ?? []).filter(game => (game.squad == null || game.squad === squad) && Date.parse(game.starts_at) > now)
  const saved = useSavedLineUps(matches.map(game => game.id))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const replacing = matches.filter(game => picked.has(game.id) && saved.data?.has(game.id))
  const toggle = (id: string, on: boolean) => {
    setConfirming(false)
    setPicked(was => { const next = new Set(was); if (on) next.add(id); else next.delete(id); return next })
  }
  const submit = () => (replacing.length > 0 && !confirming ? setConfirming(true) : onUse(matches.filter(game => picked.has(game.id)).map(game => game.id)))
  const failed = games.isError || saved.isError

  return <BottomSheet className="arc" open onOpenChange={open => { if (!open) onClose() }} title={`Use ${formation.name} for matches`}
    description="Each match gets its own copy. Editing the formation later never changes a match.">
    <div className="grid gap-4 pb-4">
      {failed ? <Alert tone="danger" title="Couldn't load your matches. Check your connection and try again." />
        : games.isPending || (matches.length > 0 && saved.isPending) ? <p role="status" className="text-sm text-ink-2">Loading your matches…</p>
        : matches.length === 0 ? <p className="text-sm text-ink-2">{squad} has no upcoming matches. Add one in Matches first.</p>
        : <div role="group" aria-label="Upcoming matches" className="grid gap-3">
          {matches.map(game => {
            const { day, time } = gameWhen(game)
            return <Checkbox key={game.id} label={gameTitle(game)} checked={picked.has(game.id)} onCheckedChange={on => toggle(game.id, on === true)}
              description={`${day}, ${time}${saved.data?.has(game.id) ? ' · has a saved line-up' : ''}`} />
          })}
        </div>}
      {confirming && <Alert tone="warning" title={`Replace the line-up in ${replacing.map(game => gameTitle(game)).join(' and ')}?`}>
        Their starters change to this formation's. Each player's job, note and the instructions stay.</Alert>}
      {problem && <Alert tone="danger" title={problem} />}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={submit} disabled={picked.size === 0 || failed} loading={using}>
          {confirming ? 'Replace and copy' : `Copy to ${picked.size === 1 ? '1 match' : `${picked.size} matches`}`}</Button>
      </div>
    </div>
  </BottomSheet>
}
