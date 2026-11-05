import { useEffect, useState } from 'react'
import type { EventRow } from '@/lib/coach-events'
import { matchClock } from '@/lib/games/loop'
import { LockIcon } from '@/components/icons/LockIcon'

/* TRAK-373 (Imad, 5 Nov): Game plan review's top right after kick-off. While the match is on, the minute, counted as on
   TV ("15'" 14 minutes in, or "HT"), over a green bar of the playing time gone; once it's over, "Locked" with the lock.
   It moves on its own. */

export function MatchClock({ game }: { game: EventRow }) {
  const [now, setNow] = useState(() => Date.now())
  const clock = matchClock({ ...game, ends_at: game.ends_at ?? null }, now)
  const over = clock === 'over'
  useEffect(() => {
    if (over) return
    // ponytail: a 5 s tick, so the minute can turn up to 5 s late; wake at each boundary if that ever matters.
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [over])

  if (clock === 'before') return null
  if (clock === 'over') return <p className="flex items-center gap-2 text-base font-medium text-ink"><LockIcon size={18} />Locked</p>
  const ht = clock.minute === 'HT'
  return (
    <div className="grid w-full max-w-[224px] justify-items-center gap-2">
      <p aria-hidden="true" className="text-[28px] font-normal leading-7 tracking-[-0.02em] text-ink tabular-nums">{ht ? 'HT' : `${clock.minute}'`}</p>
      <div role="progressbar" aria-label="Match clock" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clock.share * 100)}
        aria-valuetext={ht ? 'Half-time' : `Minute ${clock.minute}`}
        className="h-[7px] w-full overflow-hidden rounded-full border border-line bg-raised">
        <span className="block h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${clock.share * 100}%` }} />
      </div>
    </div>
  )
}
