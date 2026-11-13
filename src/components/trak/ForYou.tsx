import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/arc/button/button'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { eventDay, eventHeading } from '@/lib/player-events'
import { newsAlert, useFamilyNews, type NewsItem } from '@/lib/games/news'

/* TRAK-441 slice 2 (spec "For you", Imad 12 Nov) and TRAK-436: the family's "Needs you". One card per new thing from
   the coach (a game plan shared or changed, a match review), each with one button to the match page at it. A card goes
   once that page has shown it (useFamilyNews). Nothing when there's nothing new. It reads the news itself, so its
   arrival redraws these cards, not the Home under them. */

const title = (item: NewsItem) => item.event.kind === 'match' && item.event.opponent ? `vs ${item.event.opponent}` : eventHeading(item.event)

export function ForYou({ childId, as, childFirst = '' }: { childId: string; as: 'player' | 'parent'; childFirst?: string }) {
  const navigate = useNavigate()
  const { news } = useFamilyNews(childId, as === 'player')
  if (!news.length) return null
  return <section aria-labelledby="for-you" className="arc">
    <h2 id="for-you" className="mb-2 text-lg font-medium text-ink">For you <span className="font-normal text-ink-3">{news.length}</span></h2>
    <div className="-mx-1">
      <ScrollArea orientation="horizontal" snap="x mandatory" fade={24} label="New from your coach">
        <ul className="flex gap-3 px-1 pb-1">
          {news.map(item => {
            const alert = newsAlert(item, as, childFirst)
            const when = item.kind === 'review' ? alert.description.split(' · ').pop() : `${eventDay(item.event)}, ${item.event.time ?? 'time to be confirmed'}`
            return <li key={alert.id} className="w-[248px] flex-none" style={{ scrollSnapAlign: 'start' }}>
              <div className="flex h-full flex-col gap-3 rounded-2xl border-[1.5px] border-brand/40 bg-surface p-4">
                <span className="grid min-w-0">
                  <span className="truncate text-base font-medium text-ink">{title(item)}</span>
                  <span className="truncate text-sm text-ink-3">{when}</span>
                </span>
                <span className="flex items-start gap-2 text-sm text-ink-2">
                  <span className="mt-1.5 size-2 flex-none rounded-full bg-brand" aria-hidden="true" /><span>{alert.title}</span>
                </span>
                <span className="mt-auto"><Button size="sm" onClick={() => navigate(alert.path)}>{alert.action}</Button></span>
              </div>
            </li>
          })}
        </ul>
      </ScrollArea>
    </div>
  </section>
}
