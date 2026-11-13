import { useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { ChipGroup } from '@/components/arc/chip-group/chip-group'
import { Button } from '@/components/arc/button/button'
import { LoadError } from '@/components/trak/LoadError'
import type { NeedsYouItem } from '@/lib/coach-needs-you'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useTranslation } from '@/lib/i18n'

/** An event still waiting for its register or match log (Imad, 24 Oct), with the week's own next step. TRAK-290: an
 *  evaluation draft past its 09:00 reminder is urgent. */
export type OwedEvent = { id: string; title: string; when: string; squad: string | null; reason: string; action: ReactNode; urgent?: boolean
  /** TRAK-444: what the card is about, for the type filter. Cards that fit none (positions, watching) show under All only. */
  kind?: NeedsKind
  /** TRAK-444: when the thing it is about happened (ms), for the date sort. Without one, a card counts as now. */
  at?: number }

export type NeedsKind = 'match' | 'assessment' | 'training' | 'other'
type Filter = 'all' | Exclude<NeedsKind, 'other'>
type Order = 'urgent' | 'newest' | 'oldest'
/** TRAK-444: a full season of owed items was 100 cards; this many show first, and Show all opens the rest. */
export const FIRST_CARDS = 5

/** TRAK-262 (Imad, 22 Oct): Home's Needs you, one swipeable card per player (`needsYou()` says who). Imad, 24 Oct:
 *  events the week marks "Needs you" come first, with their Take register or Log it. */
export function NeedsYou({ items, events = [], failed, onRetry, onOpen }: {
  /** null while loading. */
  items: NeedsYouItem[] | null
  events?: OwedEvent[]
  failed: boolean
  onRetry: () => void
  onOpen: (item: NeedsYouItem) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [order, setOrder] = useState<Order>('urgent')
  const [all, setAll] = useState(false)
  // The heading's count is what is owed, whatever the filter shows (TRAK-444).
  const count = items ? items.length + events.length : null
  const filtering = count !== null && count > FIRST_CARDS
  const wanted = (kind: NeedsKind) => !filtering || filter === 'all' || filter === kind
  const when = (card: { at?: number }) => card.at ?? Date.now()
  const byDate = (a: { at?: number }, b: { at?: number }) => order === 'oldest' ? when(a) - when(b) : when(b) - when(a)
  const sortedEvents = events.filter(event => wanted(event.kind ?? 'other')).sort(order === 'urgent'
    ? (a, b) => Number(!!b.urgent) - Number(!!a.urgent) || byDate(a, b) : byDate)
  // Player cards already come most urgent first (needsYou()); the date orders re-sort them by their date.
  const sortedItems = items ? items.filter(() => wanted('assessment')).sort((a, b) => order === 'urgent' ? 0 : byDate(a, b)) : []
  const cards = [...sortedEvents.map(event => ({ event })), ...sortedItems.map(item => ({ item }))]
  const shown = !filtering || all ? cards : cards.slice(0, FIRST_CARDS)
  const typeOptions = [{ value: 'all', label: t('coachHome:filterAll') }, { value: 'match', label: t('coachHome:filterMatches') },
    { value: 'assessment', label: t('coachHome:filterAssessments') }, { value: 'training', label: t('coachHome:filterTraining') }]
  const orderOptions = [{ value: 'urgent', label: t('coachHome:sortUrgent') }, { value: 'newest', label: t('coachHome:sortNewest') },
    { value: 'oldest', label: t('coachHome:sortOldest') }]
  return <section aria-labelledby="needs-you-title">
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 id="needs-you-title" className="text-lg font-medium text-ink">{t('coachHome:needsYouTitle')} {count !== null && <span className="text-ink-3 font-normal">{count}</span>}</h2>
      {count !== null && count > 1 && <span className="text-sm text-ink-3"><span className="[@media(pointer:fine)]:hidden">{t('coachHome:swipeForMore')}</span><span className="[@media(pointer:coarse)]:hidden">{t('coachHome:scrollForMore')}</span>{t('coachHome:forMore')}</span>}
    </div>
    {failed ? <LoadError what={t('coachHome:needsYouWhat')} onRetry={onRetry} />
      : !items ? <LoadingSkeleton label={t('coachHome:needsYouLoading')} lines={2} rows={2} className="h-[148px] content-start overflow-hidden rounded-2xl border border-line bg-surface p-5" />
      : count === 0 ? <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-2">{t('coachHome:needsYouNone')}</p>
      : <div className="arc -mx-1">
        {/* TRAK-444: only when there are more than a handful; the filters narrow the list, Show all opens the rest. */}
        {filtering && <div className="mb-3 grid gap-2 px-1">
          <ChipGroup label={t('coachHome:filterType')} multiple={false} options={typeOptions} value={[filter]}
            onValueChange={([next]) => { setFilter((next ?? 'all') as Filter); setAll(false) }} />
          <ChipGroup label={t('coachHome:sortBy')} multiple={false} options={orderOptions} value={[order]}
            onValueChange={([next]) => { setOrder((next ?? 'urgent') as Order); setAll(false) }} />
        </div>}
        {cards.length === 0 ? <p className="mx-1 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-2">{t('coachHome:needsYouNoneFiltered')}</p>
        : <ScrollArea orientation="horizontal" snap="x mandatory" fade={24} label={t('coachHome:needsYouList')}>
          <ul className="flex gap-3 px-1 pb-1">
            {shown.flatMap(card => 'event' in card ? [card.event] : []).map(event => <li key={`event:${event.id}`} className="w-[248px] flex-none" style={{ scrollSnapAlign: 'start' }}>
              {/* The week's "needs you" yellow (TRAK-270), so the card reads as the same thing. */}
              <div className="flex h-full w-full flex-col gap-3 rounded-2xl border-[1.5px] bg-surface p-4" style={{ borderColor: 'rgb(var(--t-attention))' }}>
                <span className="grid min-w-0">
                  <span className="truncate text-base font-medium text-ink">{event.title}</span>
                  <span className="truncate text-sm text-ink-3">{[event.squad, event.when].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex items-start gap-2 text-sm text-ink-2">
                  <span className={`mt-1.5 size-2 flex-none rounded-full ${event.urgent ? 'bg-danger' : 'bg-warning'}`} aria-hidden />
                  <span>{event.urgent && <span className="sr-only">{t('coachHome:urgent')}</span>}{event.reason}</span>
                </span>
                <span className="mt-auto">{event.action}</span>
              </div>
            </li>)}
            {shown.flatMap(card => 'item' in card ? [card.item] : []).map(item => <li key={`${item.kind}:${item.playerId}`} className="w-[248px] flex-none" style={{ scrollSnapAlign: 'start' }}>
              <button type="button" onClick={() => onOpen(item)}
                className="flex h-full w-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-transform active:scale-[.98] motion-reduce:transition-none">
                <span className="flex items-center gap-3">
                  <PlayerFace name={item.name} size="md" />
                  <span className="grid min-w-0">
                    <span className="truncate text-base font-medium text-ink">{item.name}</span>
                    {item.detail && <span className="truncate text-sm text-ink-3">{item.detail}</span>}
                  </span>
                </span>
                <span className="flex items-start gap-2 text-sm text-ink-2">
                  <span className={`mt-1.5 size-2 flex-none rounded-full ${item.urgent ? 'bg-danger' : item.kind === 'draft' ? 'bg-info' : 'bg-warning'}`} aria-hidden />
                  <span>{item.urgent && <span className="sr-only">{t('coachHome:urgent')}</span>}{item.reason}</span>
                </span>
                <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand">
                  {item.kind === 'draft' ? t('coachHome:finishDraft') : t('coachHome:assess')} <ArrowRight size={16} aria-hidden />
                </span>
              </button>
            </li>)}
          </ul>
        </ScrollArea>}
        {filtering && cards.length > FIRST_CARDS && <div className="mt-2 px-1">
          <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)} aria-expanded={all}>
            {all ? t('coachHome:showFewer') : t('coachHome:showAll', { count: cards.length })}
          </Button>
        </div>}
      </div>}
  </section>
}
