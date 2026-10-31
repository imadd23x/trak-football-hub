import { useId } from 'react'
import { Badge } from '@/components/arc/badge/badge'
import type { SharedPlan } from '@/lib/games/share'

/* TRAK-286 (Games 4/8): the Game plan on the player's and the parent's event page, once the coach shares it
   (TRAK-282). The player reads the goals and their job, or, left out, the coach's note to them. TRAK-319 (Imad, 30 Oct):
   the parent reads only whether their child starts, is on the bench or isn't in the squad. The coach's Share step
   previews with this same component. */

const panel = 'rounded-[18px] border border-line bg-surface px-4 py-3'

export function GamePlanSection({ plan, as, coachName, childName, updated = false }: {
  plan: SharedPlan
  as: 'player' | 'parent'
  /** The coach's name, or null when it isn't known: "your coach". */
  coachName: string | null
  /** The child's first name, as the parent reads it. */
  childName: string
  /** A later share changed it, and the match hasn't kicked off. */
  updated?: boolean
}) {
  const id = useId()
  const coach = coachName ? `Coach ${coachName}` : null
  const goals = plan.player?.goals ?? []
  const job = plan.player?.job ?? ''
  return (
    <section aria-labelledby={id} className="arc grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="text-[17px] font-medium text-ink">Game plan</h2>
        {updated && <Badge size="sm" tone="info">Updated</Badge>}
      </div>
      {goals.length > 0 && <div className={panel}>
        <h3 className="text-[13px] font-medium text-ink">{goals.length === 1 ? 'Our goal' : 'Our goals'}</h3>
        <ol className="mt-2 grid gap-2">
          {goals.map((goal, i) => <li key={i} className="grid gap-0.5 text-[13px]">
            <span className="text-ink">{i + 1} · {goal.title || goal.looksLike}</span>
            {goal.title && goal.looksLike && <span className="text-ink-2">{goal.looksLike}</span>}
          </li>)}
        </ol>
      </div>}
      <div className={panel}>
        {plan.role === 'not_selected' ? <p className="text-[13px] font-medium text-ink">Not in the squad this week</p>
          : job ? <>
              <h3 className="text-[13px] font-medium text-ink">Your job{plan.role === 'bench' ? ' · bench' : ''}</h3>
              <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{job}</p>
            </>
          : <p className="text-[13px] font-medium text-ink">{as === 'player' ? '' : `${childName}: `}{plan.role === 'bench' ? 'On the bench' : 'Starting'}</p>}
      </div>
      {/* Imad, 28 Oct: a tinted panel like its neighbours, not Arc's card (a browsable item that lifts on hover), as
          the mockup's note. The parent's line has the mockup's dashed edge. */}
      {plan.player?.note && <div className="rounded-[18px] px-4 py-3" style={{ background: 'rgb(var(--t-attention) / 0.15)' }}>
        <h3 className="text-[13px] font-medium text-ink">From {coach ?? 'your coach'} · just for you</h3>
        <p className="mt-1 whitespace-pre-line text-[13px] text-ink">{plan.player.note}</p>
      </div>}
    </section>
  )
}
