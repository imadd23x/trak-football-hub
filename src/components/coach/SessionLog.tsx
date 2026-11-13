import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { dateLocale, i18n, useTranslation } from '@/lib/i18n'
import { Pencil } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { LoadError } from '@/components/trak/LoadError'
import { LoggedAttendance } from '@/components/coach/LoggedAttendance'
import { useOldLogRetired } from '@/components/coach/old-log'
import { parseTrainingNotes, parseTrainingTitle } from '@/lib/session-form'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* Imad, 23 Oct: "View log" on Home shows the log, read only; Edit log opens the edit page. A training: its focus,
   length, intensity and notes, and who came. A match: the score and each player's goals, assists and card, from
   the same logged_match read the edit page uses (TRAK-185). */

type Session = { id: string; session_type: string; title: string; session_date: string | null; training_type: string | null; notes: string | null }
type MatchRow = {
  user_id: string; player_name: string | null; competition: string; venue: string; opponent: string | null
  goals: number | null; assists: number | null; card_received: string | null; team_score: number; opponent_score: number; played: boolean
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-4"><dt className="w-20 shrink-0 text-ink-3">{label}</dt><dd className="min-w-0 text-ink">{children}</dd></div>
}

export function SessionLog({ sessionId, coachId }: { sessionId: string; coachId: string }) {
  const { t } = useTranslation()
  const log = useQuery({
    queryKey: ['coach', coachId, 'session-log', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from('coach_sessions').select('id, session_type, title, session_date, training_type, notes').eq('id', sessionId).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('No such session')
      const session = data as Session
      if (session.session_type !== 'match') return { session, match: null }
      const { data: rows, error: matchError } = await supabase.rpc('logged_match' as never, { p_session_id: sessionId } as never)
      if (matchError) throw matchError
      return { session, match: (rows ?? []) as MatchRow[] }
    },
  })

  if (log.isError) return <LoadError what={t('coachSchedule:logWhat')} onRetry={() => { void log.refetch() }} retrying={log.isFetching} />
  if (!log.data) return <LoadingSkeleton label={t('coachSchedule:loadingLog')} />
  const { session, match } = log.data
  const day = session.session_date ? format(parseISO(session.session_date), 'EEE d MMM', { locale: dateLocale() }) : null

  if (match) {
    const played = match.filter(r => r.played !== false)
    const first = played[0] ?? match[0]
    const stats = played.filter(r => (r.goals ?? 0) > 0 || (r.assists ?? 0) > 0 || (r.card_received && r.card_received !== 'None'))
    const absent = match.filter(r => r.played === false)
    return <div className="space-y-5 text-[14px]">
      <dl className="space-y-3">
        {first && <Row label={t('coachSchedule:score')}>{first.team_score}–{first.opponent_score}</Row>}
        {day && <Row label={t('coachSchedule:date')}>{day}</Row>}
        {first?.venue && <Row label={t('coachSchedule:venue')}>{first.venue}</Row>}
        {first?.competition && <Row label={t('coachSchedule:summaryType')}>{first.competition}</Row>}
      </dl>
      <section aria-labelledby={`log-players-${sessionId}`}>
        <h3 id={`log-players-${sessionId}`} className="mb-2 text-[15px] font-medium text-ink">{t('coachSchedule:playedCount', { count: played.length })}</h3>
        {stats.length === 0 ? <p className="text-ink-2">{t('coachSchedule:noStatsLogged')}</p>
          : <ul className="space-y-1.5">
            {stats.map(r => <li key={r.user_id} className="flex justify-between gap-3">
              <span className="text-ink">{r.player_name ?? t('nav:player')}</span>
              <span className="text-ink-2">{[
                (r.goals ?? 0) > 0 && t('coachSchedule:goalCount', { count: r.goals ?? 0 }),
                (r.assists ?? 0) > 0 && t('coachSchedule:assistCount', { count: r.assists ?? 0 }),
                r.card_received && r.card_received !== 'None' && cardWord(r.card_received),
              ].filter(Boolean).join(' · ')}</span>
            </li>)}
          </ul>}
      </section>
      {absent.length > 0 && <p className="text-ink-2">{t('coachSchedule:didntPlay', { names: absent.map(r => r.player_name ?? t('nav:player')).join(', ') })}</p>}
      <EditLog sessionId={sessionId} />
    </div>
  }

  const { focus, theme } = parseTrainingTitle(session.title, session.training_type)
  const { duration, intensity, notes } = parseTrainingNotes(session.notes)
  return <div className="space-y-5 text-[14px]">
    <dl className="space-y-3">
      {day && <Row label={t('coachSchedule:date')}>{day}</Row>}
      {session.session_type === 'training' && focus.length > 0 && <Row label={t('coachSchedule:focus')}>{focus.join(', ')}</Row>}
      {theme && <Row label={t('coachSchedule:theme')}>{theme}</Row>}
      {duration && <Row label={t('coachSchedule:length')}>{t('coachSchedule:lengthMinutes', { count: duration })}</Row>}
      {intensity && <Row label={t('coachSchedule:intensity')}>{intensity}</Row>}
      {notes.trim() && <Row label={t('coachSchedule:notes')}><span className="whitespace-pre-line">{notes.trim()}</span></Row>}
    </dl>
    <LoggedAttendance sessionId={sessionId} coachId={coachId} />
    <EditLog sessionId={sessionId} />
  </div>
}

/** A saved card is 'Yellow' or 'Red'; anything else is shown as saved. */
function cardWord(card: string) {
  if (card === 'Yellow') return i18n.t('coachSchedule:cardYellow')
  if (card === 'Red') return i18n.t('coachSchedule:cardRed')
  return i18n.t('coachSchedule:cardNamed', { card })
}

function EditLog({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  // TRAK-426: where the old log has retired, a training is changed on its own page (Who's here, notes) and a match in
  // its evaluation; Edit session is gone.
  const { retired } = useOldLogRetired()
  if (retired) return null
  return <Link to={`/coach/sessions/${sessionId}`}
    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-raised text-[14px] font-medium text-ink focus-visible:ring-2 focus-visible:ring-primary">
    <Pencil size={16} aria-hidden="true" />{t('coachSchedule:editLog')}
  </Link>
}
