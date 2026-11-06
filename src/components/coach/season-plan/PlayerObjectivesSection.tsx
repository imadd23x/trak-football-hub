import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { isPosition } from '@/lib/positions'
import { loadSeasonObjectives, seasonObjectivesKey, useSeasonPlan } from '@/lib/season-plan'
import { PlayerObjectivesSheet } from './PlayerObjectivesSheet'
import { usePlayerObjectives } from './usePlayerObjectives'

/* TRAK-354 (Season plan 6/18): a player's objectives on their own page, with one edit for both, under the same rules
   as step 3. Each says which season objective it supports, or whose it is, and since when. No position, no
   objectives: the page says so and points at Positions. Shown only where the season plan is on. TRAK-356: once the plan
   is shared, a removed objective stays here, with when it was given and removed, and the set-up's Positions step is
   gone, so the line points at the position above. */

const since = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function PlayerObjectivesSection({ coachId, id, name, position, squad }: {
  coachId: string; id: string; name: string; position: string | null; squad: string | null
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const first = name.split(' ')[0]
  const objectives = usePlayerObjectives(coachId)
  const season = useSeasonPlan(coachId, squad)
  const seasonObjectives = useQuery({
    queryKey: seasonObjectivesKey(coachId, season.plan?.id),
    queryFn: () => loadSeasonObjectives(season.plan!.id),
    enabled: !!season.plan,
  })
  const plan = (seasonObjectives.data ?? []).map(o => ({ id: o.id, title: o.title }))
  const held = objectives.of(id)
  const gone = objectives.removedOf(id)
  const shared = !!season.plan?.shared_at
  const placed = isPosition(position)
  const action = !placed ? null : held.length > 1 ? 'Edit objectives' : held.length ? 'Edit objective' : `Give ${first} an objective`

  return <section aria-labelledby={`objectives-${id}`} className="my-3 grid gap-2">
    <div className="flex items-baseline justify-between gap-3">
      <h4 id={`objectives-${id}`} className="text-base font-medium text-ink">{held.length > 1 ? 'Objectives' : 'Objective'}</h4>
      {action && <button type="button" onClick={() => setEditing(true)} aria-haspopup="dialog"
        className="min-h-11 rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{action}</button>}
    </div>
    {objectives.isError || seasonObjectives.isError ? <LoadError what={`${first}'s objectives`} onRetry={() => { void objectives.refetch(); void seasonObjectives.refetch() }} />
      : objectives.isPending ? <LoadingSkeleton label={`Loading ${first}'s objectives…`} lines={2} />
      : !placed ? shared ? <p className="text-sm text-ink-2">Give {first} a position above first. Their objectives come from it.</p>
      : <div className="grid justify-items-start gap-1">
        <p className="text-sm text-ink-2">Give {first} a position first. Their objectives come from it.</p>
        <button type="button" onClick={() => navigate('/coach/season-plan/positions')}
          className="min-h-11 rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Go to Positions</button>
      </div>
      : held.length === 0 && gone.length === 0 ? <p className="text-sm text-ink-2">No objective yet.</p>
      : <>{held.length === 0 ? <p className="text-sm text-ink-2">No objective yet.</p> : <ul className="m-0 grid list-none gap-3 p-0">
        {held.map(o => {
          const supports = plan.find(s => s.id === o.seasonObjectiveId)?.title
          return <li key={o.id} className="grid gap-0.5 border-t border-line pt-2.5">
            <span className="text-[17px] font-medium text-ink">{o.title}</span>
            <span className="text-sm text-ink-3">{supports ? `Supports: ${supports}` : o.source === 'own' ? 'Your own' : 'Their own'} · since {since(o.since)}</span>
          </li>
        })}
      </ul>}
      {gone.length > 0 && <div className="grid gap-1 border-t border-line pt-2.5">
        <h5 className="text-sm font-medium text-ink-2">Removed</h5>
        <ul className="m-0 grid list-none gap-1 p-0">{gone.map(o => (
          <li key={o.id} className="text-sm text-ink-3"><span className="text-ink-2">{o.title}</span> · given {since(o.since)}, removed {since(o.removed)}</li>))}
        </ul>
      </div>}</>}
    {placed && <PlayerObjectivesSheet coachId={coachId} player={{ id, name, position }} seasonObjectives={plan} open={editing} onOpenChange={setEditing}
      saveNeedsChange onSaved={() => setEditing(false)} />}
  </section>
}
