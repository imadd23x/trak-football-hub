import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MetadataLabel } from '@/components/trak'
import { ChevronLeft, Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { trackEvent } from '@/lib/telemetry'

/**
 * T2 — the coach reviews every word before a child sees it.
 *
 * The AI produces a draft. It is stored in ai_feedback_drafts, which a player
 * has no grant on, so generating costs nothing in exposure and a draft that is
 * never approved simply stays where only the coach can see it.
 *
 * Publishing goes through publish_player_feedback(), which re-checks ownership
 * (SECURITY DEFINER bypasses RLS), requires the coach role, and refuses
 * entirely when parental consent is required and has not been given.
 */

interface FeedbackPoint {
  title: string
  what: string
  why: string
  drill: string
}

interface FeedbackDraft {
  points: FeedbackPoint[]
  encouragement: string
}

/** What the child will actually read, assembled from the edited fields. */
function toPublishedText(draft: FeedbackDraft): string {
  return JSON.stringify(draft)
}

export default function CoachReviewFeedback() {
  const { assessmentId } = useParams<{ assessmentId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<FeedbackDraft | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [squadPlayerId, setSquadPlayerId] = useState<string | null>(null)
  const [playerName, setPlayerName] = useState<string>('')
  const [published, setPublished] = useState<{ at: string } | null>(null)

  useEffect(() => {
    if (!user || !assessmentId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      const { data: assessment, error: aErr } = await supabase
        .from('coach_assessments')
        .select('id, squad_player_id')
        .eq('id', assessmentId)
        .maybeSingle()

      if (cancelled) return
      if (aErr) { setError("Couldn't load that assessment"); setLoading(false); return }
      if (!assessment) { setError('Assessment not found'); setLoading(false); return }

      setSquadPlayerId(assessment.squad_player_id)

      const { data: sp } = await supabase
        .from('squad_players')
        .select('player_name')
        .eq('id', assessment.squad_player_id)
        .maybeSingle()
      if (!cancelled) setPlayerName(sp?.player_name ?? 'this player')

      // An existing publication is shown as-is, so a coach editing later starts
      // from what the child is currently reading rather than from a fresh draft.
      const { data: current } = await supabase
        .from('player_feedback' as never)
        .select('published_text, published_at')
        .eq('assessment_id', assessmentId)
        .is('superseded_at', null)
        .maybeSingle() as { data: { published_text: string; published_at: string } | null }

      if (!cancelled && current) {
        try {
          setDraft(JSON.parse(current.published_text))
          setPublished({ at: current.published_at })
        } catch { /* a malformed stored value falls through to generation */ }
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [user, assessmentId])

  const generate = async () => {
    if (!assessmentId) return
    setGenerating(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Your session has expired — sign in again')

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/player-feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ assessment_id: assessmentId }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`)

      setDraft(body.feedback)
      setDraftId(body.draft_id ?? null)
      trackEvent('coach_generated_feedback_draft', { actor: 'coach' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a draft')
    } finally {
      setGenerating(false)
    }
  }

  const publish = async () => {
    if (!draft || !squadPlayerId) return
    setPublishing(true)
    try {
      const { error: rpcError } = await (supabase as never as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>
      }).rpc('publish_player_feedback', {
        p_squad_player_id: squadPlayerId,
        p_text: toPublishedText(draft),
        p_draft_id: draftId,
      })

      if (rpcError) {
        const msg = String(rpcError.message || '')
        // The consent refusal is a rule, not a fault — say which it is.
        if (/parental consent/i.test(msg)) {
          toast.error("This player's parent hasn't approved their account yet, so feedback can't be sent")
        } else if (/not your player/i.test(msg)) {
          toast.error('This player is no longer in your squad')
        } else {
          toast.error("Couldn't publish just now — please try again")
        }
        return
      }

      trackEvent('coach_published_feedback', { actor: 'coach' })
      toast.success(`Sent to ${playerName.split(' ')[0]}`)
      setPublished({ at: new Date().toISOString() })
    } finally {
      setPublishing(false)
    }
  }

  const updatePoint = (i: number, field: keyof FeedbackPoint, value: string) => {
    if (!draft) return
    const points = draft.points.map((p, idx) => (idx === i ? { ...p, [field]: value } : p))
    setDraft({ ...draft, points })
  }

  return (
    <div className="flex flex-col mx-auto max-w-[430px] bg-[#0A0A0B] min-h-[100dvh]">
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => navigate(-1)} aria-label="Back"
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]">
          <ChevronLeft size={16} className="text-white/70" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px] pointer-events-none">
          Review feedback
        </h1>
      </div>

      <div className="flex-1 px-5 py-4 space-y-4">
        {loading ? (
          <p className="text-white/35 text-sm">Loading…</p>
        ) : error ? (
          <div role="alert" className="rounded-[14px] p-4 border border-white/[0.07] bg-[#101012]">
            <p className="text-[13px] text-white/70">{error}</p>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-white/45 leading-relaxed">
              Nothing here reaches {playerName.split(' ')[0] || 'the player'} until you send it.
              Edit anything you don't agree with — the words that get published are yours.
            </p>

            {!draft && (
              <button
                onClick={generate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[12px] text-[14px] font-medium text-black disabled:opacity-40"
                style={{ background: '#C8F25A' }}
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {generating ? 'Drafting…' : 'Draft feedback'}
              </button>
            )}

            {draft && (
              <>
                {published && (
                  <div className="rounded-[12px] px-3 py-2.5"
                    style={{ background: 'rgba(200,242,90,0.06)', border: '1px solid rgba(200,242,90,0.18)' }}>
                    <p className="text-[11px] text-[#C8F25A]">
                      Sent — {playerName.split(' ')[0]} can read this now. Editing and sending
                      again replaces it.
                    </p>
                  </div>
                )}

                {draft.points.map((point, i) => (
                  <div key={i} className="rounded-[14px] p-4 border border-white/[0.07] bg-[#101012] space-y-2">
                    <MetadataLabel text={`POINT ${i + 1}`} />
                    <input
                      value={point.title}
                      onChange={e => updatePoint(i, 'title', e.target.value)}
                      aria-label={`Point ${i + 1} title`}
                      className="w-full bg-transparent text-[14px] text-white/88 outline-none border-b border-white/[0.07] pb-1.5"
                    />
                    {(['what', 'why', 'drill'] as const).map(field => (
                      <textarea
                        key={field}
                        value={point[field]}
                        onChange={e => updatePoint(i, field, e.target.value)}
                        aria-label={`Point ${i + 1} ${field}`}
                        rows={2}
                        className="w-full bg-transparent text-[12px] text-white/60 outline-none resize-none leading-relaxed"
                      />
                    ))}
                  </div>
                ))}

                <div className="rounded-[14px] p-4 border border-white/[0.07] bg-[#101012] space-y-2">
                  <MetadataLabel text="CLOSING" />
                  <textarea
                    value={draft.encouragement}
                    onChange={e => setDraft({ ...draft, encouragement: e.target.value })}
                    aria-label="Closing encouragement"
                    rows={2}
                    className="w-full bg-transparent text-[12px] text-white/60 outline-none resize-none leading-relaxed"
                  />
                </div>

                <button
                  onClick={publish}
                  disabled={publishing}
                  className="w-full py-3.5 rounded-[12px] text-[14px] font-medium text-black disabled:opacity-40"
                  style={{ background: '#C8F25A' }}
                >
                  {publishing ? 'Sending…' : published ? 'Send update' : `Send to ${playerName.split(' ')[0] || 'player'}`}
                </button>

                <button
                  onClick={generate}
                  disabled={generating}
                  className="w-full py-3 rounded-[12px] text-[12px] text-white/45 border border-white/[0.07] disabled:opacity-40"
                >
                  {generating ? 'Drafting…' : 'Draft again'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
