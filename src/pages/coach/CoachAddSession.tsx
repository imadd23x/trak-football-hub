import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, MetadataLabel } from '@/components/trak'
import { computeMatchScore } from '@/lib/rating-engine'
import { goalsKey, assistsKey } from '@/lib/match-input-keys'
import { trackEvent } from '@/lib/telemetry'
import { validateMatchInput, MATCH_LIMITS } from '@/lib/match-input-rules'

type SquadPlayer = {
  id: string
  player_name: string
  linked_player_id: string | null
  position: string | null
  age: number | null
}

type Competition = 'League' | 'Cup' | 'Friendly'
type Venue      = 'Home' | 'Away'
type CardType   = 'None' | 'Yellow' | 'Red'

// Per-player match detail (full session only)
type PlayerDetail = {
  played:  boolean
  role:    'starter' | 'sub'
  minutes: number
  /* Exact counts. These were once `0 | 1 | 2` with 2 meaning "2+", so a
     hat-trick was stored as 2 and the only vocabulary the form had was the
     rating bucket. The bucket still exists — match-input-keys.ts — but it is
     now derived for the rating engine rather than being the thing recorded. */
  goals:   number
  assists: number
  card:    CardType
}

const DEFAULT_DETAIL: PlayerDetail = {
  played: false, role: 'starter', minutes: 90,
  goals: 0, assists: 0, card: 'None',
}

function mapPosition(raw: string | null) {
  const p = (raw || '').toLowerCase()
  if (p.includes('goalkeeper') || p === 'gk') return 'gk'
  if (p.includes('defender')   || ['def','cb','lb','rb'].includes(p)) return 'def'
  if (p.includes('attacker')   || ['att','cf','st','lw','rw'].includes(p)) return 'att'
  return 'mid'
}

export default function CoachAddSession() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Common
  /* Reached via /coach/sessions/quick? That entry point is the match one, so
     open on Match — otherwise the redirect would cost the coach the extra tap
     the quick log used to save. */
  const [type,  setType]  = useState<'training' | 'match' | 'other'>(
    () => (window.location.pathname.endsWith('/sessions/quick') ? 'match' : 'training'),
  )
  const [title, setTitle] = useState('')
  const [date,  setDate]  = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')

  // Training-specific
  const [trainingFocus,     setTrainingFocus]     = useState<Set<string>>(new Set())
  const [trainingIntensity, setTrainingIntensity] = useState('')
  const [trainingDuration,  setTrainingDuration]  = useState(60)

  // Pre-fill from Coach Assistant "Log this session" button
  useEffect(() => {
    const plan = (location.state as any)?.fromAssistant
    if (!plan) return
    setType('training')
    if (plan.focus?.length)  setTrainingFocus(new Set(plan.focus))
    if (plan.duration)       setTrainingDuration(plan.duration)
    if (plan.notes)          setNotes(plan.notes)
  }, [])

  // Match-only header
  const [opponent,    setOpponent]    = useState('')
  const [scoreUs,     setScoreUs]     = useState('')
  const [scoreThem,   setScoreThem]   = useState('')
  const [competition, setCompetition] = useState<Competition>('League')
  const [venue,       setVenue]       = useState<Venue>('Home')

  // Squad
  const [squad,       setSquad]       = useState<SquadPlayer[]>([])
  const [details,     setDetails]     = useState<Record<string, PlayerDetail>>({})
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())

  // Training/other — simple attendance
  const [attended,    setAttended]    = useState<Set<string>>(new Set())

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('squad_players')
      .select('id, player_name, linked_player_id, position, age')
      .eq('coach_user_id', user.id)
      .order('player_name')
      .then(({ data }) => {
        const players = data || []
        setSquad(players)
        const init: Record<string, PlayerDetail> = {}
        players.forEach(p => { init[p.id] = { ...DEFAULT_DETAIL } })
        setDetails(init)
      })
  }, [user])

  const isMatch = type === 'match'

  const result =
    scoreUs === '' || scoreThem === '' ? null
    : Number(scoreUs) > Number(scoreThem) ? 'W'
    : Number(scoreUs) < Number(scoreThem) ? 'L' : 'D'

  // ── detail helpers ───────────────────────────────────────────────────────────
  const setDetail = (id: string, patch: Partial<PlayerDetail>) =>
    setDetails(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const togglePlayed = (id: string) => {
    const wasPlayed = details[id]?.played
    setDetail(id, { played: !wasPlayed })
    if (!wasPlayed) {
      // Auto-expand when toggled on
      setExpanded(prev => { const n = new Set(prev); n.add(id); return n })
    } else {
      setExpanded(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const toggleExpanded = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) { n.delete(id) } else { n.add(id) }
      return n
    })

  const setAllStarters = () => {
    const all: Record<string, PlayerDetail> = {}
    squad.forEach(p => { all[p.id] = { ...DEFAULT_DETAIL, played: true, role: 'starter' } })
    setDetails(all)
  }

  const clearAll = () => {
    const none: Record<string, PlayerDetail> = {}
    squad.forEach(p => { none[p.id] = { ...DEFAULT_DETAIL } })
    setDetails(none)
    setExpanded(new Set())
  }

  const playedCount = Object.values(details).filter(d => d.played).length

  // ── validation ───────────────────────────────────────────────────────────────
  /* Only players marked as having played are checked. An untouched bench row
     carries DEFAULT_DETAIL (90 minutes, no goals), which is valid anyway, but
     checking it would mean a coach could be blocked by a row they never opened. */
  const impossibleRecords = !isMatch ? [] : squad
    .filter(p => details[p.id]?.played)
    .filter(p => validateMatchInput({
      minutes: details[p.id].minutes,
      goals:   details[p.id].goals,
      assists: details[p.id].assists,
      teamScore: scoreUs === '' ? undefined : Number(scoreUs),
    }).length > 0)

  const canSave = !saving && impossibleRecords.length === 0 && (
    isMatch    ? opponent.trim().length > 0 && scoreUs !== '' && scoreThem !== ''
    : type === 'training' ? trainingFocus.size > 0
    : title.trim().length > 0
  )

  // ── save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user || !canSave) return
    setSaving(true)

    const sessionTitle = isMatch
      ? `vs ${opponent.trim()}`
      : type === 'training'
        ? (() => {
            const focusLabel = [...trainingFocus].join(' / ')
            return title.trim() ? `${focusLabel} — ${title.trim()}` : `${focusLabel} Training`
          })()
        : title.trim()

    const { data: session, error } = await supabase
      .from('coach_sessions')
      .insert({
        coach_user_id: user.id,
        title:         sessionTitle,
        session_type:  type,
        session_date:  date,
        notes: (() => {
          if (type === 'training') {
            const meta = [
              `${trainingDuration} min`,
              trainingIntensity ? `${trainingIntensity} intensity` : null,
            ].filter(Boolean).join(' · ')
            return [meta, notes].filter(Boolean).join('\n') || null
          }
          return notes || null
        })(),
        // coach_sessions has no `opponent` column — sending one made PostgREST
        // reject the whole insert, so every match save failed with "Could not
        // save session". The opponent already lives in the title ("vs X") and
        // on each player's match row.
        ...(isMatch && {
          competition,
          venue,
          notes: `${scoreUs}-${scoreThem}${notes ? ' · ' + notes : ''}`,
        }),
      })
      .select()
      .single()

    if (error || !session) {
      console.error('Session save failed:', error)
      toast.error(error?.message ? `Could not save: ${error.message}` : 'Could not save session')
      setSaving(false)
      return
    }

    if (isMatch) {
      // Collect players who played
      const playedPlayers = squad.filter(p => details[p.id]?.played)

      // session_attendance
      if (playedPlayers.length > 0) {
        await supabase.from('session_attendance').insert(
          playedPlayers.map(p => ({
            session_id:      session.id,
            squad_player_id: p.id,
            status:          'present',
          }))
        )
      }

      // matches rows — only for linked players, deduplicated by linked_player_id
      // (guards against duplicate squad entries writing two match rows for the same player)
      const seenIds = new Set<string>()
      const linkedPlayers = playedPlayers.filter(p => {
        if (!p.linked_player_id) return false
        if (seenIds.has(p.linked_player_id)) return false
        seenIds.add(p.linked_player_id)
        return true
      })
      for (const p of linkedPlayers) {
        const d = details[p.id]
        const pos = mapPosition(p.position)
        const computed_rating = computeMatchScore({
          position:        pos,
          competition:     competition.toLowerCase() as 'league' | 'cup' | 'friendly',
          venue:           venue.toLowerCase() as 'home' | 'away',
          opponent:        opponent.trim(),
          score_us:        Number(scoreUs)   || 0,
          score_them:      Number(scoreThem) || 0,
          minutes_played:  d.minutes,
          card:            d.card.toLowerCase() as 'none' | 'yellow' | 'red',
          body_condition:  'good',
          self_rating:     'average',
          position_inputs: {
            /* Position-aware, and assists have their own scale. The engine
               reads '1'/'2'/'3+' for an attacker's goals but '1'/'2+' for
               everyone's assists, so one shared helper for both would send an
               attacker's third assist as '3+' — a key the assists branch has
               no case for, which pays exactly nothing. */
            goals:   goalsKey(pos, d.goals),
            assists: assistsKey(d.assists),
          },
          is_friendly: competition === 'Friendly',
        })

        await supabase.rpc('log_match_for_player', {
          p_user_id:         p.linked_player_id!,
          p_opponent:        opponent.trim(),
          p_team_score:      Number(scoreUs)   || 0,
          p_opponent_score:  Number(scoreThem) || 0,
          p_competition:     competition,
          p_venue:           venue,
          p_position:        p.position  || 'Midfielder',
          p_age_group:       p.age != null ? String(p.age) : 'U19+',
          p_minutes_played:  d.minutes,
          // The real numbers. The rating key is a band; the record is not.
          p_goals:           d.goals,
          p_assists:         d.assists,
          p_card_received:   d.card,
          p_body_condition:  'Average',
          p_self_rating:     'Average',
          p_computed_rating: computed_rating,
          p_match_date:      date,
        })
      }

      trackEvent('match_logged', {
        actor: 'coach',
        source: 'add_session',
        players: attended.size,
        match_date: date,
        competition,
        venue,
      })
    } else {
      // Training / Other — simple attendance
      if (attended.size > 0) {
        await supabase.from('session_attendance').insert(
          [...attended].map(squad_player_id => ({
            session_id: session.id,
            squad_player_id,
            status: 'present',
          }))
        )
      }
    }

    toast.success(isMatch ? 'Match saved' : 'Session saved')
    setSaving(false)
    navigate('/coach/sessions/list')
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <MobileShell>
      {/* Topbar */}
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-white/[0.07]">
        <button onClick={() => navigate(-1)}
          className="w-[34px] h-[34px] bg-[#17171A] border border-white/[0.11] rounded-[10px] flex items-center justify-center">
          <ChevronLeft size={14} className="text-white/88" />
        </button>
        <span className="text-[16px] font-medium text-white/88"
          style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Full Session
        </span>
        <div className="w-[34px]" />
      </div>

      <div className="pt-5 pb-32 space-y-5">

        {/* Session type */}
        <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
          <MetadataLabel text="TYPE" />
          <div className="flex gap-2 mt-3">
            {(['training', 'match', 'other'] as const).map(t => (
              <Chip key={t} active={type === t} onClick={() => setType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </div>

        {/* ── MATCH TYPE ─────────────────────────────────────────────────────── */}
        {isMatch ? (
          <>
            {/* Match header */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="OPPONENT" />
              <input value={opponent} onChange={e => setOpponent(e.target.value)}
                placeholder="Opponent name"
                className="w-full bg-transparent text-[20px] text-white/88 placeholder-white/20 outline-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }} />

              <div className="grid grid-cols-3 items-center gap-3 mt-5">
                <div className="text-center">
                  <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-white/45 mb-2"
                    style={{ fontFamily: "'DM Mono', monospace" }}>US</span>
                  <input inputMode="numeric" value={scoreUs}
                    onChange={e => setScoreUs(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="0"
                    className="w-full bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] py-3 text-center text-[28px] text-white/88 placeholder-white/20 outline-none"
                    style={{ fontFamily: "'DM Sans', sans-serif" }} />
                </div>
                <div className="text-center">
                  <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-white/30 mb-2"
                    style={{ fontFamily: "'DM Mono', monospace" }}>RESULT</span>
                  <div className="w-full py-3 rounded-[12px] text-center text-[28px]"
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      color: result === 'W' ? '#C8F25A' : result === 'L' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.6)',
                    }}>
                    {result || '–'}
                  </div>
                </div>
                <div className="text-center">
                  <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-white/45 mb-2"
                    style={{ fontFamily: "'DM Mono', monospace" }}>THEM</span>
                  <input inputMode="numeric" value={scoreThem}
                    onChange={e => setScoreThem(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="0"
                    className="w-full bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] py-3 text-center text-[28px] text-white/88 placeholder-white/20 outline-none"
                    style={{ fontFamily: "'DM Sans', sans-serif" }} />
                </div>
              </div>
            </div>

            {/* Competition + venue */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] space-y-4">
              <div>
                <MetadataLabel text="COMPETITION" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(['League', 'Cup', 'Friendly'] as const).map(c => (
                    <Chip key={c} active={competition === c} onClick={() => setCompetition(c)}>{c}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <MetadataLabel text="VENUE" />
                <div className="flex gap-2 mt-2">
                  {(['Home', 'Away'] as const).map(v => (
                    <Chip key={v} active={venue === v} onClick={() => setVenue(v)}>{v}</Chip>
                  ))}
                </div>
              </div>
            </div>

            {/* Date */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="DATE" />
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-transparent text-[15px] text-white/88 outline-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif", colorScheme: 'dark' }} />
            </div>

            {/* ── Per-player section ─────────────────────────────────────────── */}
            <div className="rounded-[18px] border border-white/[0.07] bg-[#101012] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-white/45"
                  style={{ fontFamily: "'DM Mono', monospace" }}>
                  SQUAD · {playedCount} played
                </span>
                <div className="flex gap-3">
                  <button onClick={setAllStarters}
                    className="text-[10px] tracking-[0.12em] uppercase text-[#C8F25A]"
                    style={{ fontFamily: "'DM Mono', monospace" }}>
                    ALL 90
                  </button>
                  <button onClick={clearAll}
                    className="text-[10px] tracking-[0.12em] uppercase text-white/35"
                    style={{ fontFamily: "'DM Mono', monospace" }}>
                    CLEAR
                  </button>
                </div>
              </div>

              {squad.length === 0 ? (
                <p className="px-4 pb-4 text-[12px] text-white/40">
                  No squad yet. Add players from the Squad tab first.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {squad.map(p => {
                    const d = details[p.id] ?? DEFAULT_DETAIL
                    const isExpanded = expanded.has(p.id)

                    return (
                      <div key={p.id}>
                        {/* Player row header */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Played toggle */}
                          <button
                            onClick={() => togglePlayed(p.id)}
                            className="flex-shrink-0 w-[22px] h-[22px] rounded-full border transition-all"
                            style={{
                              background: d.played ? '#C8F25A' : 'transparent',
                              borderColor: d.played ? '#C8F25A' : 'rgba(255,255,255,0.2)',
                            }}
                            aria-label={d.played ? 'Remove' : 'Mark played'}
                          >
                            {d.played && (
                              <span style={{ display: 'block', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#000', lineHeight: '22px' }}>✓</span>
                            )}
                          </button>

                          {/* Name + position */}
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] truncate"
                              style={{ color: d.played ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.45)', fontFamily: "'DM Sans', sans-serif" }}>
                              {p.player_name}
                            </p>
                          </div>

                          {/* Position + mins badge (when played) */}
                          {d.played && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {p.position && (
                                <span className="text-[8px] tracking-[0.08em] uppercase text-white/30 px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'rgba(255,255,255,0.05)', fontFamily: "'DM Mono', monospace" }}>
                                  {p.position}
                                </span>
                              )}
                              <span className="text-[10px] text-white/40"
                                style={{ fontFamily: "'DM Mono', monospace" }}>
                                {d.minutes}'
                              </span>
                            </div>
                          )}

                          {/* Expand toggle (only when played) */}
                          {d.played && (
                            <button onClick={() => toggleExpanded(p.id)}
                              className="flex-shrink-0 w-6 h-6 flex items-center justify-center"
                              style={{ color: 'rgba(255,255,255,0.3)' }}>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                        </div>

                        {/* Expanded detail */}
                        {d.played && isExpanded && (
                          <div className="px-4 pb-4 space-y-3"
                            style={{ background: 'rgba(0,0,0,0.25)' }}>

                            {/* Role + Minutes on same line */}
                            <div className="flex items-center gap-4">
                              {/* Role */}
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] tracking-[0.1em] uppercase text-white/30 mr-0.5"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>ROLE</span>
                                {(['starter', 'sub'] as const).map(r => (
                                  <button key={r} onClick={() => setDetail(p.id, { role: r })}
                                    className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
                                    style={{
                                      background: d.role === r ? 'rgba(200,242,90,0.12)' : 'rgba(255,255,255,0.04)',
                                      color: d.role === r ? '#C8F25A' : 'rgba(255,255,255,0.4)',
                                      border: `1px solid ${d.role === r ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.07)'}`,
                                      fontFamily: "'DM Sans', sans-serif",
                                    }}>
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                  </button>
                                ))}
                              </div>

                              {/* Minutes stepper */}
                              <div className="flex items-center gap-2 ml-auto">
                                <span className="text-[8px] tracking-[0.1em] uppercase text-white/30"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>MINS</span>
                                <button
                                  onClick={() => setDetail(p.id, { minutes: Math.max(0, d.minutes - 15) })}
                                  className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-white/50 text-sm">−</button>
                                <span className="w-8 text-center text-[13px] text-white/88"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>
                                  {d.minutes}
                                </span>
                                <button
                                  onClick={() => setDetail(p.id, { minutes: Math.min(120, d.minutes + 15) })}
                                  className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-white/50 text-sm">+</button>
                              </div>
                            </div>

                            {/* Goals and assists — steppers, not a 0/1/2+ picker.
                                The old control could not express a hat-trick: it
                                offered three buttons and stored "2+" as 2. */}
                            {([
                              { label: 'GOALS',   key: 'goals'   as const, value: d.goals,   max: MATCH_LIMITS.goalsMax },
                              { label: 'ASSISTS', key: 'assists' as const, value: d.assists, max: MATCH_LIMITS.assistsMax },
                            ]).map(({ label, key, value, max }) => (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-[8px] tracking-[0.1em] uppercase text-white/30 w-[44px] flex-shrink-0"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>{label}</span>
                                <button
                                  aria-label={`One fewer ${key} for ${p.player_name}`}
                                  onClick={() => setDetail(p.id, { [key]: Math.max(0, value - 1) })}
                                  className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-white/50 text-sm">−</button>
                                <span className="w-8 text-center text-[13px] text-white/88"
                                  style={{ fontFamily: "'DM Mono', monospace" }}>
                                  {value}
                                </span>
                                <button
                                  aria-label={`One more ${key} for ${p.player_name}`}
                                  onClick={() => setDetail(p.id, { [key]: Math.min(max, value + 1) })}
                                  className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-white/50 text-sm">+</button>
                              </div>
                            ))}

                            {/* Why a save will be refused, before the coach taps it.
                                The same rules run in the database, so this cannot
                                be the only place they are applied — but a coach
                                should not have to learn them from a rejection. */}
                            {(() => {
                              const problems = validateMatchInput({
                                minutes: d.minutes, goals: d.goals, assists: d.assists,
                                teamScore: scoreUs === '' ? undefined : Number(scoreUs),
                              })
                              if (problems.length === 0) return null
                              return (
                                <p role="alert" className="text-[10px] leading-snug text-[#F2705A] pl-[52px]"
                                  style={{ fontFamily: "'DM Sans', sans-serif" }}>
                                  {problems[0].message}
                                </p>
                              )
                            })()}

                            {/* Card */}
                            <div className="flex items-center gap-2">
                              <span className="text-[8px] tracking-[0.1em] uppercase text-white/30 w-[44px] flex-shrink-0"
                                style={{ fontFamily: "'DM Mono', monospace" }}>CARD</span>
                              <div className="flex gap-1.5">
                                {(['None', 'Yellow', 'Red'] as const).map(c => (
                                  <button key={c} onClick={() => setDetail(p.id, { card: c })}
                                    className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
                                    style={{
                                      background: d.card === c
                                        ? c === 'Yellow' ? 'rgba(251,191,36,0.14)'
                                        : c === 'Red'    ? 'rgba(239,68,68,0.14)'
                                        : 'rgba(200,242,90,0.12)'
                                        : 'rgba(255,255,255,0.04)',
                                      color: d.card === c
                                        ? c === 'Yellow' ? '#fbbf24'
                                        : c === 'Red'    ? '#ef4444'
                                        : '#C8F25A'
                                        : 'rgba(255,255,255,0.4)',
                                      border: `1px solid ${d.card === c
                                        ? c === 'Yellow' ? 'rgba(251,191,36,0.3)'
                                        : c === 'Red'    ? 'rgba(239,68,68,0.3)'
                                        : 'rgba(200,242,90,0.3)'
                                        : 'rgba(255,255,255,0.07)'}`,
                                      fontFamily: "'DM Sans', sans-serif",
                                    }}>
                                    {c}
                                  </button>
                                ))}
                              </div>
                            </div>

                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Match notes */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="MATCH NOTES" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="How did the match go? Key moments, things to work on…"
                className="w-full bg-transparent text-[14px] text-white/88 placeholder-white/20 outline-none resize-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif" }} />
            </div>
          </>
        ) : type === 'training' ? (
          /* ── TRAINING ──────────────────────────────────────────────────────── */
          <>
            {/* Session focus — required */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="SESSION FOCUS" />
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[
                  { key: 'Technical',   sub: 'Passing, control, dribbling' },
                  { key: 'Tactical',    sub: 'Shape, pressing, transitions' },
                  { key: 'Finishing',   sub: 'Shooting & scoring' },
                  { key: 'Set Pieces',  sub: 'Corners, free kicks, penalties' },
                  { key: 'Physical',    sub: 'Fitness & conditioning' },
                  { key: 'Possession',  sub: 'Rondos, keep-ball' },
                  { key: 'Goalkeeper', sub: 'GK-specific work' },
                  { key: 'Game Based', sub: 'SSGs & match scenarios' },
                ].map(({ key, sub }) => {
                  const on = trainingFocus.has(key)
                  return (
                    <button key={key}
                      onClick={() => setTrainingFocus(prev => {
                        const n = new Set(prev)
                        if (n.has(key)) { n.delete(key) } else { n.add(key) }
                        return n
                      })}
                      className="text-left px-3 py-2.5 rounded-[12px] transition-colors"
                      style={{
                        background: on ? 'rgba(200,242,90,0.10)' : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${on ? 'rgba(200,242,90,0.35)' : 'rgba(255,255,255,0.06)'}`,
                      }}>
                      <p className="text-[13px] font-medium"
                        style={{ color: on ? '#C8F25A' : 'rgba(255,255,255,0.78)', fontFamily: "'DM Sans', sans-serif" }}>
                        {key}
                      </p>
                      <p className="text-[9px] mt-0.5"
                        style={{ color: 'rgba(255,255,255,0.3)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em' }}>
                        {sub}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Duration + Intensity on same card */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] space-y-4">
              <div>
                <MetadataLabel text="DURATION" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[45, 60, 75, 90].map(d => (
                    <Chip key={d} active={trainingDuration === d} onClick={() => setTrainingDuration(d)}>
                      {d} min
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <MetadataLabel text="INTENSITY" />
                <div className="flex gap-2 mt-2">
                  {['Light', 'Medium', 'High'].map(lvl => (
                    <button key={lvl}
                      onClick={() => setTrainingIntensity(prev => prev === lvl ? '' : lvl)}
                      className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
                      style={{
                        background: trainingIntensity === lvl
                          ? lvl === 'High'   ? 'rgba(239,68,68,0.12)'
                          : lvl === 'Medium' ? 'rgba(251,191,36,0.12)'
                          : 'rgba(96,165,250,0.12)'
                          : '#202024',
                        color: trainingIntensity === lvl
                          ? lvl === 'High'   ? '#ef4444'
                          : lvl === 'Medium' ? '#fbbf24'
                          : '#60a5fa'
                          : 'rgba(255,255,255,0.45)',
                        border: `1px solid ${trainingIntensity === lvl
                          ? lvl === 'High'   ? 'rgba(239,68,68,0.3)'
                          : lvl === 'Medium' ? 'rgba(251,191,36,0.3)'
                          : 'rgba(96,165,250,0.3)'
                          : 'rgba(255,255,255,0.07)'}`,
                        fontFamily: "'DM Sans', sans-serif",
                      }}>
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Optional theme / title */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="THEME (OPTIONAL)" />
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Pressing triggers, Crossing & finishing…"
                className="w-full bg-transparent text-[15px] text-white/88 placeholder-white/20 outline-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif" }} />
            </div>

            {/* Date */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="DATE" />
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-transparent text-[15px] text-white/88 outline-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif", colorScheme: 'dark' }} />
            </div>

            {/* Attendance */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-white/45"
                  style={{ fontFamily: "'DM Mono', monospace" }}>
                  ATTENDED · {attended.size}/{squad.length}
                </span>
                <div className="flex gap-3">
                  <button onClick={() => setAttended(new Set(squad.map(p => p.id)))}
                    className="text-[10px] tracking-[0.12em] uppercase text-[#C8F25A]"
                    style={{ fontFamily: "'DM Mono', monospace" }}>ALL</button>
                  <button onClick={() => setAttended(new Set())}
                    className="text-[10px] tracking-[0.12em] uppercase text-white/35"
                    style={{ fontFamily: "'DM Mono', monospace" }}>NONE</button>
                </div>
              </div>
              {squad.length === 0 ? (
                <p className="text-[12px] text-white/40 py-2">No squad yet. Add players from the Squad tab first.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {squad.map(p => {
                    const on = attended.has(p.id)
                    return (
                      <button key={p.id}
                        onClick={() => setAttended(prev => { const n = new Set(prev); if (n.has(p.id)) { n.delete(p.id) } else { n.add(p.id) } return n })}
                        className="text-left px-3 py-2.5 rounded-[10px] transition-colors"
                        style={{
                          background: on ? 'rgba(200,242,90,0.08)' : 'rgba(0,0,0,0.35)',
                          border: `1px solid ${on ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.05)'}`,
                          color: on ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
                          fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                        }}>
                        {p.player_name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="SESSION NOTES" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="What went well? What needs more work next session?"
                className="w-full bg-transparent text-[14px] text-white/88 placeholder-white/20 outline-none resize-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif" }} />
            </div>
          </>
        ) : (
          /* ── OTHER ─────────────────────────────────────────────────────────── */
          <>
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="TITLE" />
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Gym, Video Analysis, Team Talk…"
                className="w-full bg-transparent text-[16px] text-white/88 placeholder-white/20 outline-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif" }} />
            </div>

            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="DATE" />
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-transparent text-[15px] text-white/88 outline-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif", colorScheme: 'dark' }} />
            </div>

            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-white/45"
                  style={{ fontFamily: "'DM Mono', monospace" }}>
                  ATTENDED · {attended.size}/{squad.length}
                </span>
                <div className="flex gap-3">
                  <button onClick={() => setAttended(new Set(squad.map(p => p.id)))}
                    className="text-[10px] tracking-[0.12em] uppercase text-[#C8F25A]"
                    style={{ fontFamily: "'DM Mono', monospace" }}>ALL</button>
                  <button onClick={() => setAttended(new Set())}
                    className="text-[10px] tracking-[0.12em] uppercase text-white/35"
                    style={{ fontFamily: "'DM Mono', monospace" }}>NONE</button>
                </div>
              </div>
              {squad.length === 0 ? (
                <p className="text-[12px] text-white/40 py-2">No squad yet. Add players from the Squad tab first.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {squad.map(p => {
                    const on = attended.has(p.id)
                    return (
                      <button key={p.id}
                        onClick={() => setAttended(prev => { const n = new Set(prev); if (n.has(p.id)) { n.delete(p.id) } else { n.add(p.id) } return n })}
                        className="text-left px-3 py-2.5 rounded-[10px] transition-colors"
                        style={{
                          background: on ? 'rgba(200,242,90,0.08)' : 'rgba(0,0,0,0.35)',
                          border: `1px solid ${on ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.05)'}`,
                          color: on ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
                          fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                        }}>
                        {p.player_name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="NOTES" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Optional…"
                className="w-full bg-transparent text-[14px] text-white/88 placeholder-white/20 outline-none resize-none mt-2"
                style={{ fontFamily: "'DM Sans', sans-serif" }} />
            </div>
          </>
        )}
      </div>

      {/* Sticky save */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] px-5 pb-5 pt-3"
        style={{ background: 'linear-gradient(180deg,rgba(10,10,11,0) 0%,#0A0A0B 35%)' }}>
        <button onClick={handleSave} disabled={!canSave}
          className="w-full py-3.5 rounded-[12px] text-[14px] font-medium transition-opacity"
          style={{
            background: canSave ? '#C8F25A' : 'rgba(255,255,255,0.06)',
            color: canSave ? '#000' : 'rgba(255,255,255,0.3)',
            opacity: saving ? 0.6 : 1,
          }}>
          {saving ? 'Saving…' : isMatch ? 'Save match' : 'Save session'}
        </button>
      </div>
    </MobileShell>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
      style={{
        background: active ? 'rgba(200,242,90,0.12)' : '#202024',
        color: active ? '#C8F25A' : 'rgba(255,255,255,0.45)',
        border: `1px solid ${active ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.07)'}`,
        fontFamily: "'DM Sans', sans-serif",
      }}>
      {children}
    </button>
  )
}
