import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { trackEvent } from '@/lib/telemetry'

type FeedbackState =
  | { status: 'loading' | 'empty' | 'error' }
  | { status: 'ready'; body: string }

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
        const { data, error } = await (supabase as SupabaseClient).from('coach_shared_feedback')
          .select('body').eq('assessment_id', assessmentId)
          .not('published_at', 'is', null).abortSignal(controller.signal).returns<{ body: unknown }[]>().maybeSingle()
        if (!current) return
        if (error) throw error
        if (!data) setState({ status: 'empty' })
        else if (typeof data.body !== 'string' || !data.body.trim()) setState({ status: 'error' })
        else setState({ status: 'ready', body: data.body })
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
  }, [state, assessmentId])

  return (
    <MobileShell>
      <main className="py-6 space-y-6">
        <Link to="/player/home" className="inline-flex min-h-11 items-center text-sm text-muted-foreground">Back to home</Link>
        <h1 className="text-2xl font-semibold text-foreground">Coach feedback</h1>
        {state.status === 'loading' && <p role="status" className="text-muted-foreground">Loading feedback…</p>}
        {state.status === 'error' && <div role="alert" className="space-y-3">
          <p className="text-muted-foreground">Couldn't load feedback. Please try again.</p>
          <button onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-xl bg-primary px-5 text-primary-foreground">Retry</button>
        </div>}
        {state.status === 'empty' && <p className="text-muted-foreground">Your coach is still writing your feedback.</p>}
        {state.status === 'ready' && <p className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-card p-5 leading-relaxed text-foreground">{state.body}</p>}
      </main>
    </MobileShell>
  )
}
