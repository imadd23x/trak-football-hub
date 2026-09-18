import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Sparkles, ClipboardList } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel, PitchDiagram, detectDiagrams, PRESETS } from '@/components/trak'
import type { DiagramData } from '@/components/trak'
import { trackEvent } from '@/lib/telemetry'

type Msg = { role: 'user' | 'assistant'; content: string }
type Segment = { type: 'text'; content: string } | { type: 'diagram'; data: DiagramData }

/**
 * Split an assistant message into interleaved text + diagram segments.
 * Primary: parse explicit [diagram:preset_id] tags placed by the AI.
 * Fallback: keyword scan on ### sections for any drills without tags.
 */
function buildSegments(content: string): Segment[] {
  // Strip legacy ```diagram blocks
  const cleaned = content
    .replace(/```diagram\n([\s\S]*?)```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Split on [diagram:id] tags — captured groups end up as alternating elements
  // e.g. "text [diagram:rondo_4v1] more text" → ["text ", "rondo_4v1", " more text"]
  const TAG_RE = /\[diagram:([a-z0-9_]+)\]/g
  const parts = cleaned.split(TAG_RE)

  const segments: Segment[] = []
  const usedKeys = new Set<string>()

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Text chunk — also run fallback keyword detection on ### sections
      const chunk = parts[i]
      if (!chunk.trim()) continue

      // Split into ### sub-sections for fallback diagram detection
      const subParts = chunk.split(/(?=^###\s)/m)
      for (const sub of subParts) {
        if (!sub.trim()) continue
        segments.push({ type: 'text', content: sub.trim() })

        // Fallback: keyword detect only if no explicit tag was used for this section
        const found = detectDiagrams(sub)
        for (const d of found) {
          const key = d.id ?? d.title ?? ''
          if (key && !usedKeys.has(key)) {
            usedKeys.add(key)
            segments.push({ type: 'diagram', data: d })
            break
          }
        }
      }
    } else {
      // Diagram tag — look up preset by id
      const id = parts[i]
      if (!usedKeys.has(id) && PRESETS[id]) {
        usedKeys.add(id)
        segments.push({ type: 'diagram', data: PRESETS[id] })
      }
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: cleaned }]
}

// Detect whether an AI response looks like a session or drill plan
function isSessionPlan(content: string) {
  return /warm.?up|main drill|session plan|rondo|drill|small.?sided|possession game|cool.?down/i.test(content)
}

// Extract pre-fill data from an AI session plan message
function extractPlan(content: string) {
  const lower = content.toLowerCase()
  const focus: string[] = []
  if (/technical|passing|first touch|control|dribbling/.test(lower))    focus.push('Technical')
  if (/tactical|press|shape|transition|position/.test(lower))           focus.push('Tactical')
  if (/finish|shooting|goal|1v1/.test(lower))                           focus.push('Finishing')
  if (/set piece|corner|free kick|penalty/.test(lower))                 focus.push('Set Pieces')
  if (/physical|fitness|speed|conditioning/.test(lower))                focus.push('Physical')
  if (/possession|rondo|keep.?ball/.test(lower))                        focus.push('Possession')
  if (/goalkeeper|gk\b/.test(lower))                                    focus.push('Goalkeeper')
  if (/small.?sided|ssg|game based|match scenario/.test(lower))         focus.push('Game Based')

  const durMatch = content.match(/(\d+)[- ]?min/i)
  const duration = durMatch ? Math.min(120, Math.max(30, parseInt(durMatch[1]))) : 60
  const notes = 'Coach Assistant'

  return { focus: focus.length ? focus : ['Training'], duration, notes }
}

export default function CoachAssistant() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [ageGroup, setAgeGroup] = useState('')
  const [showDisclosure, setShowDisclosure] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('coach_details').select('team').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data?.team) setAgeGroup(data.team) })
  }, [user])

  const tag = ageGroup || 'my team'
  const PROMPTS = [
    `Plan a training session for ${tag}`,
    `3 drills to work on finishing`,
    `Warm-up ideas for match day`,
    `How do I improve my team's pressing?`,
  ]
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading])

  const send = async (textRaw?: string) => {
    const text = (textRaw ?? input).trim()
    if (!text || isLoading) return
    const userMsg: Msg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    trackEvent('assistant_used', { turn: messages.length + 1 })
    setInput('')
    setIsLoading(true)

    let acc = ''
    const upsert = (chunk: string) => {
      acc += chunk
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant') {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: acc } : m))
        }
        return [...prev, { role: 'assistant', content: acc }]
      })
    }

    try {
      // The function now requires a real signed-in coach and 401s otherwise
      // (K8/X4). There used to be a fallback to the anon key here, with a
      // comment saying the function tolerated it because verify_jwt = false —
      // that is exactly the hole K8 closed, and the anon key is a validly
      // signed JWT that proves nothing about who is calling. Sending it now
      // just earns a 401 and an unhelpful toast, so ask for a session instead.
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        toast.error('Your session has expired — sign in again to use the assistant.')
        setIsLoading(false)
        return
      }

      const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/coach-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          includeSquadContext: true,
        }),
      })

      if (!resp.ok) {
        // The function explains a refusal in the body: a spent daily allowance
        // is not the same as "try again shortly", and telling a coach to retry
        // in a moment when the answer is tomorrow is just a wrong instruction.
        // Prefer the server's sentence; fall back only when there isn't one.
        const body = await resp.json().catch(() => ({} as { error?: string }))
        if (body?.error) toast.error(body.error)
        else if (resp.status === 401) toast.error('Your session has expired — sign in again.')
        else if (resp.status === 429) toast.error('Rate limit reached, try again shortly.')
        else if (resp.status === 402) toast.error('AI credits exhausted. Add credits in workspace settings.')
        else toast.error('Assistant unavailable')
        setIsLoading(false)
        return
      }
      if (!resp.body) throw new Error('No stream')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false
      while (!done) {
        const { done: rd, value } = await reader.read()
        if (rd) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (line.endsWith('\r')) line = line.slice(0, -1)
          if (line.startsWith(':') || line.trim() === '') continue
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (json === '[DONE]') { done = true; break }
          try {
            const parsed = JSON.parse(json)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) upsert(content)
          } catch {
            buffer = line + '\n' + buffer
            break
          }
        }
      }
    } catch (e: any) {
      console.error(e)
      toast.error('Assistant error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <MobileShell>
      <div className="pt-3 pb-32 flex flex-col" style={{ minHeight: '100vh' }}>
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 999, background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}
            aria-label="Back"
          >
            <ArrowLeft size={16} color="rgba(255,255,255,0.6)" />
          </button>
          <div>
            <p className="text-[9px] tracking-[0.12em] uppercase" style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.35)' }}>
              Coach
            </p>
            <h1 className="text-[22px] leading-tight" style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, color: 'rgba(255,255,255,0.88)' }}>
              Assistant
            </h1>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3">
          {messages.length === 0 && (
            <div className="rounded-[18px] border border-white/[0.07] p-5" style={{ background: '#101012' }}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} color="#C8F25A" />
                <MetadataLabel text="TRY ASKING" />
              </div>
              <div className="space-y-2 mt-3">
                {PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => send(p)}
                    className="w-full text-left rounded-[12px] p-3 transition"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.78)' }}>{p}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const isStreaming = m.role === 'assistant' && isLoading && i === messages.length - 1
            // Only build segments once streaming is complete (avoids partial-text flicker)
            const segments: Segment[] = isStreaming
              ? [{ type: 'text', content: m.content }]
              : (m.role === 'assistant' ? buildSegments(m.content) : [{ type: 'text', content: m.content }])

            const mdComponents = {
              h1: ({ node, ...props }: any) => <h3 style={{ fontSize: 15, fontWeight: 600, marginTop: 12, marginBottom: 6, color: 'rgba(255,255,255,0.95)' }} {...props} />,
              h2: ({ node, ...props }: any) => <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 12, marginBottom: 6, color: 'rgba(255,255,255,0.95)' }} {...props} />,
              h3: ({ node, ...props }: any) => <h4 style={{ fontSize: 13, fontWeight: 600, marginTop: 10, marginBottom: 4, color: 'rgba(255,255,255,0.92)' }} {...props} />,
              p: ({ node, ...props }: any) => <p style={{ margin: '6px 0' }} {...props} />,
              ul: ({ node, ...props }: any) => <ul style={{ margin: '6px 0', paddingLeft: 18 }} {...props} />,
              ol: ({ node, ...props }: any) => <ol style={{ margin: '6px 0', paddingLeft: 18 }} {...props} />,
              li: ({ node, ...props }: any) => <li style={{ margin: '2px 0' }} {...props} />,
              strong: ({ node, ...props }: any) => <strong style={{ color: 'rgba(255,255,255,0.95)' }} {...props} />,
              code: ({ node, ...props }: any) => <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }} {...props} />,
            }

            return (
              <div
                key={i}
                className="rounded-[14px] p-3.5"
                style={{
                  background: m.role === 'user' ? 'rgba(200,242,90,0.06)' : '#101012',
                  border: m.role === 'user' ? '1px solid rgba(200,242,90,0.18)' : '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <p className="text-[8px] tracking-[0.12em] uppercase mb-2" style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>
                  {m.role === 'user' ? 'You' : 'Trak AI'}
                </p>

                {/* Render interleaved text + diagram segments */}
                {segments.map((seg, si) =>
                  seg.type === 'diagram' ? (
                    <PitchDiagram key={si} data={seg.data} />
                  ) : (
                    <div
                      key={si}
                      className="prose prose-sm max-w-none"
                      style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 1.55, fontFamily: "'DM Sans', sans-serif" }}
                    >
                      <ReactMarkdown components={mdComponents}>{seg.content}</ReactMarkdown>
                      {isStreaming && si === segments.length - 1 && <span style={{ opacity: 0.4 }}>▍</span>}
                    </div>
                  )
                )}

                {/* Log this session button — shown on completed training plan responses */}
                {!isStreaming && m.role === 'assistant' && isSessionPlan(m.content) && (
                  <button
                    onClick={() => {
                      const plan = extractPlan(m.content)
                      navigate('/coach/sessions/add', { state: { fromAssistant: plan } })
                    }}
                    className="flex items-center gap-2 mt-3 px-3 py-2 rounded-[10px] w-full transition-colors active:scale-[0.98]"
                    style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.2)' }}>
                    <ClipboardList size={13} color="#C8F25A" />
                    <span className="text-[11px] font-medium" style={{ color: '#C8F25A', fontFamily: "'DM Sans', sans-serif" }}>
                      Log this as a session
                    </span>
                  </button>
                )}
              </div>
            )
          })}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="rounded-[14px] border border-white/[0.07] p-4" style={{ background: '#101012' }}>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Thinking…</p>
            </div>
          )}
        </div>

        <div
          className="fixed bottom-[72px] left-1/2 -translate-x-1/2 w-full max-w-[430px] px-4 pb-2"
          style={{ background: 'linear-gradient(to top, rgba(10,10,11,1) 60%, rgba(10,10,11,0))' }}
        >
          {/* Disclosure note */}
          <button
            onClick={() => setShowDisclosure(v => !v)}
            className="w-full text-left mb-1.5 px-1"
          >
            <span className="text-[9px] tracking-[0.08em] text-white/25 flex items-center gap-1.5"
              style={{ fontFamily: "'DM Mono', monospace" }}>
              <span>ⓘ</span>
              <span>About these recommendations</span>
              <span className="ml-auto">{showDisclosure ? '▲' : '▼'}</span>
            </span>
            {showDisclosure && (
              <p className="text-[11px] leading-[1.6] text-white/40 mt-1.5 pr-2"
                style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Drills and session plans are AI-generated based on established football coaching methodology, following UEFA coaching principles — warm-up, technical focus, game application. These are a starting point. Not every suggestion will suit your squad's age group or level, so your judgment as a coach always takes priority.
              </p>
            )}
          </button>

          <div className="flex items-end gap-2 rounded-[14px] p-2" style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Ask for a drill, session plan, or idea…"
              rows={1}
              className="flex-1 outline-none resize-none p-2 text-[13px]"
              style={{ background: 'transparent', color: 'rgba(255,255,255,0.88)', maxHeight: 120 }}
            />
            <button
              onClick={() => send()}
              disabled={isLoading || !input.trim()}
              className="rounded-full flex items-center justify-center"
              style={{
                width: 36, height: 36,
                background: input.trim() && !isLoading ? '#C8F25A' : 'rgba(255,255,255,0.06)',
                color: '#000',
              }}
              aria-label="Send"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
      <NavBar role="coach" activeTab="/coach/home" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}