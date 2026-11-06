import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/arc/button/button'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { lastShared, shortDate, useSeasonPlan } from '@/lib/season-plan'

/* TRAK-350 (Season plan 2/18): the season plan's place on Home, under Needs you, where the academy's switch is on.
   Start, then Continue while it's a draft. With All picked it asks for one squad. TRAK-361 makes it the card that
   folds. TRAK-356: once shared, View plan, and the line says when, or that changes wait to be shared. */
export function SeasonPlanRow({ coachId, squad, className }: { coachId: string; squad: string | null; className?: string }) {
  const navigate = useNavigate()
  const season = useSeasonPlan(coachId, squad)
  if (!season.on) return null
  // TRAK-335: a skeleton while it loads, never "Loading…".
  if (season.isPending) return <LoadingSkeleton label="Loading your season plan…" lines={2} className={className} />
  const open = () => navigate('/coach/season-plan')
  const [line, action] = !squad ? ['Pick one squad at the top to plan its season.', null]
    : season.error ? ["Couldn't load your season plan.", <Button key="retry" variant="secondary" size="sm" onClick={season.retry}>Try again</Button>]
    : !season.plan ? [`${squad} · Not started`, <Button key="start" size="sm" onClick={open}>Start</Button>]
    : !season.plan.shared_at ? [`${squad} · Draft, only you see it`, <Button key="continue" variant="secondary" size="sm" onClick={open}>Continue</Button>]
    : [`${squad} · ${season.plan.unshared_parts.length || season.plan.unshared_players.length ? 'Changes not shared' : `Shared ${shortDate(lastShared(season.plan)!)}`}`,
      <Button key="view" variant="secondary" size="sm" onClick={open}>View plan</Button>]
  return (
    <section aria-labelledby="season-plan-row" className={`arc flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 ${className ?? ''}`}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 id="season-plan-row" className="text-base font-medium text-ink">Season plan</h2>
        <p className="truncate text-sm text-ink-3" role={season.error ? 'alert' : undefined}>{line}</p>
      </div>
      {action}
    </section>
  )
}
