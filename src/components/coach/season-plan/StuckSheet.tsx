import { useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/arc/alert/alert'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { PLAYER_OBJECTIVE_MAX } from '@/lib/player-objectives'
import { useResolveStuck } from './useObjectiveProgress'

/* TRAK-365 (Season plan 17/18, spec TRAK-348): an objective with Not yet in three evaluations in a row. The coach
   chooses: Make it simpler (an easier version takes its place), Keep going, or Swap it (it closes, and the player's page
   picks another). Each choice is recorded by the database, which also checks the objective really is stuck. */

export type StuckTarget = { objectiveId: string; objective: string; playerId: string; playerName: string }

export function StuckSheet({ coachId, target, onClose, onSwapped }: {
  coachId: string
  target: StuckTarget | null
  onClose: () => void
  /** After Swap it: the player's page, to pick the new objective. */
  onSwapped: (playerId: string) => void
}) {
  const [easier, setEasier] = useState<string | null>(null)
  const resolve = useResolveStuck(coachId)
  const close = () => { setEasier(null); resolve.reset(); onClose() }
  if (!target) return null
  const first = target.playerName.split(' ')[0]
  const title = (easier ?? '').trim().replace(/\s+/g, ' ')
  const choose = (choice: Parameters<typeof resolve.mutate>[0]['choice'], done: string, after?: () => void) =>
    resolve.mutate({ id: target.objectiveId, choice }, { onSuccess: () => { toast.success(done); close(); after?.() } })
  const problem = resolve.error as { code?: string; message?: string } | null
  return (
    <BottomSheet className="arc" open onOpenChange={open => { if (!open) close() }} title={`${first} is stuck on one`}
      description={`“${target.objective}”: Not yet in three evaluations in a row.`}>
      <div className="grid gap-4">
        {easier === null ? (
          <div className="grid gap-3">
            <Button onClick={() => setEasier(target.objective)}>Make it simpler</Button>
            <p className="-mt-1 text-sm text-ink-3">An easier version takes its place, for example 5 seconds becomes 8.</p>
            <Button variant="secondary" loading={resolve.isPending} onClick={() => choose({ choice: 'keep_going' }, 'Keeping going')}>Keep going</Button>
            <p className="-mt-1 text-sm text-ink-3">It stays as it is. It comes back only after three more Not yets in a row.</p>
            <Button variant="secondary" loading={resolve.isPending} onClick={() => choose({ choice: 'swap' }, 'Objective swapped', () => onSwapped(target.playerId))}>Swap it</Button>
            <p className="-mt-1 text-sm text-ink-3">It closes, and you pick another on {first}’s page.</p>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (title) choose({ choice: 'simpler', title }, 'Easier version saved') }}>
            <Input label="The easier version" value={easier} maxLength={PLAYER_OBJECTIVE_MAX} autoFocus onChange={event => setEasier(event.target.value)} />
            <div className="flex justify-between gap-3">
              <Button type="button" variant="ghost" onClick={() => setEasier(null)}>Back</Button>
              <Button type="submit" loading={resolve.isPending} disabled={!title || title.toLowerCase() === target.objective.toLowerCase()}>Save</Button>
            </div>
          </form>
        )}
        {problem && <Alert tone="danger" title={problem.message && ['P0001', '22023', '42501'].includes(problem.code ?? '') ? `${problem.message}.` : 'Couldn’t save that. Check your connection and try again.'} />}
      </div>
    </BottomSheet>
  )
}
