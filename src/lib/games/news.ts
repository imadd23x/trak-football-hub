import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { eventDay, eventHeading, toPlayerEvent, type PlayerEvent } from '@/lib/player-events'
import { rosterRows } from './shared-plans'

/* TRAK-441 slice 2 ("For you", Imad 12 Nov) and TRAK-436: what the coach sent a child that the family hasn't opened
   yet: a game plan shared or changed, and a match review published. Read from the same copies the match page reads
   (the database opens only this child's). A review replaces its match's plan. A card goes once the match page has
   shown it, on this device, as the bell remembers what's been read; a later change makes the plan new again. */

export type News = { kind: 'plan' | 'plan_changed' | 'review'; eventId: string; at: string }
/** With its match, the child's role in the plan (starter, bench, not_selected), the coach's name and the score. */
export type NewsItem = News & { event: PlayerEvent; role: string | null; coachName: string | null; score: [number, number] | null }
type Opened = 'plan' | 'review' | 'evaluation'

// ponytail: a fixed window, so a first visit isn't every past match; a per-reader "seen since" if families ask for older.
const RECENT_MS = 14 * 86_400_000

export function newsOf({ plans, ownChanges = [], reviews }: {
  plans: { event_id: string; shared_at: string; changed_at: string | null }[]
  /** The player's own copy (his job, the note) changed: a change for him too. */
  ownChanges?: { event_id: string; changed_at: string | null }[]
  reviews: { event_id: string; published_at: string }[]
}, now = Date.now()): News[] {
  const reviewed = new Set(reviews.map(row => row.event_id))
  const own = new Map(ownChanges.flatMap(row => row.changed_at ? [[row.event_id, row.changed_at] as const] : []))
  const news: News[] = reviews.map(row => ({ kind: 'review', eventId: row.event_id, at: row.published_at }))
  for (const plan of plans) {
    if (reviewed.has(plan.event_id)) continue
    const changed = [plan.changed_at, own.get(plan.event_id)].filter((at): at is string => !!at).sort().pop()
    news.push(changed ? { kind: 'plan_changed', eventId: plan.event_id, at: changed } : { kind: 'plan', eventId: plan.event_id, at: plan.shared_at })
  }
  return news.filter(item => Date.parse(item.at) >= now - RECENT_MS).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

const storeKey = (readerId: string) => `trak:family-news-opened:${readerId}`
const openedKey = (childId: string, what: Opened, eventId: string) => `${childId}:${what}:${eventId}`

function readOpened(readerId: string): Record<string, number> {
  try {
    const stored = JSON.parse(localStorage.getItem(storeKey(readerId)) ?? '{}')
    return stored && typeof stored === 'object' ? stored : {}
  } catch { return {} }
}

/** The match page showed this plan or review to this reader. */
export function markOpened(readerId: string, childId: string, what: Opened, eventId: string, now = Date.now()) {
  try { localStorage.setItem(storeKey(readerId), JSON.stringify({ ...readOpened(readerId), [openedKey(childId, what, eventId)]: now })) } catch { /* private window: it stays new */ }
}

/** TRAK-441: this reader's device has shown this thing since `at` (an evaluation's page, for Home's "New"). */
export function wasOpened(readerId: string, childId: string, what: Opened, id: string, at: string): boolean {
  return readOpened(readerId)[openedKey(childId, what, id)] >= Date.parse(at)
}

export function unopened<T extends News>(readerId: string, childId: string, news: T[]): T[] {
  const opened = readOpened(readerId)
  return news.filter(item => !(opened[openedKey(childId, item.kind === 'review' ? 'review' : 'plan', item.eventId)] >= Date.parse(item.at)))
}

export async function fetchNews(childId: string, asPlayer: boolean, signal: AbortSignal): Promise<NewsItem[]> {
  const ids = (await rosterRows(childId, signal)).map(row => row.id)
  if (!ids.length) return []
  const [plans, own, reviews] = await Promise.all([
    supabase.from('game_for_family').select('event_id, shared_at, changed_at, role, coach_name').in('squad_player_id', ids).abortSignal(signal).retry(false),
    asPlayer ? supabase.from('game_for_player').select('event_id, changed_at').in('squad_player_id', ids).abortSignal(signal).retry(false) : null,
    supabase.from('game_review_for_family').select('event_id, published_at, our_score, their_score, coach_name').in('squad_player_id', ids).abortSignal(signal).retry(false),
  ])
  for (const read of [plans, own, reviews]) if (read?.error) throw read.error
  const news = newsOf({ plans: plans.data ?? [], ownChanges: own?.data ?? [], reviews: reviews.data ?? [] })
  if (!news.length) return []
  // Each item's match, through the family's read of events (TRAK-164): one the child can't read is left out.
  const { data: rows, error } = await supabase.rpc('child_events', { p_child: childId }).in('id', [...new Set(news.map(item => item.eventId))])
    .abortSignal(signal).retry(false)
  if (error) throw error
  const events = new Map((rows ?? []).map(row => toPlayerEvent(row as Record<string, unknown>)).filter((e): e is PlayerEvent => !!e).map(e => [e.id, e]))
  const plan = new Map((plans.data ?? []).map(row => [row.event_id, row]))
  const review = new Map((reviews.data ?? []).map(row => [row.event_id, row]))
  return news.flatMap(item => {
    const event = events.get(item.eventId)
    if (!event) return []
    const done = item.kind === 'review' ? review.get(item.eventId) : undefined
    return [{ ...item, event, role: plan.get(item.eventId)?.role ?? null,
      coachName: ((done ?? plan.get(item.eventId))?.coach_name ?? '').trim() || null,
      score: done ? [done.our_score, done.their_score] as [number, number] : null }]
  })
}

const ROLE_WORDS: Record<string, string> = { starter: 'starts', bench: 'is on the bench', not_selected: 'isn’t in the squad this week' }

/** The bell's alert for an item: a player reads his own plan and review; a parent what the match page tells them, the
 *  role and how it went, never the job or the note (TRAK-319). Opens the match page at the plan or the review. */
export function newsAlert(item: NewsItem, as: 'player' | 'parent', childFirst: string) {
  const review = item.kind === 'review'
  const [ours, theirs] = item.score ?? [0, 0]
  const result = item.score ? `${ours > theirs ? 'won' : ours < theirs ? 'lost' : 'drew'} ${ours}–${theirs}` : null
  const when = `${eventDay(item.event)}, ${item.event.time ?? 'time to be confirmed'}`
  const title = as === 'player'
    ? review ? `${item.coachName ? `Coach ${item.coachName}` : 'Your coach'} reviewed your match`
      : item.kind === 'plan_changed' ? 'Your game plan changed' : 'Your game plan is in'
    : review ? `How ${childFirst}’s match went`
      : `${item.kind === 'plan_changed' ? 'Changed: ' : ''}${childFirst} ${ROLE_WORDS[item.role ?? ''] ?? 'starts'}`
  return {
    id: `news-${review ? 'review' : 'plan'}-${item.eventId}`, title, date: item.at,
    description: [eventHeading(item.event), review ? result : when].filter(Boolean).join(' · '),
    path: `/${as}/event/${item.eventId}#${review ? 'review' : 'game-plan'}`,
    action: review ? 'Read review' : as === 'player' ? 'Open game plan' : 'Open match',
  }
}

/** What's new for this child, not yet opened by the person signed in. */
export function useFamilyNews(childId: string | undefined, asPlayer: boolean) {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['family-news', user?.id, childId, asPlayer],
    queryFn: ({ signal }) => fetchNews(childId!, asPlayer, signal),
    enabled: !!user && !!childId,
    networkMode: 'always',
  })
  // `news` (For you) leaves out what's been opened; `all` (the bell, which keeps its own read marks) doesn't.
  return { ...query, all: query.data ?? [], news: user && childId && query.data ? unopened(user.id, childId, query.data) : [] }
}

/** On the match page: once the plan or the review shows, it's no longer new for this reader. */
export function useMarkOpened(childId: string, what: Opened, eventId: string, shown: boolean) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!shown || !user) return
    // The item's own time when Home has read it: a phone whose clock runs slow still clears what it opened.
    const known = queryClient.getQueriesData<News[]>({ queryKey: ['family-news', user.id, childId] }).flatMap(([, data]) => data ?? [])
      .filter(item => item.eventId === eventId && (item.kind === 'review') === (what === 'review')).map(item => Date.parse(item.at))
    markOpened(user.id, childId, what, eventId, Math.max(Date.now(), ...known))
  }, [shown, user, childId, what, eventId, queryClient])
}

/** TRAK-436: an alert opens the match page at the plan (#game-plan) or the review (#review): once it shows, scroll to it. */
export function useScrollTo(anchor: string, shown: boolean) {
  const { hash } = useLocation()
  useEffect(() => { if (shown && hash === `#${anchor}`) document.getElementById(anchor)?.scrollIntoView?.({ block: 'start' }) }, [shown, hash, anchor])
}
