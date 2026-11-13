import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { trackEvent } from '@/lib/telemetry'
import { markOpened } from '@/lib/games/news'
import { AssessmentBands, type AssessmentScores } from '@/components/player/AssessmentBands'
import { EvaluationProgressCard } from '@/components/player/EvaluationProgressCard'
import { useEvaluationProgress } from '@/lib/evaluation-progress'

// TRAK-401: evaluation is set when this assessment closed a season evaluation (published with no session).
type FeedbackState =
  | { status: 'loading' | 'error' }
  | { status: 'empty'; scores: AssessmentScores | null; evaluation: boolean }
  | { status: 'ready'; body: string; scores: AssessmentScores | null; evaluation: boolean }

/** Mounted only for an evaluation's assessment, so a session assessment makes no progress request. */
function EvaluationProgress({ assessmentId }: { assessmentId: string }) {
  const progress = useEvaluationProgress([assessmentId])
  if (progress.isError) return <div role="alert" className="space-y-3">
    <p className="text-muted-foreground">Couldn't load your progress. Please try again.</p>
    <button onClick={() => void progress.refetch()} className="min-h-11 rounded-xl bg-primary px-5 text-primary-foreground">Retry</button>
  </div>
  return <EvaluationProgressCard objectives={progress.data?.get(assessmentId)?.objectives ?? []} />
}

export default function PlayerFeedback() {
  const { assessmentId } = useParams<{ assessmentId: string }>()
  const { user } = useAuth()
  // Remount before paint on identity/assessment changes to clear old messages.
  return <FeedbackMessage key={`${user?.id}:${assessmentId}`} account={user} assessmentId={assessmentId} />
}

function FeedbackMessage({ account, assessmentId }: { account: { id: string } | null; assessmentId?: string }) {
  const [state, setState] = useState<FeedbackState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    setState({ status: 'loading' })
    const load = async () => {
      if (!account || !assessmentId) {
        setState({ status: 'error' })
        return
      }
      try {
        // G7 permits only explicitly published coach words, including in DEV.
        // This migrated table is not yet in the repository's generated types.
        // TRAK-171 (live run 3): the screen shows this assessment's bands too,
        // as Home does; a failed read of them is said, not hidden.
        const [{ data, error }, bands] = await Promise.all([
          (supabase as SupabaseClient).from('coach_shared_feedback')
            .select('body').eq('assessment_id', assessmentId)
            .not('published_at', 'is', null).abortSignal(controller.signal).returns<{ body: unknown }[]>().maybeSingle(),
          supabase.from('coach_assessments')
            .select('work_rate, tactical, attitude, technical, physical, coachability, evaluation_id')
            .eq('id', assessmentId).abortSignal(controller.signal).maybeSingle(),
        ])
        if (!current) return
        if (error) throw error
        if (bands.error) throw bands.error
        const scores = (bands.data as AssessmentScores | null) ?? null
        const evaluation = !!bands.data?.evaluation_id
        if (!data) setState({ status: 'empty', scores, evaluation })
        else if (typeof data.body !== 'string' || !data.body.trim()) setState({ status: 'error' })
        else setState({ status: 'ready', body: data.body, scores, evaluation })
      } catch {
        if (current) setState({ status: 'error' })
      }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [account, assessmentId, attempt])

  useEffect(() => {
    // Count only a message that has committed to the screen, never empty/error.
    if (state.status === 'ready' && assessmentId) trackEvent('feedback_opened', { assessment_id: assessmentId })
    // TRAK-441: once the evaluation shows, Home's Latest evaluation stops saying New on this device.
    if ((state.status === 'ready' || state.status === 'empty') && account && assessmentId) markOpened(account.id, account.id, 'evaluation', assessmentId)
  }, [state, assessmentId, account])

  const evaluation = (state.status === 'ready' || state.status === 'empty') && state.evaluation
  return (
    <MobileShell>
      <main className="py-6 space-y-6">
        <Link to="/player/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground">Back to home</Link>
        <h1 className="text-2xl font-semibold text-foreground">{evaluation ? 'Evaluation' : 'Coach feedback'}</h1>
        {state.status === 'loading' && <p role="status" className="text-muted-foreground">Loading feedback…</p>}
        {state.status === 'error' && <div role="alert" className="space-y-3">
          <p className="text-muted-foreground">Couldn't load feedback. Please try again.</p>
          <button onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-xl bg-primary px-5 text-primary-foreground">Retry</button>
        </div>}
        {/* An evaluation's note is optional, so no note is not "still writing". */}
        {state.status === 'empty' && !state.evaluation && <p className="text-muted-foreground">Your coach is still writing your feedback.</p>}
        {state.status === 'ready' && !state.evaluation && <p className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-card p-5 leading-relaxed text-foreground">{state.body}</p>}
        {(state.status === 'ready' || state.status === 'empty') && state.scores &&
          // TRAK-229: a light card like the rest; the bands carry their own colours.
          <section className="rounded-2xl border border-border bg-card p-5"><AssessmentBands scores={state.scores} /></section>}
        {/* TRAK-401: the evaluation reads bands, then Progress, then the coach's note, which only the player sees. */}
        {evaluation && assessmentId && <EvaluationProgress assessmentId={assessmentId} />}
        {state.status === 'ready' && state.evaluation && <section aria-label="From your coach" className="grid gap-1 rounded-2xl bg-brand/[0.12] p-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">From your coach, only you see this</p>
          <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed text-foreground">{state.body}</p>
        </section>}
      </main>
    </MobileShell>
  )
}
