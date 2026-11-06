import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { positionsBoard } from '@/lib/positions'
import { seasonPlanKey, shareSeasonPlan, type SeasonObjective, type SeasonPlan } from '@/lib/season-plan'
import { usePlayerObjectives } from './usePlayerObjectives'
import { useWatchList } from './useWatching'
import { WatchRulePicker } from './WatchRulePicker'

/* TRAK-356 (Season plan 8/18, spec TRAK-348): step 4, Share. What goes out: the season's dates, the season objectives,
   positions and player objectives; it shares with none. The face-to-face tick shows only when there's something to
   tell (Tarek, 3 Nov), and only here, at the first share (Tarek, 6 Nov). Share needs both dates (Tarek, 6 Nov). Until
   TRAK-366 ships their screens, players and families see nothing of the plan in the app, and the step says so. The
   players watched first (TRAK-355) are named with the squad's reminder; nothing goes out about them. */

const SHARE_FAILED = "Couldn't share the plan. Check your connection and try again."
const NO_DATES = 'Add the season’s dates first'
const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function ShareStep({ coachId, squad, plan, seasonObjectives, onBack, onSeason, onShared }: {
  coachId: string
  squad: string
  plan: SeasonPlan | null
  seasonObjectives: SeasonObjective[]
  onBack: () => void
  /** Step 1, for the dates. */
  onSeason: () => void
  onShared: () => void
}) {
  const client = useQueryClient()
  const roster = useSquadRoster()
  const objectives = usePlayerObjectives(coachId)
  const watching = useWatchList(coachId, roster)
  const [talked, setTalked] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const share = useMutation({
    mutationFn: () => shareSeasonPlan(plan!.id, talked),
    // Awaited, so the page turns into the shared plan as soon as the button stops loading.
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: seasonPlanKey(coachId, squad) })
      onShared()
    },
    // The database says why it held a share back (the dates, the talk) in words for the coach.
    onError: (error: { code?: string; message?: string }) => setProblem(error.code === 'P0001' && error.message ? error.message : SHARE_FAILED),
  })

  if (roster.error || objectives.error) return <LoadError what="what goes out" onRetry={() => { roster.retry(); void objectives.refetch() }} />
  if (roster.isPending || objectives.isPending) return <LoadingSkeleton label="Loading what goes out…" lines={4} className="pt-2" />
  const board = positionsBoard(roster.players, roster.consentPending)
  const placed = board.lines.flatMap(line => line.players)
  const withSome = placed.filter(p => objectives.of(p.id).length > 0).length
  const dated = !!plan?.starts_on && !!plan.ends_on
  const toTell = seasonObjectives.length > 0 || roster.players.some(p => objectives.of(p.id).length > 0)
  const watched = roster.players.filter(p => watching.list.some(w => w.playerId === p.id))
  const holdBack = !dated ? NO_DATES : toTell && !talked ? 'Tick that you’ve talked it through first' : null

  return (
    <div className="arc grid gap-5">
      <p className="text-sm text-ink-2">Check what goes out, then share it. Players and families don’t see the season plan in the app yet, so tell them face to face.</p>

      <section aria-labelledby="share-what" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
        <h2 id="share-what" className="text-lg font-medium text-ink">What goes out</h2>
        <dl className="m-0 grid gap-3">
          <div className="grid gap-0.5 tablet:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-ink-3">Season</dt>
            <dd className="m-0 text-sm text-ink">{dated ? `${day(plan!.starts_on!)} – ${day(plan!.ends_on!)}` : <span className="text-warning">No dates yet</span>}</dd>
          </div>
          <div className="grid gap-0.5 tablet:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-ink-3">Season objectives</dt>
            <dd className="m-0 text-sm text-ink">{seasonObjectives.length
              ? <ul className="m-0 grid list-none gap-0.5 p-0">{seasonObjectives.map(o => <li key={o.id}>{o.title}</li>)}</ul>
              : 'None'}</dd>
          </div>
          <div className="grid gap-0.5 tablet:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-ink-3">Positions</dt>
            <dd className="m-0 text-sm text-ink">{board.placed} of {players(board.total)} placed</dd>
          </div>
          <div className="grid gap-0.5 tablet:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-ink-3">Player objectives</dt>
            <dd className="m-0 text-sm text-ink">{withSome} of {players(placed.length)} {withSome === 1 ? 'has' : 'have'} one or two</dd>
          </div>
          <div className="grid gap-0.5 tablet:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-ink-3">Who sees it</dt>
            <dd className="m-0 text-sm text-ink">Only you, for now. Players and families don’t see the season plan in the app yet.</dd>
          </div>
        </dl>
      </section>

      {watched.length > 0 && <section aria-labelledby="share-watching" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 id="share-watching" className="text-lg font-medium text-ink">Watching first <span className="font-normal text-ink-3">· {watched.length}</span></h2>
        <p className="text-sm text-ink-2">{watched.map(p => p.player_name).join(', ')}</p>
        <p className="text-sm text-ink-3">They get objectives once you set them up. Nothing goes out about them until then.</p>
        <WatchRulePicker coachId={coachId} squad={squad} plan={plan} />
      </section>}

      {toTell && <section aria-label="Before you share" className="rounded-2xl border border-line bg-surface p-5">
        <Checkbox label="I’ve talked objectives through with the players, face to face" description="Before this goes out. Players should hear it from you first."
          checked={talked} onCheckedChange={value => setTalked(value === true)} />
      </section>}

      {problem && <Alert tone="danger" title={problem} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Player objectives</Button>
        <span className="flex flex-wrap items-center justify-end gap-3">
          {holdBack === NO_DATES ? <Button variant="secondary" onClick={onSeason}>{NO_DATES}</Button>
            : holdBack && <span className="text-sm text-ink-3">{holdBack}</span>}
          <Button loading={share.isPending} disabled={!!holdBack || !plan} onClick={() => { setProblem(null); share.mutate() }}>Share now</Button>
        </span>
      </div>
    </div>
  )
}
