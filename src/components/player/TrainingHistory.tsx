import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { LoadError } from '@/components/trak'
import { formatParentDate } from '@/lib/parent-data'

/* TRAK-76 (J6): the trainings a child was recorded at, from
   family_training_history(): date, focus labels and their own attendance.
   Nothing else about a session reaches a family (Kostas, TRAK-6, 25 Sep).
   The parent screen (TRAK-77) uses it with the selected child's id and its
   own wording for a child who is waiting for approval. */

type Row = { session_id: string; session_date: string; focus: string[] | null; attendance: string }
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: Row[] }
  | { kind: 'failed' }
  | { kind: 'awaiting_consent' }

const ATTENDANCE: Record<string, string> = { present: 'Present', late: 'Late', absent: 'Absent' }

export function TrainingHistory({
  playerUserId, reloadOn, assessmentHref, assessedSessions,
  waitingText = 'Your training history appears once your parent approves.',
}: {
  playerUserId: string; reloadOn?: unknown; waitingText?: string; assessmentHref?: (sessionId: string) => string
  /** TRAK-439: with assessmentHref, only the sessions this returns get a link. A row with none is plain text, as the player's
   *  is, and so is every row while it loads or if it fails: never a link to an empty page. */
  assessedSessions?: (sessionIds: string[], signal: AbortSignal) => Promise<Set<string>>
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [assessed, setAssessed] = useState<Set<string>>(new Set())
  const [retrying, setRetrying] = useState(false)
  // Only the newest request may write: a slow earlier one must not replace it.
  const latest = useRef(0)

  const load = async () => {
    const request = ++latest.current
    const { data, error } = await supabase.rpc('family_training_history' as any, { p_player_user_id: playerUserId })
    if (request !== latest.current) return
    setRetrying(false)
    if (error) {
      // Waiting for a parent's approval is not a failure, and not "no training".
      setState(error.message === 'consent_required' ? { kind: 'awaiting_consent' } : { kind: 'failed' })
      return
    }
    const rows = (data as Row[] | null) ?? []
    setState({ kind: 'ready', rows })
    setAssessed(new Set())
    if (assessmentHref && assessedSessions && rows.length) {
      try {
        const found = await assessedSessions(rows.map(row => row.session_id), new AbortController().signal)
        if (request === latest.current) setAssessed(found)
      } catch { /* the rows stay plain text; the assessment is still on Home and All assessments */ }
    }
  }

  // A new account starts from loading; a same-account refresh re-reads in the
  // background and replaces what is shown with its own result.
  useEffect(() => { setState({ kind: 'loading' }) }, [playerUserId])
  useEffect(() => { void load() }, [playerUserId, reloadOn])

  return (
    <section aria-label="Training" className="mt-6">
      <div className="text-[10px] tracking-[0.1em] uppercase text-ink-3 mb-2" style={{ fontFamily: 'var(--t-font-mono)' }}>
        Training
      </div>
      {state.kind === 'loading' && (
        <div role="status" aria-label="Loading training" className="h-12 rounded-[12px] bg-raised animate-pulse" />
      )}
      {state.kind === 'failed' && (
        <LoadError what="your training" retrying={retrying} onRetry={() => { setRetrying(true); void load() }} />
      )}
      {state.kind === 'awaiting_consent' && (
        <p className="text-[13px] text-ink-2">{waitingText}</p>
      )}
      {state.kind === 'ready' && state.rows.length === 0 && (
        <p className="text-[13px] text-ink-2">No training recorded yet.</p>
      )}
      {state.kind === 'ready' && state.rows.length > 0 && (
        <ul className="space-y-2">
          {state.rows.map(row => (
            <li key={row.session_id}
              className="rounded-[12px] border border-line"
              style={{ background: 'rgb(var(--t-surface))' }}>
              {assessmentHref && (!assessedSessions || assessed.has(row.session_id)) ? <Link to={assessmentHref(row.session_id)} className="flex items-center justify-between gap-3 min-h-11 px-4 py-3 rounded-[12px] focus-visible:ring-2 focus-visible:ring-primary">
                <TrainingRow row={row} />
              </Link> : <div className="flex items-center justify-between px-4 py-3"><TrainingRow row={row} /></div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TrainingRow({ row }: { row: Row }) {
  return <>
    <div className="min-w-0">
      <div className="text-[13px] text-ink">{row.focus?.length ? row.focus.join(' · ') : 'Training'}</div>
      <div className="text-[11px] text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>{formatParentDate(row.session_date)}</div>
    </div>
    <span className="text-[11px] text-ink-2 shrink-0">{ATTENDANCE[row.attendance] ?? row.attendance}</span>
  </>
}
