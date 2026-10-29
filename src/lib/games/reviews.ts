import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { Tables } from '@/integrations/supabase/types'
import type { PlayerEvent } from '@/lib/player-events'
import type { Against, DidJob } from './evaluation'
import { CONTEXT, EXPECTATIONS, type Expectation } from './lineup'
import { rosterRows } from './shared-plans'

/* TRAK-289 (Games 7/8): a child's published reviews, read as the child or one of their guardians. The database opens
   only that child's copies (game_review_for_family), and the coach's note to the child alone (game_review_for_player).
   Read through the child's roster rows, as the shared plan is. TRAK-282's words are what they read; the coach sees the
   plain labels. */

export type Review = {
  eventId: string
  /** The match session publish wrote: the child's match row for this game carries it. */
  sessionId: string | null
  ourScore: number; theirScore: number; job: string
  didJob: DidJob; expectation: Expectation; context: string[]; against: Against
  hasNote: boolean
  /** null when it isn't known: "your coach". */
  coachName: string | null
  /** The note's text: the child's alone, so null when read as a guardian. */
  note: string | null
}

type FamilyRow = Pick<Tables<'game_review_for_family'>, 'event_id' | 'session_id' | 'our_score' | 'their_score' | 'job' | 'did_job'
  | 'expectation' | 'context' | 'against_expectation' | 'has_note' | 'coach_name'>

export const reviewOf = (row: FamilyRow, player: { note: string } | null): Review => ({
  eventId: row.event_id, sessionId: row.session_id, ourScore: row.our_score, theirScore: row.their_score, job: row.job,
  didJob: row.did_job as DidJob, expectation: row.expectation as Expectation, context: row.context, against: row.against_expectation as Against,
  hasNote: row.has_note, coachName: row.coach_name.trim() || null, note: player?.note ?? null,
})

const DID_JOB_WORDS: Record<DidJob, string> = { yes: 'You did your job', partly: 'You did part of your job', not_yet: 'Not this time' }
const AGAINST_WORDS: Record<Against, string> = { below: 'Not quite this time', met: 'Did what we asked', above: 'Went beyond what we asked' }

/** What was asked: the expectation's sentence, then the context in plain words. */
export function whatWeAsked(expectation: Expectation, context: string[]) {
  const asked = EXPECTATIONS.find(e => e.value === expectation)!.description
  const plain = context.map(value => CONTEXT.find(c => c.value === value)?.label.toLowerCase()).filter(Boolean)
  return plain.length ? `${asked} (${plain.join(', ')})` : asked
}

export const words = (review: Review) =>
  ({ didJob: DID_JOB_WORDS[review.didJob], asked: whatWeAsked(review.expectation, review.context), against: AGAINST_WORDS[review.against] })

const FAMILY_COLUMNS = 'event_id, session_id, our_score, their_score, job, did_job, expectation, context, against_expectation, has_note, coach_name'

/** One match's review as this reader may read it, or null before it's published (or when the child didn't play). */
export async function fetchReview(childId: string, eventId: string, asPlayer: boolean, signal: AbortSignal): Promise<Review | null> {
  const rows = await rosterRows(childId, signal)
  if (!rows.length) return null
  const { data: family, error } = await supabase.from('game_review_for_family').select(`squad_player_id, ${FAMILY_COLUMNS}`)
    .eq('event_id', eventId).in('squad_player_id', rows.map(row => row.id)).abortSignal(signal).retry(false).maybeSingle()
  if (error) throw error
  if (!family) return null
  const player = asPlayer && family.has_note ? await supabase.from('game_review_for_player').select('note').eq('event_id', eventId)
    .eq('squad_player_id', family.squad_player_id).abortSignal(signal).retry(false).maybeSingle() : null
  if (player?.error) throw player.error
  return reviewOf(family, player?.data ?? null)
}

/** The child's published reviews, by match session (their match rows) and by event (their event cards). */
export async function fetchReviews(childId: string, signal: AbortSignal) {
  const ids = (await rosterRows(childId, signal)).map(row => row.id)
  if (!ids.length) return { bySession: new Map<string, string>(), events: new Set<string>() }
  const { data, error } = await supabase.from('game_review_for_family').select('event_id, session_id')
    .in('squad_player_id', ids).abortSignal(signal).retry(false)
  if (error) throw error
  const rows = data ?? []
  return {
    bySession: new Map(rows.flatMap(row => row.session_id ? [[row.session_id, row.event_id] as const] : [])),
    events: new Set(rows.map(row => row.event_id)),
  }
}

export function useReview(event: PlayerEvent, childId: string, asPlayer: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['game-review', user?.id, childId, event.id, asPlayer],
    queryFn: ({ signal }) => fetchReview(childId, event.id, asPlayer, signal),
    enabled: !!user && event.kind === 'match',
    networkMode: 'always',
  })
}

export function useReviews(childId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['game-reviews', user?.id, childId],
    queryFn: ({ signal }) => fetchReviews(childId!, signal),
    enabled: !!user && !!childId,
    networkMode: 'always',
  })
}
