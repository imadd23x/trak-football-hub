import { useId } from 'react'
import { words, type Review } from '@/lib/games/reviews'

/* TRAK-289 (Games 7/8): After the game, on the player's and the parent's event page once the coach publishes the
   evaluation (TRAK-282). The player reads it all: their job, how it went against what was asked, and the coach's note
   to them; the parent reads the same without the note. The coach's Publish step previews with this same component. */

const panel = 'rounded-[18px] border border-line bg-surface px-4 py-3'

export function GameReviewSection({ review, as, childName }: {
  review: Review
  as: 'player' | 'parent'
  /** The child's first name, as the parent reads it. */
  childName: string
}) {
  const id = useId()
  const said = words(review)
  const coach = review.coachName ? `Coach ${review.coachName}` : null
  return (
    <section aria-labelledby={id} className="arc grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-[17px] font-medium text-ink">After the game</h2>
        <span className="text-[13px] text-ink-2">Final score {review.ourScore}–{review.theirScore}</span>
      </div>
      {review.job && <div className={panel}>
        <h3 className="text-[13px] font-medium text-ink">{as === 'player' ? 'Your' : `${childName}’s`} job</h3>
        <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{review.job}</p>
      </div>}
      <div className={`${panel} grid gap-1`}>
        <p className="text-[15px] font-medium text-ink">{said.didJob}</p>
        <p className="text-[13px] text-ink-2">What we asked: {said.asked}</p>
        <p className="text-[13px] text-ink">{said.against}.</p>
      </div>
      {review.note
        ? <div className="rounded-[18px] px-4 py-3" style={{ background: 'rgb(var(--t-attention) / 0.15)' }}>
            <h3 className="text-[13px] font-medium text-ink">From {coach ?? 'your coach'} · just for you</h3>
            <p className="mt-1 whitespace-pre-line text-[13px] text-ink">{review.note}</p>
          </div>
        : as === 'parent' && review.hasNote
          && <p className="rounded-[18px] border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-2">{coach ?? 'Your coach'}’s note is just for {childName}.</p>}
    </section>
  )
}
