import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { rosterRows } from './shared-plans'

/* TRAK-441 slice 2 ("For you", Imad 12 Nov) and TRAK-436: what the coach sent a child that the family hasn't opened
   yet: a game plan shared or changed, and a match review published. Read from the same copies the match page reads
   (the database opens only this child's). A review replaces its match's plan. A card goes once the match page has
   shown it, on this device, as the bell remembers what's been read; a later change makes the plan new again. */

export type News = { kind: 'plan' | 'plan_changed' | 'review'; eventId: string; at: string }
type Opened = 'plan' | 'review'

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

export function unopened(readerId: string, childId: string, news: News[]) {
  const opened = readOpened(readerId)
  return news.filter(item => !(opened[openedKey(childId, item.kind === 'review' ? 'review' : 'plan', item.eventId)] >= Date.parse(item.at)))
}

export async function fetchNews(childId: string, asPlayer: boolean, signal: AbortSignal): Promise<News[]> {
  const ids = (await rosterRows(childId, signal)).map(row => row.id)
  if (!ids.length) return []
  const [plans, own, reviews] = await Promise.all([
    supabase.from('game_for_family').select('event_id, shared_at, changed_at').in('squad_player_id', ids).abortSignal(signal).retry(false),
    asPlayer ? supabase.from('game_for_player').select('event_id, changed_at').in('squad_player_id', ids).abortSignal(signal).retry(false) : null,
    supabase.from('game_review_for_family').select('event_id, published_at').in('squad_player_id', ids).abortSignal(signal).retry(false),
  ])
  for (const read of [plans, own, reviews]) if (read?.error) throw read.error
  return newsOf({ plans: plans.data ?? [], ownChanges: own?.data ?? [], reviews: reviews.data ?? [] })
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
  return { ...query, news: user && childId && query.data ? unopened(user.id, childId, query.data) : [] }
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
