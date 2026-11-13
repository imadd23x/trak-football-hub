import { planBadge, useSharedPlan } from '@/lib/games/shared-plans'
import { useMarkOpened, useScrollTo } from '@/lib/games/news'
import type { PlayerEvent } from '@/lib/player-events'
import { GamePlanSection } from './GamePlanSection'

/** TRAK-286: the Game plan on an event page, read as the child or a guardian. Nothing until it's shared with them. */
export function SharedGamePlan({ event, childId, childName, as }: {
  event: PlayerEvent; childId: string; childName: string; as: 'player' | 'parent'
}) {
  const query = useSharedPlan(event, childId, as === 'player')
  // TRAK-441: shown here, so no longer new in For you or the bell.
  useMarkOpened(childId, 'plan', event.id, !!query.data)
  useScrollTo('game-plan', !!query.data)
  if (query.isError) {
    return <p className="text-[13px] text-ink-2">Couldn’t load the game plan.{' '}
      <button type="button" onClick={() => void query.refetch()}
        className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary">Try again</button>
    </p>
  }
  if (!query.data) return null
  return <div id="game-plan" className="scroll-mt-4"><GamePlanSection plan={query.data.plan} as={as} coachName={query.data.coachName} childName={childName}
    updated={planBadge(query.data.plan.updated, event) === 'updated'} /></div>
}
