import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { ChevronLeft, Sparkles, Send, Loader2, MessageSquare } from 'lucide-react'
import { trackEvent } from '@/lib/telemetry'
import { SSEBuffer } from '@/lib/sse-buffer'

/* ---------- types (forward-declared so FEEDBACK_BANK can reference them) ---------- */

interface FeedbackPoint {
  title: string
  what: string
  why: string
  drill: string
}

interface FeedbackData {
  points: FeedbackPoint[]
  encouragement: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface FeedbackContext {
  note: string
  playerName: string
  position: string
  rating: string
}

/* ---------- feedback bank — one entry per football topic ---------- */

const FEEDBACK_BANK: Record<string, FeedbackPoint> = {
  speed: {
    title: 'Developing your pace and acceleration',
    what: "Your coach wants to see you sharper off the mark — those first 5 metres make the difference between winning the ball and losing it.",
    why: "Explosive acceleration in short bursts creates chances and wins duels. It's not about top speed — it's about reacting and moving before defenders can set.",
    drill: "Set up 4 cones in a line, 5m apart. From a standing start, sprint through all 4, walk back, repeat. Focus entirely on your first 2 steps — drive your knees up and push hard off the ground. 8 reps, 3 sets. Do this twice a week and you'll notice real improvement within a month.",
  },
  dribbling: {
    title: 'Taking players on in 1v1 situations',
    what: "Your coach wants you to commit to taking players on more — using your body, change of pace, and ball control to beat defenders confidently.",
    why: "A player who can regularly beat their man in a 1v1 creates overloads and opens up space for the whole team. It's one of the most direct ways to change a game.",
    drill: "Set up a cone 10m away. Dribble toward it at pace, use a sharp move to go around it (inside cut, stepover, chop, drag-back — rotate between them), then accelerate away. Do 10 reps of each move, focusing on keeping the ball under tight control at speed, not just nudging it past.",
  },
  heading: {
    title: 'Winning aerial duels',
    what: "Your coach has flagged your heading — specifically the timing of your jump and making clean contact with the right part of the ball.",
    why: "Set pieces and long balls decide a huge number of youth football matches. A player who is confident in the air becomes an asset at both attacking corners and defending them.",
    drill: "Start by throwing a ball slightly above your head and heading it back — focus on using your forehead (not the top of your head) and snapping your neck through the ball. Progress to jumping headers from standing. Get a teammate to deliver from the side so you practice timing your run. 20 reps every session.",
  },
  passing: {
    title: 'Sharpening your passing and tempo',
    what: "Your coach wants tighter passing — either the weight, the decision-making, or the speed of release needs to improve so your team keeps moving forward.",
    why: "Accurate, well-timed passing keeps your team in control and in rhythm. A player who can deliver the right pass at the right moment is impossible to press effectively.",
    drill: "Rondo 4v1: 4 players keep the ball from 1 defender in a small square. Maximum 2 touches. Add a rule that one pass per round must switch to the opposite side of the square. This trains quick release and disguising your intent under pressure.",
  },
  first_touch: {
    title: 'Improving your first touch under pressure',
    what: "When defenders close you down, your first touch is taking the ball away from your next move — giving them the chance to win it back.",
    why: "A clean first touch into space gives you a split-second that changes the whole situation. Controlling the ball before defenders fully arrive is one of the highest-value technical skills you can develop.",
    drill: "Ask a teammate to throw the ball at you from 5m away while you face away. On the throw, turn and direct your first touch into space with one movement. Repeat 20 times to each side. The goal is placing the touch exactly where you want — not just stopping the ball.",
  },
  positioning: {
    title: 'Reading the game and finding space',
    what: "Your coach wants to see smarter movement — particularly where you are when your team is out of possession and how you position yourself to receive.",
    why: "Good positioning makes every other skill more effective. Players who are in the right place at the right time always look like they have more time on the ball — because they've already done the thinking.",
    drill: "In your next training session, spend the first 15 minutes focusing only on positioning — not worrying about the ball at all. Every 10 seconds ask yourself: 'Am I in the best position right now? Where does space open up if we win the ball here?' Develop the habit of constant repositioning.",
  },
  shooting: {
    title: 'Improving your finishing',
    what: "Your coach wants you to be more clinical — hitting the target more consistently and choosing the right technique for each opportunity.",
    why: "Finishing is the most direct way to impact the result. Better technique and decision-making in front of goal can translate to extra goals across a season.",
    drill: "Place 5 balls at the edge of the box. Practice finishing with different techniques in sequence: laces-driven shot, inside-foot placed finish, first-time hit, and a 1-2 fake before shooting. For every shot, pick a specific corner before you strike — placement over power every time.",
  },
  work_rate: {
    title: 'Pressing intensity and effort off the ball',
    what: "Your coach wants to see more energy when your team doesn't have the ball — pressing higher and closing space more quickly to force mistakes.",
    why: "Teams that press well win the ball in dangerous areas and make life hard for opponents. Individual pressing effort — even when it doesn't result in a steal — creates pressure that lifts the whole team.",
    drill: "Pick a press trigger: when the ball goes to feet, when it's played backwards, or when the keeper has it. Every time that trigger happens, sprint to close within 2 seconds. In training, set yourself a target of 10 correct press moments per session and track them mentally.",
  },
  tracking: {
    title: 'Tracking runners defensively',
    what: "When opposition players make runs in behind, you're staying too high — your coach has noticed gaps appearing that defenders are being left to deal with alone.",
    why: "Tracking runners is one of the most valuable defensive habits in the game. It stops goals, keeps your team's shape intact, and protects your defenders in situations they shouldn't face.",
    drill: "In your next team training, pick one opposition player to track for the whole session — wherever they run, you follow. Communicate with centre-backs: 'I've got him' or 'yours.' Build the habit of glancing behind you every few seconds. Awareness first, then the reaction.",
  },
  awareness: {
    title: 'Scanning before you receive the ball',
    what: "You need to check your shoulders more before the ball arrives so you already know your options when it reaches you — instead of deciding under pressure.",
    why: "Players who scan before receiving look a step ahead of everyone else on the pitch. It's what makes some players seem like they always have time — they've processed the picture before touching the ball.",
    drill: "Every time you're about to receive in training, count how many shoulder checks you do before the ball arrives. Aim for at least 2. Do this in warm-ups and rondos as well as full games — it needs to become completely automatic.",
  },
  communication: {
    title: 'Being vocal and organising around you',
    what: "Your coach wants you to be more communicative — directing teammates, calling for the ball, and making sure the players around you know what's happening.",
    why: "Communicating players make the whole team better by reducing confusion and increasing structure. Coaches at every level look for players who can lead through their voice as well as their ability.",
    drill: "Set yourself a target in every session: say at least 20 things out loud. 'Man on!', 'Turn!', 'Mine!', 'Switch it!', 'Time!'. It'll feel forced at first — do it anyway. Within a few sessions your teammates will start relying on your voice and it'll become second nature.",
  },
  crossing: {
    title: 'Delivery and crossing from wide areas',
    what: "Your coach wants your delivery from wide positions to be more consistent — the right weight and flight to reach your forwards at pace.",
    why: "Quality crossing directly creates goals. Even a 10% improvement in delivery accuracy translates to more chances created per game.",
    drill: "Set up targets in the box — a cone at the near post, one at the penalty spot, one at the far post. Deliver 10 crosses to each target from both sides. Focus on your approach angle: a curved run into the ball gives you more power and whip than running straight.",
  },
  confidence: {
    title: 'Backing yourself on the ball',
    what: "Your coach has noticed moments where you're second-guessing yourself — taking the safe option or giving it back too quickly when pressed.",
    why: "Confidence on the ball is a skill you build, not just a feeling you wait for. The more decisions you commit to in training — right or wrong — the more natural everything becomes in a match.",
    drill: "In training, give yourself permission to make mistakes. Pick 3 things to attempt in the next session (a specific dribble, a long switch, a turn under pressure) and try each at least 3 times. The goal is the attempt, not the outcome. Confidence comes from reps, not from getting it right every time.",
  },
  fitness: {
    title: 'Physical platform and athleticism',
    what: "Your coach wants to see more physicality — whether that's in duels, second-half intensity, or your ability to recover and get into position quickly.",
    why: "Physical conditioning is the platform that every other skill sits on. Technical ability counts for nothing if you're struggling to cover ground or hold your level in the second half.",
    drill: "Three times a week, 20 minutes: 4 x 30m sprints with 30 seconds rest between each, then 3 rounds of 10 press-ups and 20 bodyweight squats. Stick to this consistently for 4 weeks and you'll feel a real difference in your acceleration and how you perform late in games.",
  },
}

/* ---------- keyword → bank key mapping ---------- */

const KEYWORD_MAP: Array<{ keywords: string[]; key: string }> = [
  { keywords: ['speed', 'pace', 'fast', 'acceleration', 'sprint', 'quick', 'burst'], key: 'speed' },
  { keywords: ['dribbling', 'dribble', 'ball control', '1v1', 'take on', 'beat', 'wriggle'], key: 'dribbling' },
  { keywords: ['heading', 'header', 'aerial', 'aerial duel', 'head the ball', 'head'], key: 'heading' },
  { keywords: ['passing', 'pass', 'distribution', 'combination', 'tempo', 'one-touch', 'one touch'], key: 'passing' },
  { keywords: ['first touch', 'touch', 'control', 'receive', 'reception', 'trap'], key: 'first_touch' },
  { keywords: ['positioning', 'position', 'movement off', 'shape', 'finding space', 'runs off'], key: 'positioning' },
  { keywords: ['shooting', 'finish', 'goal', 'shot', 'clinical', 'striker', 'on target'], key: 'shooting' },
  { keywords: ['work rate', 'pressing', 'press', 'effort', 'intensity', 'high press', 'closing'], key: 'work_rate' },
  { keywords: ['tracking', 'runners', 'defensive', 'track back', 'recover', 'marking'], key: 'tracking' },
  { keywords: ['shoulder', 'awareness', 'scanning', 'scan', 'head up', 'eyes up'], key: 'awareness' },
  { keywords: ['communication', 'vocal', 'talking', 'organis', 'leader', 'directing'], key: 'communication' },
  { keywords: ['crossing', 'cross', 'delivery', 'winger', 'wide play', 'cutback'], key: 'crossing' },
  { keywords: ['confidence', 'belief', 'mental', 'nervous', 'hesitant', 'second-guess'], key: 'confidence' },
  { keywords: ['fitness', 'physical', 'strength', 'stamina', 'endurance', 'athletic', 'second half'], key: 'fitness' },
]

/* ---------- dynamic demo feedback generator ---------- */

function generateDemoFeedback(
  note: string,
  playerName: string,
  position: string,
  rating: string,
): { feedback: FeedbackData; context: FeedbackContext } {
  const lower = note.toLowerCase()

  // Find bank keys whose keywords appear in the note, in order
  const matched: string[] = []
  for (const { keywords, key } of KEYWORD_MAP) {
    if (matched.includes(key)) continue
    if (keywords.some(kw => lower.includes(kw))) {
      matched.push(key)
    }
    if (matched.length === 3) break
  }

  // Pad to 3 with sensible fallbacks not already matched
  const fallbacks = ['first_touch', 'positioning', 'passing', 'awareness', 'work_rate']
  for (const key of fallbacks) {
    if (matched.length >= 3) break
    if (!matched.includes(key)) matched.push(key)
  }

  const points = matched.slice(0, 3).map(key => FEEDBACK_BANK[key])

  const ratingNum = parseFloat(rating) || 7
  let encouragement: string
  if (ratingNum >= 8) {
    encouragement = `You're already performing at a high level — these refinements are the difference between a good player and a great one. Keep working on them.`
  } else if (ratingNum >= 7) {
    encouragement = `Your coach sees real potential in you. These three areas are exactly where focused work will take your game to the next level.`
  } else {
    encouragement = `Every top player has been where you are right now. Work on these three things consistently and the improvement will come faster than you think.`
  }

  return {
    feedback: { points, encouragement },
    context: { note, playerName, position, rating },
  }
}

/* ---------- helpers ---------- */

function PointCard({ point, index }: { point: FeedbackPoint; index: number }) {
  const [open, setOpen] = useState(index === 0)
  const colors = ['#C8F25A', '#60a5fa', '#f472b6']
  const color = colors[index] || colors[0]

  return (
    <button
      onClick={() => setOpen(o => !o)}
      className="w-full text-left rounded-[18px] p-4 transition-all"
      style={{ background: '#101012', border: `1px solid ${open ? color + '30' : 'rgba(255,255,255,0.07)'}` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-[8px] flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
          style={{ background: color + '18', color }}
        >
          {index + 1}
        </div>
        <p className="flex-1 text-[14px] font-semibold text-white/88">{point.title}</p>
        <span className="text-white/25 text-[12px]">{open ? '−' : '+'}</span>
      </div>

      {open && (
        <div className="mt-3.5 ml-10 space-y-3">
          <div>
            <p className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/30 mb-1"
              style={{ fontFamily: "'DM Mono', monospace" }}>What to work on</p>
            <p className="text-[13px] text-white/70 leading-relaxed">{point.what}</p>
          </div>
          <div>
            <p className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/30 mb-1"
              style={{ fontFamily: "'DM Mono', monospace" }}>Why it matters</p>
            <p className="text-[13px] text-white/70 leading-relaxed">{point.why}</p>
          </div>
          <div className="rounded-[10px] px-3 py-2.5" style={{ background: 'rgba(200,242,90,0.06)', border: '1px solid rgba(200,242,90,0.12)' }}>
            <p className="text-[9px] font-medium tracking-[0.12em] uppercase text-[#C8F25A]/60 mb-1"
              style={{ fontFamily: "'DM Mono', monospace" }}>Try this drill</p>
            <p className="text-[12px] text-white/65 leading-relaxed">{point.drill}</p>
          </div>
        </div>
      )}
    </button>
  )
}

/* ========== main page ========== */

export default function PlayerFeedback() {
  const { assessmentId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [feedback, setFeedback] = useState<FeedbackData | null>(null)
  const [context, setContext] = useState<FeedbackContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Distinct from both "loaded" and "failed": the coach has not approved
  // anything yet, which is a normal state and not something to apologise for.
  const [awaitingCoach, setAwaitingCoach] = useState(false)

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  // T2 — the child-facing AI chat is off for the pilot.
  //
  // A live conversation cannot be approved in advance by a coach, so it cannot
  // coexist with the Gate 1 requirement that every AI message a child sees was
  // approved by their coach first. The server no longer serves it either: the
  // function is coach-only now, so leaving the composer visible would give a
  // child a button that always fails.
  //
  // The UI is gated rather than deleted so the decision is reversible and
  // visible. If it returns, it belongs on the coach's side of the line.
  const CHILD_CHAT_ENABLED = false
  const [showChat, setShowChat] = useState(false)

  const chatBottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  /* ---- load initial feedback ---- */
  useEffect(() => {
    if (!user || !assessmentId) return
    trackEvent('feedback_opened', { assessment_id: assessmentId })

    const load = async () => {
      setLoading(true)
      setError(null)

      // In dev mode, generate feedback dynamically from the actual note + player data
      // so any coach note produces relevant, topic-matched feedback points.
      if (import.meta.env.DEV) {
        const [{ data: noteRow }, { data: assessment }] = await Promise.all([
          supabase.from('coach_assessment_notes')
            .select('note').eq('assessment_id', assessmentId).maybeSingle(),
          supabase.from('coach_assessments')
            .select('coach_rating, squad_players(player_name, position)')
            .eq('id', assessmentId).maybeSingle(),
        ])

        const note = noteRow?.note || ''
        const squadPlayer = assessment?.squad_players as any
        const playerName = squadPlayer?.player_name?.split(' ')[0] || 'Player'
        const position   = squadPlayer?.position?.toUpperCase() || 'Player'
        const rating     = assessment?.coach_rating != null
          ? String(assessment.coach_rating)
          : '7.5'

        const demo = generateDemoFeedback(note, playerName, position, rating)
        await new Promise(r => setTimeout(r, 900))
        setFeedback(demo.feedback)
        setContext(demo.context)
        setLoading(false)
        return
      }

      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) throw new Error('Not authenticated')

        // T2 — the player no longer generates anything. This screen reads what
        // a coach has published and nothing else. Unapproved text lives in
        // ai_feedback_drafts, which this account has no grant on, so there is
        // no request a player could make that would return it.
        const { data: row, error: readError } = await supabase
          .from('player_feedback' as never)
          .select('published_text, published_at')
          .eq('assessment_id', assessmentId)
          .is('superseded_at', null)
          .maybeSingle() as { data: { published_text: string; published_at: string } | null; error: unknown }

        if (readError) throw new Error("Couldn't load your feedback")

        if (!row) {
          // Not an error: the coach has not approved anything for this
          // assessment yet. Saying so plainly beats an empty screen or a
          // failure the player cannot act on.
          setFeedback(null)
          setAwaitingCoach(true)
          return
        }

        setAwaitingCoach(false)
        setFeedback(JSON.parse(row.published_text))
      } catch (e: any) {
        setError(e.message || 'Failed to load feedback')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, assessmentId])

  /* ---- auto-scroll chat ---- */
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  /* ---- send chat message ---- */
  const sendChat = async () => {
    const text = chatInput.trim()
    if (!text || chatLoading || !user || !assessmentId) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...chatMessages, userMsg]
    setChatMessages(newHistory)
    setChatInput('')
    setChatLoading(true)

    // Dev mode demo chat responses
    if (import.meta.env.DEV) {
      const lowerText = text.toLowerCase()
      let demoReply = ''
      if (lowerText.includes('alone') || lowerText.includes('by myself') || lowerText.includes('on my own') || lowerText.includes('solo')) {
        demoReply = "There's a lot you can do on your own. Most technical skills — first touch, shooting, dribbling, heading — can be drilled solo with a ball and a wall. The key is quality over quantity: 15 focused minutes where you're thinking about what you're doing is worth more than an hour of casual kicking around. Pick one thing from your coach's feedback and do 20 deliberate reps of it every session."
      } else if (lowerText.includes('how long') || lowerText.includes('long') || lowerText.includes('time') || lowerText.includes('improve')) {
        demoReply = "Consistent focused work on one skill usually shows results within 3 to 4 weeks. You probably won't notice it yourself — but your coach will. The trick is not trying to fix everything at once. Pick the one area your coach mentioned first, do the drill they gave you 3 times a week, and check in with yourself after a month. Progress is always faster than people expect when it's targeted."
      } else if (lowerText.includes('position') || lowerText.includes('why') || lowerText.includes('important') || lowerText.includes('matter')) {
        demoReply = "Your coach picks these areas for a reason — they're not random. They're the gaps between where you are now and the next level. Every piece of feedback is your coach saying 'I see your potential and here's what's between you and it.' The players who take feedback seriously and act on it are always the ones who develop fastest."
      } else if (lowerText.includes('match') || lowerText.includes('game') || lowerText.includes('pressure') || lowerText.includes('nervous')) {
        demoReply = "The best way to use training improvements in a match is to give yourself one cue word. Pick the most important thing your coach mentioned and before the game just say that word to yourself: 'head up', 'turn quickly', 'press'. One thing you're focusing on — not everything at once. It stops you overthinking and gives you something to come back to when the game gets intense."
      } else {
        demoReply = "Good question. The best thing you can do with your coach's feedback is act on it in the very next training session — not wait. Go in with a specific intention: 'Today I'm going to work on X.' Even if it goes wrong, you're building the neural pathways that make it feel natural. Consistent reps of the right thing is how every elite player got there."
      }

      await new Promise(r => setTimeout(r, 600))
      // Simulate typing word by word
      const words = demoReply.split(' ')
      let built = ''
      for (let i = 0; i < words.length; i++) {
        built += (i === 0 ? '' : ' ') + words[i]
        const snapshot = built
        setChatMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: snapshot }
          return updated
        })
        await new Promise(r => setTimeout(r, 22))
      }
      setChatLoading(false)
      return
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const fnUrl = `${SUPABASE_FUNCTIONS_URL}/player-feedback`

      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          assessment_id: assessmentId,
          chat_messages: newHistory,
        }),
      })

      if (!res.ok || !res.body) throw new Error('Failed to get response')

      // Stream the response
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const sse = new SSEBuffer()
      let assistantText = ''

      // Add placeholder
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])

      const consume = (payloads: string[]) => {
        for (const data of payloads) {
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content || ''
            if (!delta) continue
            assistantText += delta
            setChatMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: assistantText }
              return updated
            })
          } catch { /* a payload that is not JSON is not ours to render */ }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // Release any final line that arrived without a trailing newline.
          consume(sse.flush())
          break
        }
        consume(sse.push(decoder.decode(value, { stream: true })))
      }

      if (!assistantText.trim()) {
        throw new Error('The response came back empty')
      }
    } catch {
      const message = navigator.onLine === false
        ? "You're offline, so I couldn't get a response. Reconnect and ask again."
        : "Sorry, I couldn't get a response. Try again in a moment."
      setChatMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        // Replace the streaming placeholder rather than leaving an empty bubble
        // above the error.
        if (last && last.role === 'assistant' && !last.content.trim()) {
          updated[updated.length - 1] = { role: 'assistant', content: message }
          return updated
        }
        return [...updated, { role: 'assistant', content: message }]
      })
    } finally {
      setChatLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  }

  /* ---- render states ---- */

  if (loading) return (
    <div className="flex flex-col mx-auto max-w-[430px] bg-[#0A0A0B]" style={{ height: '100dvh' }}>
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => navigate(-1)}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]">
          <ChevronLeft size={16} className="text-white/70" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px] pointer-events-none">
          Coach Feedback
        </h1>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-8 text-center">
          <div className="w-12 h-12 rounded-[16px] flex items-center justify-center"
            style={{ background: 'rgba(200,242,90,0.10)', border: '1px solid rgba(200,242,90,0.18)' }}>
            <Sparkles size={20} className="text-[#C8F25A]" />
          </div>
          <div className="space-y-1">
            <p className="text-[15px] font-medium text-white/70">Analysing your feedback</p>
            <p className="text-[12px] text-white/35">Creating your personalised improvement plan…</p>
          </div>
          <div className="w-5 h-5 border-2 border-[#C8F25A] border-t-transparent rounded-full animate-spin mt-1" />
        </div>
      </div>
    </div>
  )

  if (error || !feedback) return (
    <div className="flex flex-col mx-auto max-w-[430px] bg-[#0A0A0B]" style={{ height: '100dvh' }}>
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => navigate(-1)}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]">
          <ChevronLeft size={16} className="text-white/70" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px] pointer-events-none">
          Coach Feedback
        </h1>
      </div>
      <div className="flex-1 flex items-center justify-center px-8 text-center">
        <div className="space-y-3">
          {awaitingCoach ? (
            <>
              <p className="text-[15px] font-medium text-white/60">Not ready yet</p>
              <p className="text-[12px] text-white/35 leading-relaxed">
                Your coach is still writing your feedback. It'll appear here once they've
                finished — nothing has gone wrong.
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium text-white/60">Couldn't load feedback</p>
              <p className="text-[12px] text-white/35">{error || 'No feedback available for this assessment.'}</p>
            </>
          )}
          <button onClick={() => navigate(-1)}
            className="mt-4 px-5 py-2.5 rounded-[10px] text-[13px] font-medium text-black bg-[#C8F25A]">
            Go back
          </button>
        </div>
      </div>
    </div>
  )

  /* ---- main render ---- */
  return (
    <div className="flex flex-col mx-auto max-w-[430px] bg-[#0A0A0B]" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => navigate('/player/home')}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]">
          <ChevronLeft size={16} className="text-white/70" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px] pointer-events-none">
          Coach Feedback
        </h1>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-6 space-y-4">

        {/* Intro block */}
        <div className="rounded-[18px] px-4 py-4"
          style={{ background: 'rgba(200,242,90,0.06)', border: '1px solid rgba(200,242,90,0.14)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-[#C8F25A]" />
            <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-[#C8F25A]/70"
              style={{ fontFamily: "'DM Mono', monospace" }}>AI-powered feedback</span>
          </div>
          <p className="text-[13px] text-white/60 leading-relaxed">
            Your coach left notes after your last session. Here's what they mean and how to act on them.
          </p>
          {context?.note && (
            <p className="text-[11px] text-white/35 italic mt-2.5 leading-relaxed">
              "{context.note}"
            </p>
          )}
        </div>

        {/* 3 improvement points */}
        <div className="space-y-2.5">
          {feedback.points.map((point, i) => (
            <PointCard key={i} point={point} index={i} />
          ))}
        </div>

        {/* Encouragement */}
        <div className="rounded-[16px] px-4 py-3.5"
          style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[13px] text-white/55 leading-relaxed italic">{feedback.encouragement}</p>
        </div>

        {/* Ask AI button */}
        {CHILD_CHAT_ENABLED && !showChat && (
          <button
            onClick={() => setShowChat(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[12px] text-[14px] font-medium text-black bg-[#C8F25A] active:scale-[0.98] transition-transform"
          >
            <MessageSquare size={16} />
            Ask how to improve
          </button>
        )}

        {/* Chat interface */}
        {CHILD_CHAT_ENABLED && showChat && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-white/30"
                style={{ fontFamily: "'DM Mono', monospace" }}>Ask anything</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Chat history */}
            <div className="space-y-2">
              {/* Starter prompt */}
              {chatMessages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/30 text-center mb-3"
                    style={{ fontFamily: "'DM Mono', monospace" }}>
                    Ask your AI coach anything about this feedback
                  </p>
                  {[
                    'How do I work on this by myself?',
                    'How long will it take to improve?',
                    'Why is this important for my position?',
                  ].map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => { setChatInput(prompt); inputRef.current?.focus() }}
                      className="w-full text-left text-[12px] text-white/45 px-3 py-2.5 rounded-[10px] active:scale-[0.98] transition-transform"
                      style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] px-3.5 py-2.5 rounded-[14px] text-[13px] leading-relaxed"
                    style={{
                      background: msg.role === 'user' ? 'rgba(200,242,90,0.12)' : '#101012',
                      border: `1px solid ${msg.role === 'user' ? 'rgba(200,242,90,0.25)' : 'rgba(255,255,255,0.07)'}`,
                      color: msg.role === 'user' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.65)',
                    }}
                  >
                    {msg.content || (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {chatLoading && chatMessages[chatMessages.length - 1]?.role === 'user' && (
                <div className="flex justify-start">
                  <div className="px-3.5 py-2.5 rounded-[14px]"
                    style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask a question…"
                className="flex-1 px-3.5 py-2.5 rounded-[12px] text-[13px] text-white/88 outline-none resize-none leading-relaxed"
                style={{
                  background: '#101012',
                  border: '1px solid rgba(255,255,255,0.10)',
                  minHeight: 44,
                  maxHeight: 96,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim() || chatLoading}
                className="flex items-center justify-center w-[44px] h-[44px] rounded-[12px] flex-shrink-0 disabled:opacity-40 transition-opacity active:scale-95"
                style={{ background: '#C8F25A' }}
              >
                {chatLoading
                  ? <Loader2 size={16} className="text-black animate-spin" />
                  : <Send size={16} className="text-black" />
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
