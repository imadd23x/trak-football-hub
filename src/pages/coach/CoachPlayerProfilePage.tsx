import { useCallback, useEffect, useState } from 'react'
import { Avatar } from '@/components/arc/avatar/avatar'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, MetadataLabel, CategoryBar, BandPill, LoadError, NavBar } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS, appearanceLabel } from '@/lib/types'
import { openable } from '@/lib/openable'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { CoachAssessmentCard } from '@/components/coach/CoachAssessmentCard'
import { loadPlayerAssessments } from '@/lib/coach-assessments'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

function avgScore(a: any) {
  return (a.work_rate + a.tactical + a.attitude + a.technical + a.physical + a.coachability) / 6
}


/** TRAK-252: a squad player's page body. `embedded`: inside Squad's side panel on a
 *  laptop, without the page's header, Back and side menu. */
export function CoachPlayerOverview({ id, embedded = false }: { id: string | undefined; embedded?: boolean }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [player, setPlayer] = useState<any>(null)
  const [assessments, setAssessments] = useState<any[]>([])
  const [notesById, setNotesById] = useState<Record<string, string>>({})
  const [messageById, setMessageById] = useState<Record<string, string>>({})
  // Whether each assessment's message reached the player. Undefined when the
  // read failed: then the page says nothing rather than "No message".
  const [messageSentById, setMessageSentById] = useState<Record<string, boolean> | undefined>({})
  /* Four states, not one.
     `if (!player) return <spinner>` conflated every pre-data condition into a
     spinner that never stops: a failed read set `player` to null and the coach
     waited forever with no error and no retry. A player who genuinely does not
     exist — deleted, or another coach's — got the same forever-spinner, so
     "loading", "failed" and "not found" were one indistinguishable state. */
  const [playerState, setPlayerState] = useState<'loading' | 'failed' | 'missing' | 'found'>('loading')
  const [assessmentsFailed, setAssessmentsFailed] = useState(false)

  const loadPlayer = useCallback(async () => {
    if (!id || !user) return
    const { data, error } = await supabase.from('squad_players').select('*')
      .eq('id', id).eq('coach_user_id', user.id).maybeSingle()
    if (error) { setPlayerState('failed'); return }
    if (!data)  { setPlayerState('missing'); return }
    setPlayer(data)
    setPlayerState('found')
  }, [id, user])

  /* `playerState` is written by loadPlayer and by nothing else, deliberately.
     The two loaders run concurrently, so a second writer would race: a
     mutation that made THIS function escalate its failure to playerState was
     masked five times out of five, because loadPlayer resolved last and put it
     back to 'found'. An assessments failure is reported through
     assessmentsFailed instead, which no other loader touches. Keep it that
     way — a shared state field here is a bug that hides itself. */
  const loadAssessments = useCallback(async () => {
    if (!id || !user) return
    // TRAK-263: the same read as Squad's profile panel.
    let loaded
    try { loaded = await loadPlayerAssessments(id, user.id) } catch { setAssessmentsFailed(true); return }
    setAssessmentsFailed(false)
    setAssessments(loaded.list)
    setNotesById(loaded.notes)
    setMessageById(loaded.messages)
    setMessageSentById(loaded.sent)
  }, [id, user])

  useEffect(() => { void loadPlayer(); void loadAssessments() }, [loadPlayer, loadAssessments])

  if (embedded && playerState !== 'found') return (
    <div className="px-1 py-6 text-center">
      {playerState === 'loading' ? <LoadingSkeleton label="Loading…" avatar />
        : playerState === 'failed' ? <LoadError what="this player" onRetry={() => { setPlayerState('loading'); void loadPlayer() }} />
        : <p className="text-[14px] text-ink-2">We couldn't find that player.</p>}
    </div>
  )

  if (playerState === 'loading') return (
    <MobileShell>
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    </MobileShell>
  )

  if (playerState === 'failed') return (
    <MobileShell>
      <div className="px-5 pt-6">
        <LoadError what="this player" onRetry={() => { setPlayerState('loading'); void loadPlayer() }} />
      </div>
    </MobileShell>
  )

  /* Distinct from a failure on purpose. "We could not ask" and "this player is
     not on your squad" call for different actions from the coach, and telling
     them to retry a read that succeeded would send them round a loop. */
  if (playerState === 'missing') return (
    <MobileShell>
      <div className="px-5 pt-6 text-center">
        <p className="text-[14px] text-ink-2">We couldn't find that player.</p>
        <p className="mt-1 text-[12px] text-ink-3">
          They may have been removed from your squad.
        </p>
        <button
          onClick={() => navigate('/coach/squad')}
          className="mt-4 px-4 py-2 rounded-[10px] text-[12px] text-ink-2 border border-line active:bg-raised"
          style={{ fontFamily: 'var(--t-font-mono)' }}
        >
          Back to squad
        </button>
      </div>
    </MobileShell>
  )

  const latest = assessments[0]
  const openAssessment = (assessmentId: string) => navigate(`/coach/assess?assessment=${assessmentId}`)
  const shortDate = (a: any) => new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const messageTag = (a: any) => messageSentById === undefined ? null : (
    <span className="text-[9px] text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>
      {messageSentById[a.id] ? 'Message sent' : 'No message'}
    </span>
  )

  // The page's body; on a laptop, Squad shows it beside the list (TRAK-252).
  const content = (<>

    {/* Player identity */}
    <div className="flex items-center gap-4 py-2">
      <Avatar name={player.player_name} size="lg" className="arc" aria-hidden />
      <div>
        <p className="text-[22px] font-light text-ink leading-tight"
          style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}>
          {player.player_name}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {player.position && (
            <span className="h-5 px-2.5 rounded-full bg-raised border border-line text-[8px] font-medium tracking-[0.06em] uppercase text-ink-3 inline-flex items-center"
              style={{ fontFamily: 'var(--t-font-mono)' }}>{player.position}</span>
          )}
          {player.shirt_number && (
            <span className="h-5 px-2.5 rounded-full bg-raised border border-line text-[8px] font-medium tracking-[0.06em] uppercase text-ink-3 inline-flex items-center"
              style={{ fontFamily: 'var(--t-font-mono)' }}>#{player.shirt_number}</span>
          )}
          {/* No assessment count here (TRAK-72 item 5). A failed read still
              shows its own error card below. */}
        </div>
      </div>
    </div>

    {/* The player stays on screen. Losing the whole page because one of
        two reads failed would be the same over-correction avoided on Home:
        the coach can still see who they opened. */}
    {assessmentsFailed && (
      <LoadError what="this player's assessments"
        onRetry={() => { void loadAssessments() }} />
    )}

    {/* TRAK-252: on a coach's laptop the latest assessment and the history stand side by side.
        Only when there is one of them, so a page with neither keeps its spacing. */}
    {((latest && user) || assessments.length > 1) && (
    <div className="space-y-4 laptop:grid laptop:grid-cols-2 laptop:gap-6 laptop:items-start laptop:space-y-0">
    {/* Latest assessment, as Arc's card (TRAK-200): Draft or Published, Publish on the card,
        and the quick look with the opponent, the message and the private note. */}
    {latest && user && (
      <CoachAssessmentCard key={latest.id} assessment={latest}
        message={messageById[latest.id]} messageFailed={messageSentById === undefined} note={notesById[latest.id]}
        onChanged={published => setAssessments(list => list.map(a => a.id === latest.id ? { ...a, published_at: published ? new Date().toISOString() : null } : a))} />
    )}

    {/* Assessment history */}
    {assessments.length > 1 && (
      <div className="space-y-2">
        <MetadataLabel text="ASSESSMENT HISTORY" />
        {assessments.slice(1).map(a => {
          const band = scoreToBand(avgScore(a))
          // TRAK-229: the score in its band's readable shade, on a light row.
          const bandColor = BANDS.find(b => b.word.toLowerCase() === band)?.text
          return (
            <div key={a.id} className="flex items-center justify-between rounded-[12px] px-4 py-3 cursor-pointer active:scale-[0.99] transition-transform"
              style={{ background: 'rgb(var(--t-surface))', border: '1px solid rgb(var(--t-line))' }}
              {...openable(`Open assessment from ${new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}${a.coach_sessions?.title ? `, ${a.coach_sessions.title}` : ''}`,
                () => openAssessment(a.id))}>
              <div>
                <p className="text-[12px] text-ink-2"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                  {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                </p>
                {a.coach_sessions?.title && (
                  <p className="text-[11px] text-ink-2 mt-0.5">{a.coach_sessions.title}</p>
                )}
                {a.appearance && (
                  <p className="text-[10px] text-ink-3 mt-0.5">{appearanceLabel(a.appearance)}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {a.published_at == null && <span className="text-[9px] text-muted-foreground">Draft</span>}
                {messageTag(a)}
                <span className="text-[11px] font-medium" style={{ color: bandColor }}>
                  {avgScore(a).toFixed(1)}
                </span>
                <BandPill band={band} />
              </div>
            </div>
          )
        })}
      </div>
    )}

    </div>
    )}

    {/* Action buttons. TRAK-85 (Imad, 16 Oct): no Award button while awards
        are parked; /coach/award stays a parked route, and it comes back here
        when awards are unparked. */}
    <div className="flex gap-2 pt-1">
      <button
        onClick={() => navigate('/coach/assess', { state: { preselectedPlayerId: player.id } })}
        className="flex-1 py-3.5 rounded-[10px] bg-brand text-on-brand font-bold text-sm active:scale-[0.97] transition-transform">
        Assess {player.player_name.split(' ')[0]} →
      </button>
    </div>
  </>)

  if (embedded) return <div className="space-y-4">{content}</div>

  return (
    <div className="flex flex-col mx-auto trak-wide bg-ground" style={{ height: '100dvh' }}>
      {/* Header — always visible, never scrolls */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgb(var(--t-line))' }}>
        {/* TRAK-334: the trail, in place of TRAK-200's Back: where the coach came from (Squad, Home, Assess);
            opened with nothing behind it, Squad (the TRAK-179 rule). The name below is the page's visible title. */}
        <CoachTrail current={player.player_name} />
        <h1 className="sr-only">{player.player_name}</h1>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-28 space-y-4">
        {content}
      </div>
      {/* TRAK-254: on a laptop this page keeps the side menu and "+ Create"; a phone shows neither here. */}
      <QuickAdd sideMenuOnly />
      <NavBar role="coach" sideMenuOnly activeTab="/coach/squad" onNavigate={navigate} />
    </div>
  )
}

export default function CoachPlayerProfilePage() {
  const { id } = useParams()
  return <CoachPlayerOverview id={id} />
}
