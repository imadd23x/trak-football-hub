import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { refusalWithNames, registerStart, type RegisterPlayer } from '@/lib/event-register'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { i18n, useTranslation } from '@/lib/i18n'
import { absenceReasonWord } from '@/lib/absence-reasons'

/**
 * TRAK-138 (J8.15): the register of an event that went ahead. It opens
 * pre-filled from J8.14's "can't make it" (everyone present except those), or
 * as it was saved if the coach took it before. A child who can't be recorded
 * is never offered (G1), and the note says why. Taps mark present or absent;
 * Save sends the present list to take_event_register(), which makes or reuses
 * the event's one completed session and repeats every rule.
 *
 * Nothing is guessed: a squad, consent, absence or attendance read that fails
 * shows a retry, not a register.
 */
interface TakeRegisterProps {
  eventId: string
  coachId: string
  /** The completed session this event already has, if the register was taken. */
  sessionId: string | null
  /** TRAK-176: the event's squad; null is the whole roster. */
  squad?: string | null
  onSaved: () => void
  /** TRAK-342: Training's Who's here page. Several names to a row, so the whole squad fits a laptop screen, and the
   *  button says how many are here ("Done: 15 here"). Everywhere else keeps the one-column list. */
  wide?: boolean
}

type Loaded = {
  players: RegisterPlayer[]
  notReady: RegisterPlayer[]
  familyReason: Map<string, string | null>
}

const font = { fontFamily: 'var(--t-font)' }

export function TakeRegister({ eventId, coachId, sessionId, squad: eventSquad = null, onSaved, wide = false }: TakeRegisterProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()

  useEffect(() => {
    let superseded = false
    setLoaded(null)
    setLoadFailed(false)
    ;(async () => {
      const [squad, absences, attendance] = await Promise.all([
        supabase.from('squad_players').select('id, player_name, age_group, status').eq('coach_user_id', coachId).order('player_name'),
        supabase.from('event_absences').select('squad_player_id, reason').eq('event_id', eventId),
        sessionId
          ? supabase.from('session_attendance').select('squad_player_id, status').eq('session_id', sessionId)
          : Promise.resolve({ data: null, error: null }),
      ])
      if (squad.error || absences.error || attendance.error) throw new Error('register read failed')
      const rows = (squad.data ?? []).filter(p => p.status !== 'coach_departed' && (eventSquad == null || p.age_group?.trim() === eventSquad))
      // Same check as the J4 screens; a failed check counts as not confirmed.
      const required = await Promise.all(rows.map(p =>
        supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: p.id } as never)
          .then(({ data, error }) => (error || typeof data !== 'boolean' ? null : data))))
      const all: RegisterPlayer[] = rows.map((p, i) => ({
        id: p.id, name: p.player_name ?? i18n.t('nav:player'), ready: required[i] === false,
        waitReason: required[i] === null ? "consent couldn't be checked" : 'waiting for a parent',
      }))
      const familyReason = new Map((absences.data ?? []).map(a => [a.squad_player_id as string, absenceReasonWord(a.reason as string | null)]))
      const start = registerStart(all, familyReason.keys())
      // Taken before: reopen as saved. Otherwise the family's word decides.
      const ready = new Set(all.filter(p => p.ready).map(p => p.id))
      const first = attendance.data
        ? new Set((attendance.data as { squad_player_id: string, status: string }[])
            .filter(a => a.status === 'present' && ready.has(a.squad_player_id)).map(a => a.squad_player_id))
        : start.present
      if (superseded) return
      setLoaded({ players: all.filter(p => p.ready), notReady: all.filter(p => !p.ready), familyReason })
      setPresent(first)
    })().catch(() => { if (!superseded) setLoadFailed(true) })
    return () => { superseded = true }
  }, [eventId, coachId, sessionId, eventSquad, attempt])

  const names = useMemo(() => new Map([...(loaded?.players ?? []), ...(loaded?.notReady ?? [])].map(p => [p.id, p.name])), [loaded])

  const toggle = (id: string) => {
    setError(null)
    setPresent(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    if (!loaded || saving) return
    setSaving(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('take_event_register', { p_event_id: eventId, p_present: [...present] })
    setSaving(false)
    if (rpcErr) {
      // A rule refusal carries a sentence for the coach; saving again gets the
      // same answer, so show it. Anything else is the connection.
      setError(rpcErr.code === 'P0001' || rpcErr.code === '42501' ? refusalWithNames(rpcErr.message, names) : t('coachSchedule:registerSaveFailed'))
      return
    }
    toast.success(t('coachSchedule:registerSaved', { count: present.size }))
    onSaved()
  }

  if (loadFailed) {
    return (
      <p role="alert" className="text-[12px] text-ink-2" style={font}>
        {t('coachSchedule:couldntLoadRegister')}{' '}
        <button type="button" onClick={() => setAttempt(n => n + 1)} className="underline text-brand">{t('common:retry')}</button>
      </p>
    )
  }
  if (!loaded) return <LoadingSkeleton label={t('coachSchedule:loadingSquad')} lines={1} avatar rows={4} />

  const absent = loaded.players.length - present.size
  return (
    <div className="space-y-3">
      {loaded.players.length === 0 ? (
        <p className="text-[12px] text-ink-3" style={font}>{t('coachSchedule:noPlayersToRecord')}</p>
      ) : (
        <>
          <p className="text-[12px] text-ink-2" style={font}>{t('coachSchedule:presentAbsent', { present: present.size, absent })}</p>
          <ul className={wide ? 'grid gap-1.5 tablet:grid-cols-3 laptop:grid-cols-6' : 'space-y-1.5'}>
            {loaded.players.map(p => {
              const on = present.has(p.id)
              const family = loaded.familyReason.has(p.id)
              const reason = loaded.familyReason.get(p.id)
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                    aria-label={t(on ? 'coachSchedule:playerPresent' : 'coachSchedule:playerAbsent', { name: p.name })}
                    className={`w-full flex items-center gap-3 rounded-[12px] px-3 ${wide ? 'py-2' : 'py-2.5'} text-left`}
                    style={{ background: on ? 'rgb(var(--t-brand) / 0.08)' : 'rgb(var(--t-raised))', border: `1px solid ${on ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}` }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: on ? 'rgb(var(--t-brand))' : 'transparent', border: on ? 'none' : '1px solid rgb(var(--t-line-strong))' }}>
                      {on && <Check size={12} color="rgb(var(--t-on-brand))" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-ink truncate" style={font}>{p.name}</span>
                      {family && (
                        <span className="block text-[11px] text-ink-3" style={font}>
                          {reason ? t('coachSchedule:cantMakeItWhy', { reason }) : t('coachSchedule:cantMakeIt')}
                        </span>
                      )}
                    </span>
                    {/* TRAK-343 (Kostas, 3 Nov: as clean as the mockup): in the wide register the tick says it, so the
                        name keeps the width. The button's name still says present or absent. */}
                    {!wide && <span className="text-[11px]" style={{ ...font, color: on ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))' }}>
                      {on ? t('coachSchedule:present') : t('coachSchedule:absent')}
                    </span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {loaded.notReady.length > 0 && (
        <p className="text-[11px] text-ink-3" style={font}>
          {t('coachSchedule:notRecordedUntil', { names: loaded.notReady.map(p => p.waitReason === 'waiting for a parent' ? p.name : `${p.name} (${t('coachSchedule:consentUnchecked')})`).join(', ') })}
        </p>
      )}
      {error && <p role="alert" className="text-[12px] text-danger" style={font}>{error}</p>}
      {loaded.players.length > 0 && (
        <button type="button" onClick={save} disabled={saving}
          className={`${wide ? 'w-full tablet:w-auto tablet:px-8' : 'w-full'} py-3 rounded-[12px] text-[14px] font-medium disabled:opacity-50`}
          style={{ background: 'rgb(var(--t-brand))', color: 'rgb(var(--t-on-brand))' }}>
          {saving ? t('coachSchedule:savingDots') : wide ? t('coachSchedule:doneHere', { count: present.size }) : t('coachSchedule:saveRegister')}
        </button>
      )}
    </div>
  )
}
