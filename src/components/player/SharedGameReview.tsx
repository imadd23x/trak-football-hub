import { useReview } from '@/lib/games/reviews'
import type { PlayerEvent } from '@/lib/player-events'
import { GameReviewSection } from './GameReviewSection'

/** TRAK-289: After the game on an event page, read as the child or a guardian. Nothing until the coach publishes. */
export function SharedGameReview({ event, childId, childName, as }: {
  event: PlayerEvent; childId: string; childName: string; as: 'player' | 'parent'
}) {
  const query = useReview(event, childId, as === 'player')
  if (query.isError) {
    return <p className="text-[13px] text-ink-2">Couldn’t load the coach’s review.{' '}
      <button type="button" onClick={() => void query.refetch()}
        className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary">Try again</button>
    </p>
  }
  if (!query.data) return null
  return <GameReviewSection review={query.data} as={as} childName={childName} />
}
