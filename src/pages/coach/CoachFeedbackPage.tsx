import { useTranslation } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { LayoutGroup } from 'motion/react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { MobileShell, NavBar } from '@/components/trak'
import { PlayerFace } from '@/components/trak/PlayerFace'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { useCoachSquad } from '@/lib/coach-squad'
import { playerAttention, type AttentionLevel, type AttentionRow } from '@/lib/player-attention'
import { localTodayISO } from '@/lib/event-time'
import { openable } from '@/lib/openable'
import { remember, remembered } from '@/lib/screen-memory'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-211: who needs attention moved off coach Home into its own coach tab,
   "Feedback and assessment". It lists every player, most urgent first, on the
   TRAK-197 rules (player-attention.ts). With two squads it follows the squad
   picked here, on Home or in Squad (TRAK-176). */

/* TRAK-407: `word` is a word key, read in the language showing. */
const LEVEL = {
  urgent: { word: 'coachAssess:levelUrgent', color: 'rgb(var(--t-danger))' },
  warning: { word: 'coachAssess:levelWarning', color: 'rgb(var(--t-warning))' },
  'on-track': { word: 'coachAssess:levelOnTrack', color: 'rgb(var(--t-success))' },
} as const satisfies Record<AttentionLevel, { word: string; color: string }>

/** `squad` is the one it was read for: after a switch, the other squad's rows never show. */
type Overview = { squad: string | null; rows: AttentionRow[]; players: number }

export default function CoachFeedbackPage() {
  const { user, profile } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const coachSquad = useCoachSquad(user?.id)
  // TRAK-180: a revisit starts from what this tab last showed this coach for
  // this squad; the reads below still run and replace it.
  const [seed] = useState(() => remembered<Overview>('coach-feedback', user?.id))
  // null = not answered yet: never "everyone's on track" before we know.
  const [answered, setOverview] = useState<Overview | null>(seed ?? null)
  // TRAK-305: the frame's pick (All or one squad) is what this overview is for.
  const overview = answered && answered.squad === coachSquad.view ? answered : null
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // TRAK-252: on a laptop the list is a table, with a filter by level.
  const asTable = useSideMenuScreen()
  const [show, setShow] = useState<'all' | AttentionLevel>('all')

  useEffect(() => {
    if (!user) return
    // A failed squads read is a failed overview (Retry asks again), never the whole roster.
    if (coachSquad.failed) { setOverview(null); setFailed(true); return }
    if (!coachSquad.ready) return
    let stale = false
    setFailed(false)
    const fail = () => { if (!stale) { setOverview(null); setFailed(true) } }
    ;(async () => {
      const [roster, assessments, sessions] = await Promise.all([
        supabase.from('squad_players').select('id, player_name, created_at, age_group, status').eq('coach_user_id', user.id),
        supabase.from('coach_assessments').select('squad_player_id, created_at').eq('coach_user_id', user.id),
        // A few more than four: a session with no register taken doesn't count,
        // and the other squad's are filtered out below.
        supabase.from('coach_sessions').select('id, session_date, event_id, squad')
          .eq('coach_user_id', user.id).eq('session_type', 'training').lte('session_date', localTodayISO())
          .order('session_date', { ascending: false }).limit(24),
      ])
      if (stale) return
      if (roster.error || assessments.error || sessions.error) return fail()
      const players = (roster.data ?? []).filter(p => p.status !== 'coach_departed' && coachSquad.inSquad(p.age_group))
      const trainings = (sessions.data ?? []).filter(s => s.session_date && coachSquad.eventInSquad(s.squad))
        .map(s => ({ id: s.id, session_date: s.session_date as string, event_id: s.event_id }))
      const sessionIds = trainings.map(t => t.id)
      const eventIds = trainings.map(t => t.event_id).filter((id): id is string => !!id)
      const [attendance, absences, ...consent] = await Promise.all([
        sessionIds.length ? supabase.from('session_attendance').select('session_id, squad_player_id').in('session_id', sessionIds).eq('status', 'present')
          : Promise.resolve({ data: [], error: null }),
        eventIds.length ? supabase.from('event_absences').select('event_id, squad_player_id, reason').in('event_id', eventIds)
          : Promise.resolve({ data: [], error: null }),
        // Same check as the J4 screens: a child waiting for a parent can't be
        // ticked or assessed, so nothing about them is flagged.
        ...players.map(p => supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: p.id } as never) as unknown as Promise<{ data: boolean | null; error: unknown }>),
      ])
      if (stale) return
      // Any unknown answer could make a flag wrong, so none are shown.
      if (attendance.error || absences.error || consent.some(c => c.error || typeof c.data !== 'boolean')) return fail()
      const present = new Map<string, Set<string>>()
      for (const a of (attendance.data ?? []) as { session_id: string; squad_player_id: string }[]) {
        if (!present.has(a.session_id)) present.set(a.session_id, new Set())
        present.get(a.session_id)!.add(a.squad_player_id)
      }
      const absenceReasons = new Map<string, Map<string, string | null>>()
      for (const a of (absences.data ?? []) as { event_id: string; squad_player_id: string; reason: string | null }[]) {
        if (!absenceReasons.has(a.event_id)) absenceReasons.set(a.event_id, new Map())
        absenceReasons.get(a.event_id)!.set(a.squad_player_id, a.reason)
      }
      const playerIds = new Set(players.map(p => p.id))
      setOverview({
        squad: coachSquad.view,
        players: players.length,
        rows: playerAttention({
          roster: players,
          waitingForParent: new Set(players.filter((_, i) => consent[i].data === true).map(p => p.id)),
          assessments: (assessments.data ?? []).filter(a => playerIds.has(a.squad_player_id)),
          trainings,
          present,
          absenceReasons,
          now: Date.now(),
        }),
      })
    })().catch(fail)
    return () => { stale = true }
  }, [user, coachSquad.ready, coachSquad.failed, coachSquad.view, attempt]) // eslint-disable-line react-hooks/exhaustive-deps -- inSquad/eventInSquad follow coachSquad.view

  // Only an answered overview is kept for the next visit.
  useEffect(() => {
    if (user && overview && !failed) remember<Overview>('coach-feedback', user.id, overview)
  }, [user, overview, failed])

  const retry = () => { if (coachSquad.failed) coachSquad.retry(); setAttempt(n => n + 1) }

  return (
    <MobileShell width="wide">
      <div className="px-5 pt-4 pb-40">
        {/* TRAK-376 (Imad, 5 Nov): on a phone the avatar opens the side menu, where the squad picker is. */}
        <div className="flex items-center gap-3">
          <CoachMenuButton name={profile?.full_name || t('nav:coach')} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{t('coachAssess:fbTitle')}</h1>
        </div>

        <section aria-label={t('coachAssess:fbTitle')} className="rounded-[18px] border border-line p-4 mt-3" style={{ background: 'rgb(var(--t-surface))' }}>
          {failed ? (
            <p role="alert" className="text-[12px] text-ink-2" style={{ fontFamily: 'var(--t-font)' }}>
              {t('coachAssess:couldntLoadPlayers')}{' '}
              <button type="button" onClick={retry} className="underline text-brand">{t('common:retry')}</button>
            </p>
          ) : !overview ? (
            <LoadingSkeleton label={t('coachAssess:loadingPlayers')} lines={2} avatar rows={4} />
          ) : overview.players === 0 ? (
            <div>
              <p className="text-[13px] font-medium text-ink-2" style={{ fontFamily: 'var(--t-font)' }}>{t('coachSquad:preparingTitle')}</p>
              <p className="text-[10px] mt-0.5 text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>{t('coachSquad:preparingBody')}</p>
            </div>
          ) : overview.rows.length === 0 ? (
            // Everyone left is waiting for a parent: nothing can be said about them yet.
            <p className="text-[12px] text-ink-2" style={{ fontFamily: 'var(--t-font)' }}>{t('coachAssess:waitingApproval')}</p>
          ) : (
            asTable ? <FeedbackTable rows={overview.rows} show={show} onShow={setShow}
              onOpen={id => navigate(`/coach/squad/player/${id}`)}
              onAssess={id => navigate('/coach/assess', { state: { preselectedPlayerId: id } })} /> :
            // TRAK-252: two columns on a coach's upright tablet.
            <ul className="flex flex-col gap-2 tablet:grid tablet:grid-cols-2">
              {overview.rows.map(row => (
                <li key={row.playerId}
                  className="flex items-center gap-3 rounded-[10px] py-2.5 px-3 cursor-pointer active:scale-[0.99] transition-transform"
                  style={{ background: 'rgb(var(--t-raised))', borderLeft: `3px solid ${LEVEL[row.level].color}` }}
                  // TRAK-179: the player's profile, as Squad → Open profile.
                  {...openable(t('coachAssess:openProfileLevel', { name: row.name, level: t(LEVEL[row.level].word) }), () => navigate(`/coach/squad/player/${row.playerId}`))}>
                  <PlayerFace name={row.name} size="sm" className="arc flex-shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink" style={{ fontFamily: 'var(--t-font)' }}>{row.name}</span>
                      {/* The word, never colour alone. */}
                      <span className="flex-shrink-0 text-[9px] font-medium uppercase tracking-[0.08em]"
                        style={{ fontFamily: 'var(--t-font-mono)', color: LEVEL[row.level].color }}>{t(LEVEL[row.level].word)}</span>
                    </p>
                    {row.reasons.map(reason => (
                      <p key={reason} className="text-[11px] text-ink-2 mt-[2px]" style={{ fontFamily: 'var(--t-font)' }}>{reason}</p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <QuickAdd />
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}

/** TRAK-252: the same rows as a table on a coach's laptop, most urgent first, with
 *  a filter by level and an Assess button on each row. */
function FeedbackTable({ rows, show, onShow, onOpen, onAssess }: {
  rows: AttentionRow[]; show: 'all' | AttentionLevel; onShow: (level: 'all' | AttentionLevel) => void
  onOpen: (playerId: string) => void; onAssess: (playerId: string) => void
}) {
  const { t } = useTranslation()
  const count = (level: AttentionLevel) => rows.filter(row => row.level === level).length
  const options = [
    { value: 'all', label: t('coachAssess:fbAll', { count: rows.length }) },
    ...(Object.keys(LEVEL) as AttentionLevel[]).map(level => ({ value: level, label: `${t(LEVEL[level].word)} ${count(level)}` })),
  ]
  const shown = show === 'all' ? rows : rows.filter(row => row.level === show)
  return (
    <div className="space-y-3">
      <LayoutGroup id="feedback-level">
        <div className="arc flex">
          <SegmentedControl label={t('coachAssess:show')} value={show} onValueChange={value => onShow(value as 'all' | AttentionLevel)} options={options} />
        </div>
      </LayoutGroup>
      <table className="w-full text-left" style={{ fontFamily: 'var(--t-font)' }}>
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            <th className="font-medium py-2 pr-3">{t('nav:player')}</th>
            <th className="font-medium py-2 pr-3">{t('coachAssess:status')}</th>
            <th className="font-medium py-2 pr-3">{t('coachAssess:why')}</th>
            <th className="py-2"><span className="sr-only">{t('coachHome:assess')}</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(row => (
            <tr key={row.playerId} className="border-t border-line hover:bg-raised">
              <td className="py-2.5 pr-3">
                <button type="button" onClick={() => onOpen(row.playerId)} aria-label={t('coachAssess:openProfile', { name: row.name })}
                  className="flex items-center gap-3 text-left text-[13px] font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">
                  <PlayerFace name={row.name} size="sm" className="arc flex-shrink-0" aria-hidden />
                  {row.name}
                </button>
              </td>
              <td className="py-2.5 pr-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ fontFamily: 'var(--t-font-mono)', color: LEVEL[row.level].color }}>
                  {t(LEVEL[row.level].word)}
                </span>
              </td>
              <td className="py-2.5 pr-3 text-[12px] text-ink-2">{row.reasons.join(' · ')}</td>
              <td className="py-2.5 text-right">
                <button type="button" onClick={() => onAssess(row.playerId)}
                  className="rounded-[10px] px-3 py-1.5 text-[12px] font-medium border border-line text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {t('coachHome:assess')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
