import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Check } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { dateLocale, useTranslation } from '@/lib/i18n'
import { Badge } from '@/components/arc/badge/badge'
import { Progress } from '@/components/arc/progress/progress'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { usePlansReady } from '@/lib/player-plans'

type Row = { session_id: string; session_date: string; attendance: string }

/** The count on the coach's rules (child_training_attendance, as Home's Season so far) and the latest trainings the
 *  child was recorded at (family_training_history, TRAK-76). The register writes "present" only, so a missed training
 *  has no row: Missed shows only on an older register's "absent". Waiting for consent reads as nothing yet. */
async function fetchTeamTraining(childId: string, signal: AbortSignal) {
  const [counted, history] = await Promise.all([
    supabase.rpc('child_training_attendance', { p_child: childId }).abortSignal(signal).retry(false),
    supabase.rpc('family_training_history' as never, { p_player_user_id: childId } as never).abortSignal(signal).retry(false),
  ])
  if (counted.error) throw counted.error
  if (history.error && history.error.message !== 'consent_required') throw history.error
  const rows = ((history.data as Row[] | null) ?? []).filter(row => ['present', 'late', 'absent'].includes(row.attendance))
  return { count: counted.data?.[0] ?? null, rows: rows.slice(0, 4) }
}

/** TRAK-441 slice 7 (mockup, 12 Nov): Team training on the player's Trainings, moved from Sessions. Counts, never a rating. */
export function TeamTraining({ childId }: { childId: string }) {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['team-training', childId], queryFn: ({ signal }) => fetchTeamTraining(childId, signal) })
  const { count, rows } = query.data ?? { count: null, rows: [] }
  // TRAK-601: a past training with a plan links to it, by its register (the player's own; plans read nothing for others).
  const planFor = usePlansReady().data?.bySession
  return <section aria-labelledby="team-training" className="rounded-2xl border border-line bg-surface p-5 laptop:p-6">
    <div className="flex items-baseline justify-between gap-3">
      <h2 id="team-training" className="text-lg font-medium text-ink">{t('common:teamTraining')}</h2>
      {count && <span className="text-sm text-ink-3 tabular-nums">{t('common:attendedOf', { attended: count.attended, total: count.total })}</span>}
    </div>
    {count && <Progress className="mt-3" value={count.attended} max={count.total} aria-labelledby="team-training" />}
    {query.isPending ? <LoadingSkeleton className="mt-3" label={t('common:teamTraining')} lines={2} />
      : query.isError ? <p className="mt-2 text-[15px] text-ink-2">{t('common:couldntLoadTraining')}{' '}
        <button type="button" onClick={() => void query.refetch()} className="rounded font-medium text-brand underline-offset-4 hover:underline">{t('coachTraining:tryAgain')}</button>
      </p>
      : rows.length > 0 ? <ul className="mt-2 divide-y divide-line">{rows.map(row => <li key={row.session_id} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
        <span className="text-ink">{format(parseISO(row.session_date), 'EEE d MMM', { locale: dateLocale() })}</span>
        {planFor?.has(row.session_id) && <Link to={`/player/event/${planFor.get(row.session_id)}`} state={{ from: '/player/trainings' }}
          className="-my-2.5 ml-auto inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-brand">{t('common:plan')}</Link>}
        {row.attendance === 'absent' ? <Badge size="sm">{t('common:trainingMissed')}</Badge>
          : <Badge tone="success" size="sm" icon={<Check />}>{t('common:trainingThere')}</Badge>}
      </li>)}</ul>
      : !count && <p className="mt-2 text-[15px] text-ink-2">{t('common:noTrainingYet')}</p>}
  </section>
}
