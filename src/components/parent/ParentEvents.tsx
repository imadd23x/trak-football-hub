import { useEffect } from 'react'
import { MetadataLabel } from '@/components/trak'
import { ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { UpcomingEventCard } from '@/components/player/UpcomingEventCard'
import { SeeMoreList } from '@/components/trak/SeeMoreList'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useParentEvents } from '@/hooks/useParentData'
import { isChanged, noteEventsShown, readSeenSequences, type PlayerEvent } from '@/lib/player-events'
import { planBadge, useSharedPlans } from '@/lib/games/shared-plans'
import { useReviews } from '@/lib/games/reviews'

/**
 * The selected child's events (TRAK-131, J8.8), with the player's own card
 * (J8.7): "Next up" on home, the "Upcoming" list on Matches. Only that child's
 * events, under that child's consent (child_events). "Changed" is per device
 * for this parent, like the bell. A failed read says so, never an empty list.
 */
export function ParentUpcomingEvents({ nextUpOnly = false }: { nextUpOnly?: boolean }) {
  const { parentId, selectedChild } = useParentChildren()
  const query = useParentEvents()
  // TRAK-286: which matches have a shared plan. A failed read only leaves the badges off.
  const plans = useSharedPlans(selectedChild?.id, false)
  // TRAK-289: once the coach publishes their review, the card says so instead.
  const reviews = useReviews(selectedChild?.id)
  const plan = (e: PlayerEvent) => reviews.data?.events.has(e.id) ? 'review' as const : planBadge(plans.data?.get(e.id), e)
  const events = nextUpOnly ? (query.data ?? []).slice(0, 1) : query.data ?? []
  // Read before this render's events are recorded as seen.
  const seen = parentId ? readSeenSequences(parentId) : {}
  useEffect(() => {
    if (parentId && query.data) noteEventsShown(parentId, nextUpOnly ? query.data.slice(0, 1) : query.data)
  }, [parentId, query.data, nextUpOnly])

  if (nextUpOnly) {
    if (query.isError) return <ParentLoadError message="Couldn't load upcoming events." onRetry={() => { void query.refetch() }} />
    const next = events[0]
    if (!next) return null
    return (
      <section className="mb-4" aria-label="Next up">
        <MetadataLabel text="NEXT UP" />
        <div className="mt-2">
          <UpcomingEventCard event={next} changed={isChanged(next, seen)} nextUp linkBase="/parent/event" plan={plan(next)} />
        </div>
      </section>
    )
  }

  return (
    <section className="mb-5" aria-label="Upcoming">
      <MetadataLabel text="UPCOMING" />
      <div className="mt-2 space-y-2">
        {query.isError ? <ParentLoadError message="Couldn't load upcoming events." onRetry={() => { void query.refetch() }} />
          : query.isPending ? <ParentLoading />
            : events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
              : <SeeMoreList items={events} render={e => <UpcomingEventCard key={e.id} event={e} changed={isChanged(e, seen)} linkBase="/parent/event" plan={plan(e)} />} />}
      </div>
    </section>
  )
}
