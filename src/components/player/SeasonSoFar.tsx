import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { rosterRows } from '@/lib/games/shared-plans'

/** Matches = the coach's records of the child playing (old log or Matches); Starts = those the shared plan said "starter";
 *  Training = attended / counted on the coach's rules (child_training_attendance), or none while nothing counts. */
async function fetchSeasonSoFar(childId: string, signal: AbortSignal) {
  const ids = (await rosterRows(childId, signal)).map(row => row.id)
  const [matches, reviews, plans, training] = await Promise.all([
    supabase.from('matches').select('id').eq('user_id', childId).eq('logged_by_role', 'coach').abortSignal(signal).retry(false),
    ids.length ? supabase.from('game_review_for_family').select('event_id').in('squad_player_id', ids).abortSignal(signal).retry(false) : null,
    ids.length ? supabase.from('game_for_family').select('event_id, role').in('squad_player_id', ids).abortSignal(signal).retry(false) : null,
    supabase.rpc('child_training_attendance', { p_child: childId }).abortSignal(signal).retry(false),
  ])
  for (const read of [matches, reviews, plans, training]) if (read?.error) throw read.error
  const played = new Set((reviews?.data ?? []).map(row => row.event_id))
  const counted = training.data?.[0]
  return {
    matches: matches.data?.length ?? 0,
    starts: (plans?.data ?? []).filter(row => row.role === 'starter' && played.has(row.event_id)).length,
    training: counted ? `${counted.attended}/${counted.total}` : null,
  }
}

/**
 * TRAK-441 slice 2.5b (mockup, 12 Nov): the family Home's Season so far, as tiles. Counts, never a rating. A failed read
 * shows nothing rather than a zero that isn't true.
 */
export function SeasonSoFar({ childId }: { childId: string }) {
  const { data } = useQuery({ queryKey: ['season-so-far', childId], queryFn: ({ signal }) => fetchSeasonSoFar(childId, signal) })
  if (!data) return null
  const stats: [string, number | string][] = [['Matches', data.matches], ['Starts', data.starts]]
  if (data.training) stats.push(['Training', data.training])
  return <section aria-labelledby="season-so-far">
    <h2 id="season-so-far" className="mb-2 text-lg font-medium text-ink">Season so far</h2>
    <dl className={`grid gap-3 ${stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{stats.map(([label, value]) => <div key={label} className="rounded-2xl border border-line bg-surface p-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="mt-1 text-[22px] font-medium leading-tight tracking-[-0.01em] text-ink tabular-nums">{value}</dd>
    </div>)}</dl>
  </section>
}
