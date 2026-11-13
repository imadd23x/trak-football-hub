import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { publishEvent } from '@/lib/event-publish'
import { FaceDrawing, PlayerFace } from '@/components/trak/PlayerFace'
import { AvatarGroup } from '@/components/arc/avatar-group/avatar-group'
import { TakeRegister } from '@/components/coach/TakeRegister'
import { startedLocked, type EventRow } from '@/lib/coach-events'
import { hasStarted, registerProblem } from '@/lib/event-register'
import { shareableFromRow, squadLabelFrom, whatsAppShareText } from '@/lib/event-share'
import { ShareEventButton, ShareIcon } from '@/components/coach/ShareEventButton'
import { useOldLogRetired } from '@/components/coach/old-log'
import type { StripEvent } from '@/components/trak/WeekStrip'
import { updatedNote } from '@/lib/alert-read-state'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { i18n, useTranslation } from '@/lib/i18n'
import { absenceReasonWord } from '@/lib/absence-reasons'

/* TRAK-182: the coach's part of the event sheet. Publish (a draft) or
   Published; after the event, Take register (J8.15). Share (the
   J8.16 message, which links the event's own page), Edit and Cancel (Schedule's
   own sheets). Attending follows the register model (Imad, 15 Oct): everyone
   is coming unless a guardian said they can't (TRAK-137); once the register is
   taken it shows who came. A weekly series publishes from Schedule, which asks
   "this week or the following" (#279). */
type Person = { id: string; name: string }
type Squad = {
  label: string
  childNames: string[]
  coming: Person[]
  away: (Person & { reason: string | null })[]
  /** Who the register marked present, once it is taken. */
  came: Person[] | null
  /** Not counted: consent not active (or not confirmed), as on the register. */
  waiting: Person[]
}

async function fetchEvent(id: string, signal: AbortSignal): Promise<{ row: EventRow; sessionId: string | null }> {
  const [event, session] = await Promise.all([
    supabase.from('coach_calendar_events').select('*').eq('id', id).abortSignal(signal).maybeSingle(),
    supabase.from('coach_sessions').select('id').eq('event_id', id).abortSignal(signal).maybeSingle(),
  ])
  if (event.error) throw event.error
  if (!event.data) throw new Error(i18n.t('coachSchedule:eventGone'))
  // A failed read is an error, not "no register yet" (Kostas, #310): guessing
  // would offer Take register on an event whose register exists.
  if (session.error) throw session.error
  return { row: event.data as EventRow, sessionId: session.data?.id ?? null }
}

async function fetchSquad(coachId: string, eventId: string, sessionId: string | null, eventSquad: string | null, signal: AbortSignal): Promise<Squad> {
  const [roster, absences, attendance] = await Promise.all([
    supabase.from('squad_players').select('id, player_name, age_group, status').eq('coach_user_id', coachId)
      .order('player_name').abortSignal(signal),
    supabase.from('event_absences').select('squad_player_id, reason').eq('event_id', eventId).abortSignal(signal),
    sessionId
      ? supabase.from('session_attendance').select('squad_player_id, status').eq('session_id', sessionId).abortSignal(signal)
      : Promise.resolve({ data: null, error: null }),
  ])
  if (roster.error) throw roster.error
  if (absences.error) throw absences.error
  if (attendance.error) throw attendance.error
  // TRAK-176: an event for one squad lists that squad only; null is the whole roster.
  const rows = (roster.data ?? []).filter(p => eventSquad == null || p.age_group?.trim() === eventSquad)
  const reasons = new Map((absences.data ?? []).map(a => [a.squad_player_id, absenceReasonWord(a.reason as string | null)]))
  const current = rows.filter(p => p.status !== 'coach_departed')
  // As the register (TakeRegister): only a child whose consent is active counts
  // (Kostas, #310). A failed check counts as not confirmed.
  // ponytail: one check per player, as the register does; a batch RPC if squads grow past ~40.
  const required = await Promise.all(current.map(p =>
    supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: p.id } as never)
      .abortSignal(signal).then(({ data, error }) => (error || typeof data !== 'boolean' ? null : data))))
  const players = current.filter((_, i) => required[i] === false).map(p => ({ id: p.id, name: p.player_name || i18n.t('nav:player') }))
  const waiting = current.filter((_, i) => required[i] !== false).map(p => ({ id: p.id, name: p.player_name || i18n.t('nav:player') }))
  const present = attendance.data
    ? new Set((attendance.data as { squad_player_id: string; status: string }[]).filter(a => a.status === 'present').map(a => a.squad_player_id))
    : null
  return {
    // As Schedule's share: departed names count too, so a reason naming one stays out.
    label: squadLabelFrom(rows),
    childNames: rows.map(p => p.player_name ?? '').filter(Boolean),
    coming: players.filter(p => !reasons.has(p.id)),
    away: players.filter(p => reasons.has(p.id)).map(p => ({ ...p, reason: reasons.get(p.id) ?? null })),
    came: present && players.filter(p => present.has(p.id)),
    waiting,
  }
}

/** Avatars only (Imad, 16 Oct); tapping them, "+N" included, lists the full names. */
export function People({ heading, people }: { heading: string; people: Person[] }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  return <>
    {people.length > 0 && <>
      <button type="button" aria-expanded={open} aria-label={t(open ? 'coachSchedule:hideNames' : 'coachSchedule:showNames', { heading })}
        onClick={() => setOpen(o => !o)} className="arc rounded-full focus-visible:ring-2 focus-visible:ring-primary">
        <AvatarGroup members={people.map(p => ({ name: p.name, fallback: <FaceDrawing name={p.name} /> }))} max={6} size="sm" label={heading} />
      </button>
      {open && (
        <ul aria-label={heading} className="mt-3 space-y-2">
          {people.map(p => <li key={p.id} className="text-[14px] text-ink">{p.name}</li>)}
        </ul>
      )}
    </>}
  </>
}

export function EventSheetCoach({ event, coachId, onChanged }: { event: StripEvent; coachId: string; onChanged: () => void }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { retired: oldLogRetired } = useOldLogRetired()
  const client = useQueryClient()
  const [registering, setRegistering] = useState(false)
  const details = useQuery({ queryKey: ['coach', 'event', event.id], queryFn: ({ signal }) => fetchEvent(event.id, signal) })
  const sessionId = details.data?.sessionId ?? null
  const squad = useQuery({
    queryKey: ['coach', coachId, 'attending', event.id, sessionId, details.data?.row.squad ?? null],
    queryFn: ({ signal }) => fetchSquad(coachId, event.id, sessionId, details.data?.row.squad ?? null, signal),
    enabled: details.isSuccess,
  })
  const publish = useMutation({
    mutationFn: (row: EventRow) => publishEvent(row.id),
    onSuccess: () => {
      toast.success(t('coachHome:publishedToSquad'))
      void client.invalidateQueries({ queryKey: ['coach', 'event', event.id] })
      onChanged()
    },
    onError: error => toast.error(error.message),
  })

  const row = details.data?.row
  const cancelled = event.status === 'cancelled'
  const canRegister = row && registerProblem(row) === null
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60'
  const quiet = `${button} border border-line-strong text-ink`
  const heading = 'text-[15px] font-medium text-ink mb-2'
  const updated = updatedNote(event)
  // TRAK-182 (Imad, 16 Oct): once it has started, it's who attended, register or not.
  const past = !!squad.data?.came || (!!row && hasStarted(row))

  return (
    <div className="space-y-5">
      {details.isError ? (
        <p role="alert" className="text-[13px] text-ink-2">{details.error.message}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {cancelled ? null : canRegister ? (
            <button type="button" onClick={() => setRegistering(true)} className={`${button} bg-brand text-on-brand`}>
              {sessionId ? t('coachSchedule:editRegister') : t('coachHome:takeRegister')}
            </button>
          ) : row?.published ? (
            <button type="button" disabled className={`${button} bg-raised text-ink`}><Check size={16} aria-hidden="true" />{t('coachHome:notePublished')}</button>
          ) : (
            <button type="button" disabled={!row || publish.isPending} className={`${button} bg-brand text-on-brand`}
              onClick={() => row && (row.series_id ? navigate(`/coach/schedule?publish=${row.id}`) : publish.mutate(row))}>
              {publish.isPending ? t('coachHome:publishing') : t('coachHome:publish')}
            </button>
          )}
          {/* A draft has nothing to share (J8.16); a cancellation is shared with its reason.
              Once it has started there's nothing to tell the group (TRAK-182, 16 Oct). */}
          {row?.published && !hasStarted(row) && squad.data && (
            // TRAK-168 (Imad, 18 Oct): the phone's share sheet, so the coach picks Viber or WhatsApp.
            <ShareEventButton text={whatsAppShareText(shareableFromRow(row, squad.data.label), { childNames: squad.data.childNames })} className={quiet}>
              <ShareIcon size={18} />{t('coachSchedule:share')}
            </ShareEventButton>
          )}
          {/* TRAK-185: a logged match is corrected from its event (score, goals, assists, cards). */}
          {/* TRAK-426: where the old log has retired, a match is corrected in its evaluation, not here. */}
          {!cancelled && row?.event_type === 'match' && sessionId && !oldLogRetired && (
            <button type="button" onClick={() => navigate(`/coach/sessions/${sessionId}`)} className={quiet}>
              <Pencil size={16} aria-hidden="true" />{t('coachSchedule:editMatch')}
            </button>
          )}
          {/* TRAK-230 (Kostas, 21 Oct): once it has started, what families were told is fixed. */}
          {!cancelled && row && startedLocked(row) ? (
            <p className="basis-full text-[13px] text-ink-2">{t('coachSchedule:startedDetailsFixed')}</p>
          ) : !cancelled && <>
            <button type="button" onClick={() => navigate(`/coach/schedule?edit=${event.id}`)} className={quiet}>
              <Pencil size={16} aria-hidden="true" />{t('coachSchedule:edit')}
            </button>
            {/* A published event is cancelled, never deleted; a draft is edited or deleted in Schedule. */}
            {row?.published && !hasStarted(row) && (
              <button type="button" onClick={() => navigate(`/coach/schedule?cancel=${event.id}`)} className={quiet}>
                <Ban size={16} aria-hidden="true" />{t('coachSchedule:cancelEvent')}
              </button>
            )}
          </>}
        </div>
      )}

      {updated && <p className="text-[13px] text-ink-2">{updated}</p>}

      {registering && row && (
        <TakeRegister eventId={row.id} coachId={coachId} sessionId={sessionId} squad={row.squad ?? null}
          onSaved={() => { setRegistering(false); void client.invalidateQueries({ queryKey: ['coach', 'event', event.id] }); onChanged() }} />
      )}

      {!cancelled && row && (
        <section aria-labelledby={`attending-${event.id}`}>
          {/* The heading carries the count; no separate "Coming" line (Imad, 16 Oct). */}
          <h3 id={`attending-${event.id}`} className={heading}>
            {past ? t('coachSchedule:attended') : t('coachSchedule:attending')}{row.published && squad.data ? ` · ${(squad.data.came ?? squad.data.coming).length}` : ''}
          </h3>
          {!row.published ? (
            <p className="text-[13px] text-ink-2">{t('coachSchedule:familiesSeeOncePublished')}</p>
          ) : squad.isError ? (
            <p role="alert" className="text-[13px] text-ink-2">{t('coachSchedule:couldntLoadComing')}{' '}
              <button type="button" className="underline" onClick={() => { void squad.refetch() }}>{t('common:retry')}</button></p>
          ) : !squad.data ? <LoadingSkeleton label={t('common:loading')} lines={1} avatar rows={3} />
          : squad.data.coming.length + squad.data.away.length + squad.data.waiting.length === 0 ? (
            <p className="text-[13px] text-ink-2">{t('coachSchedule:noPlayersYet')}</p>
          ) : squad.data.came ? (
            <People heading={t('coachSchedule:attended')} people={squad.data.came} />
          ) : <>
            <People heading={past ? t('coachSchedule:attended') : t('coachSchedule:attending')} people={squad.data.coming} />
            {squad.data.away.length > 0 && <>
              <h3 className={`${heading} mt-5`}>{t('coachSchedule:cantMakeItCount', { count: squad.data.away.length })}</h3>
              <ul className="space-y-2">
                {squad.data.away.map(p => (
                  <li key={p.id} className="flex items-center gap-3">
                    <PlayerFace name={p.name} size="sm" className="arc" aria-hidden />
                    <span className="text-[14px] text-ink">{p.name}</span>
                    {p.reason && <span className="text-[12px] text-ink-2 truncate">{p.reason}</span>}
                  </li>
                ))}
              </ul>
            </>}
          </>}
          {squad.data && squad.data.waiting.length > 0 && (
            // Kostas, 16 Oct: they are on Trak, waiting for consent (a parent's, or their own from the academy's consent age). A count, never names.
            <p className="text-[12px] text-ink-3 mt-4">{t('coachSchedule:waitingConsent', { count: squad.data.waiting.length })}</p>
          )}
        </section>
      )}
    </div>
  )
}
