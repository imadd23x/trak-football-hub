import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Flame, Target, Lock, Check, Shield, Zap, Activity, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { MobileShell, NavBar } from '@/components/trak'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { captureElementToPng, shareOrSaveImage } from '@/lib/card-export'

/**
 * TRAK Player Evolution Card
 *
 * OVR scale: 0–100 (coach assessment dimensions × 10)
 * Starting baseline: all stats at 50, OVR 50 → Bronze (correctly signals "not yet evaluated")
 *
 * Tiers:
 *   Bronze  0–64   newcomer / unassessed
 *   Silver  65–74  developing
 *   Gold    75–84  established
 *   Volt    85–91  elite
 *   Icon    92–100 exceptional — coach gives 9.2+ across every dimension
 *
 * Quest system:
 *   Series 01 — 3 position-tailored quests always active simultaneously
 *   After all 3 complete → Series 01 banner + locked Series 02 stub
 *   Series 02 onwards: harder targets, unlocked in a future update
 *
 * Position quest sets:
 *   GK  — Wall (3 clean sheets) · Sweeper Keeper (4× ≥7.0) · Coach's Pick
 *   DEF — Rock Solid (5× ≥7.0) · Resilient (3 consecutive ≥6.5) · Coach's Pick
 *   MID — Metronome (6 matches played) · On Fire (3 consecutive ≥7.0) · Coach's Pick
 *   ATT — Clinical (4× ≥7.5) · On Fire (3 consecutive ≥7.0) · Coach's Pick
 *
 * Clean sheets are derived from opponent_score = 0 — no extra DB column needed.
 */

type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Volt' | 'Icon'

type CardSnapshot = {
  date: string   // ISO date string
  ovr: number
  tier: Tier
}
type PosGroup = 'gk' | 'def' | 'mid' | 'att'
type EvoState = 'active' | 'done' | 'locked'

const TIERS: Record<Tier, {
  ring: string; label: string; glow: string
  shimmerOpacity: number
  min: number; max: number; nextLabel: string | null
  /** True when `label` is light enough that the share button needs dark text.
      Silver and Icon both had this false while their labels composite to near
      white, so the button read as blank. */
  darkText: boolean
}> = {
  Bronze: { ring: 'rgba(205,127,50,0.55)', label: 'rgba(205,127,50,0.85)', glow: 'rgba(205,127,50,0.18)', shimmerOpacity: 0.04, min: 0,  max: 64,  nextLabel: 'Silver', darkText: false },
  Silver: { ring: 'rgba(220,220,230,0.55)', label: 'rgba(220,220,230,0.85)', glow: 'rgba(220,220,230,0.16)', shimmerOpacity: 0.07, min: 65, max: 74,  nextLabel: 'Gold',   darkText: true  },
  Gold:   { ring: 'rgba(245,200,80,0.65)',  label: 'rgba(245,200,80,0.95)',  glow: 'rgba(245,200,80,0.20)',  shimmerOpacity: 0.10, min: 75, max: 84,  nextLabel: 'Volt',   darkText: true  },
  Volt:   { ring: 'rgba(200,242,90,0.75)',  label: '#C8F25A',                glow: 'rgba(200,242,90,0.28)',  shimmerOpacity: 0.14, min: 85, max: 91,  nextLabel: 'Icon',   darkText: true  },
  Icon:   { ring: 'rgba(255,255,255,0.85)', label: '#FFFFFF',                glow: 'rgba(200,242,90,0.35)',  shimmerOpacity: 0.20, min: 92, max: 100, nextLabel: null,     darkText: true  },
}

function currentSeasonLabel() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = m >= 8 ? y : y - 1
  return `TRAK · ${String(start).slice(2)}/${String(start + 1).slice(2)}`
}

function tierFromOvr(ovr: number): Tier {
  if (ovr >= 92) return 'Icon'
  if (ovr >= 85) return 'Volt'
  if (ovr >= 75) return 'Gold'
  if (ovr >= 65) return 'Silver'
  return 'Bronze'
}

function posGroupFromPosition(raw: string): PosGroup {
  const p = raw.toLowerCase()
  if (p.includes('goalkeeper') || p === 'gk') return 'gk'
  if (p.includes('defender') || p === 'def') return 'def'
  if (p.includes('attacker') || p === 'att') return 'att'
  return 'mid'
}

function initialsOf(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// Fallback when player has no assessments yet — starts at 50 (Bronze)
const FALLBACK_STATS = [
  { key: 'CONSISTENCY', value: 50 },
  { key: 'IMPACT',      value: 50 },
  { key: 'WORKRATE',    value: 50 },
  { key: 'TECHNIQUE',   value: 50 },
  { key: 'SPIRIT',      value: 50 },
]

type MatchRow = {
  computed_rating: number | null
  opponent_score: number | null
  created_at: string
}

type EvoQuest = {
  icon: React.ElementType
  title: string
  desc: string
  progress: number
  target: number
  status: string   // human-readable status line
  reward: string
  state: EvoState
}

/** Build Series 01 quests tailored to the player's position group */
function computePositionQuests(
  group: PosGroup,
  matches: MatchRow[],
  awardCount: number,
): EvoQuest[] {
  const sorted = [...matches].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  // ── Shared helpers ────────────────────────────────────────────────────────

  // Count matches where computed_rating ≥ threshold
  const ratingCount = (threshold: number) =>
    sorted.filter(m => (m.computed_rating ?? 0) >= threshold).length

  // Length of the current trailing streak of matches ≥ threshold
  const ratingStreak = (threshold: number) => {
    let streak = 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      if ((sorted[i].computed_rating ?? 0) >= threshold) streak++
      else break
    }
    return streak
  }

  // Coach's Pick — universal quest #3 for every position
  const coachPickDone = awardCount > 0
  const coachPick: EvoQuest = {
    icon: Target,
    title: "Coach's Pick",
    desc: 'Earn a recognition award from your coach',
    progress: coachPickDone ? 1 : 0,
    target: 1,
    status: coachPickDone ? 'Completed' : 'Keep impressing',
    reward: 'Animated tier ring',
    state: coachPickDone ? 'done' : 'active',
  }

  // ── Goalkeeper ────────────────────────────────────────────────────────────
  if (group === 'gk') {
    const cleanSheets = sorted.filter(m => (m.opponent_score ?? 1) === 0).length
    const wallDone = cleanSheets >= 3

    const sweepGames = ratingCount(7.0)
    const sweepDone = sweepGames >= 4

    return [
      {
        icon: Shield,
        title: 'Wall',
        desc: 'Keep the opposition off the scoresheet 3 times',
        progress: Math.min(cleanSheets, 3),
        target: 3,
        status: wallDone ? 'Completed' : `${3 - cleanSheets} clean sheet${3 - cleanSheets !== 1 ? 's' : ''} to go`,
        reward: '+4 SPIRIT · Tier nudge',
        state: wallDone ? 'done' : 'active',
      },
      {
        icon: Flame,
        title: 'Sweeper Keeper',
        desc: '4 high-quality keeper performances',
        progress: Math.min(sweepGames, 4),
        target: 4,
        status: sweepDone ? 'Completed' : `${4 - sweepGames} strong match${4 - sweepGames !== 1 ? 'es' : ''} to go`,
        reward: '+3 CONSISTENCY',
        state: sweepDone ? 'done' : 'active',
      },
      coachPick,
    ]
  }

  // ── Defender ──────────────────────────────────────────────────────────────
  if (group === 'def') {
    const rockGames = ratingCount(7.0)
    const rockDone = rockGames >= 5

    const resilStreak = ratingStreak(6.5)
    const resilDone = resilStreak >= 3

    return [
      {
        icon: Shield,
        title: 'Rock Solid',
        desc: 'Consistent, commanding displays at the back',
        progress: Math.min(rockGames, 5),
        target: 5,
        status: rockDone ? 'Completed' : `${5 - rockGames} strong match${5 - rockGames !== 1 ? 'es' : ''} to go`,
        reward: '+4 CONSISTENCY',
        state: rockDone ? 'done' : 'active',
      },
      {
        icon: Zap,
        title: 'Resilient',
        desc: '3 solid performances back to back',
        progress: Math.min(resilStreak, 3),
        target: 3,
        status: resilDone
          ? 'Completed'
          : resilStreak > 0
          ? `${resilStreak} in a row — keep going`
          : '3 consecutive matches to go',
        reward: '+3 SPIRIT',
        state: resilDone ? 'done' : 'active',
      },
      coachPick,
    ]
  }

  // ── Midfielder ────────────────────────────────────────────────────────────
  if (group === 'mid') {
    const totalMatches = sorted.length
    const metroDone = totalMatches >= 6

    const fireStreak = ratingStreak(7.0)
    const fireDone = fireStreak >= 3

    return [
      {
        icon: Activity,
        title: 'Metronome',
        desc: "Play in 6 matches — the engine never stops",
        progress: Math.min(totalMatches, 6),
        target: 6,
        status: metroDone ? 'Completed' : `${6 - totalMatches} match${6 - totalMatches !== 1 ? 'es' : ''} to go`,
        reward: '+4 WORKRATE',
        state: metroDone ? 'done' : 'active',
      },
      {
        icon: Flame,
        title: 'On Fire',
        desc: 'Control the middle in 3 straight matches',
        progress: Math.min(fireStreak, 3),
        target: 3,
        status: fireDone
          ? 'Completed'
          : fireStreak > 0
          ? `${fireStreak} in a row — keep it going`
          : '3 consecutive to go',
        reward: '+3 TECHNIQUE',
        state: fireDone ? 'done' : 'active',
      },
      coachPick,
    ]
  }

  // ── Attacker ──────────────────────────────────────────────────────────────
  const clinicalGames = ratingCount(7.5)
  const clinicalDone = clinicalGames >= 4

  const attStreak = ratingStreak(7.0)
  const attFireDone = attStreak >= 3

  return [
    {
      icon: Zap,
      title: 'Clinical',
      desc: '4 dangerous, decisive attacking displays',
      progress: Math.min(clinicalGames, 4),
      target: 4,
      status: clinicalDone ? 'Completed' : `${4 - clinicalGames} match${4 - clinicalGames !== 1 ? 'es' : ''} to go`,
      reward: '+4 IMPACT',
      state: clinicalDone ? 'done' : 'active',
    },
    {
      icon: Flame,
      title: 'On Fire',
      desc: '3 explosive consecutive performances',
      progress: Math.min(attStreak, 3),
      target: 3,
      status: attFireDone
        ? 'Completed'
        : attStreak > 0
        ? `${attStreak} in a row — keep going`
        : '3 consecutive to go',
      reward: '+3 TECHNIQUE',
      state: attFireDone ? 'done' : 'active',
    },
    coachPick,
  ]
}

export default function PlayerEvolutionCard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const cardRef = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)
  const [name, setName] = useState('Player')
  const [positionDisplay, setPositionDisplay] = useState('—')
  const [posGroup, setPosGroup] = useState<PosGroup>('mid')
  const [club, setClub] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [stats, setStats] = useState<typeof FALLBACK_STATS>(() => {
    if (!user) return FALLBACK_STATS
    try {
      const stored = localStorage.getItem(`trak_last_stats_${user.id}`)
      if (!stored) return FALLBACK_STATS
      const data = JSON.parse(stored)
      return [
        { key: 'CONSISTENCY', value: data.CONSISTENCY ?? 50 },
        { key: 'IMPACT',      value: data.IMPACT      ?? 50 },
        { key: 'WORKRATE',    value: data.WORKRATE     ?? 50 },
        { key: 'TECHNIQUE',   value: data.TECHNIQUE    ?? 50 },
        { key: 'SPIRIT',      value: data.SPIRIT       ?? 50 },
      ]
    } catch { return FALLBACK_STATS }
  })
  const [hasAssessment, setHasAssessment] = useState(() => {
    if (!user) return false
    try { return !!localStorage.getItem(`trak_last_stats_${user.id}`) } catch { return false }
  })
  const [evolutions, setEvolutions] = useState<EvoQuest[]>([])
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  const [barsReady, setBarsReady] = useState(false)
  const [questsReady, setQuestsReady] = useState(false)
  const [history, setHistory] = useState<CardSnapshot[]>(() => {
    if (!user) return []
    try {
      const stored = localStorage.getItem(`trak_card_history_${user.id}`)
      if (!stored) return []
      return JSON.parse(stored) as CardSnapshot[]
    } catch { return [] }
  })

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const [{ data: profile }, { data: details }, { data: matches }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('user_id', user.id).maybeSingle(),
        supabase.from('player_details').select('position, current_club, age_group').eq('user_id', user.id).maybeSingle(),
        supabase.from('matches')
          .select('computed_rating, opponent_score, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
      ])

      if (profile?.full_name) setName(profile.full_name)
      if (details?.position) {
        setPositionDisplay(details.position.toUpperCase())
        setPosGroup(posGroupFromPosition(details.position))
      }
      if (details?.current_club) setClub(details.current_club)
      if (details?.age_group) setAgeGroup(details.age_group)

      // Find this player's squad_player rows (coaches who linked them)
      const { data: squadRows } = await supabase
        .from('squad_players').select('id').eq('linked_player_id', user.id)
      const squadIds = (squadRows ?? []).map(r => r.id)

      const [assessmentsRes, awardsRes] = await Promise.all([
        squadIds.length > 0
          ? supabase.from('coach_assessments')
              .select('work_rate, tactical, attitude, technical, physical, coachability, created_at')
              .in('squad_player_id', squadIds)
              .order('created_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: null }),
        squadIds.length > 0
          ? supabase.from('recognition_awards').select('id').in('squad_player_id', squadIds)
          : Promise.resolve({ data: null }),
      ])

      const awardCount = awardsRes.data?.length ?? 0
      const group = details?.position ? posGroupFromPosition(details.position) : 'mid'
      setEvolutions(computePositionQuests(group, (matches ?? []) as any, awardCount))
      setTimeout(() => setQuestsReady(true), 150)

      const assessments = assessmentsRes.data
      if (!assessments || assessments.length === 0) {
        setTimeout(() => setBarsReady(true), 100)
        return
      }

      const n = assessments.length
      const sums = { consistency: 0, impact: 0, workrate: 0, technique: 0, spirit: 0 }
      for (const a of assessments as any[]) {
        const wr    = a.work_rate    ?? 5
        const tac   = a.tactical     ?? 5
        const att   = a.attitude     ?? 5
        const tech  = a.technical    ?? 5
        const coach = a.coachability ?? 5
        sums.consistency += att
        sums.impact      += tech
        sums.workrate    += wr
        sums.technique   += (tech + tac) / 2
        sums.spirit      += (att + coach) / 2
      }
      const toOvr = (v: number) => Math.round((v / n) * 10)
      const newStats = [
        { key: 'CONSISTENCY', value: toOvr(sums.consistency) },
        { key: 'IMPACT',      value: toOvr(sums.impact) },
        { key: 'WORKRATE',    value: toOvr(sums.workrate) },
        { key: 'TECHNIQUE',   value: toOvr(sums.technique) },
        { key: 'SPIRIT',      value: toOvr(sums.spirit) },
      ]
      setStats(newStats)
      setHasAssessment(true)
      setTimeout(() => setBarsReady(true), 100)

      // Card history — append snapshot when OVR changes
      const historyKey = `trak_card_history_${user.id}`
      try {
        const storedHist = localStorage.getItem(historyKey)
        const hist: CardSnapshot[] = storedHist ? JSON.parse(storedHist) : []
        const computedOvr = Math.round(newStats.reduce((s, x) => s + x.value, 0) / newStats.length)
        const computedTier = tierFromOvr(computedOvr)
        const last = hist[0]
        if (!last || last.ovr !== computedOvr) {
          const newSnap: CardSnapshot = { date: new Date().toISOString(), ovr: computedOvr, tier: computedTier }
          const updated = [newSnap, ...hist].slice(0, 20)
          localStorage.setItem(historyKey, JSON.stringify(updated))
          setHistory(updated)
        }
      } catch { /* ignore */ }

      // Stat delta computation — compare to last stored snapshot
      const storageKey = `trak_last_stats_${user.id}`
      try {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
          const prev: Record<string, number> = JSON.parse(stored)
          const computed: Record<string, number> = {}
          for (const s of newStats) {
            computed[s.key] = Math.round(s.value - (prev[s.key] ?? s.value))
          }
          setDeltas(computed)
        }
        // Always write the current snapshot
        const snapshot: Record<string, number> = {}
        for (const s of newStats) snapshot[s.key] = s.value
        localStorage.setItem(storageKey, JSON.stringify(snapshot))
      } catch { /* localStorage unavailable — ignore silently */ }
    })()
  }, [user])

  const ovr = Math.round(stats.reduce((s, x) => s + x.value, 0) / stats.length)
  const tierName: Tier = hasAssessment ? tierFromOvr(ovr) : 'Bronze'
  const tier = TIERS[tierName]
  const initials = initialsOf(name)

  // Tier progress derived values
  const tierSpan   = tier.max - tier.min
  const tierOffset = Math.max(0, ovr - tier.min)
  const tierPct    = tierSpan > 0 ? (tierOffset / tierSpan) * 100 : 100
  const toNext     = tier.nextLabel ? tier.max + 1 - ovr : 0

  const series1Complete = evolutions.length === 3 && evolutions.every(e => e.state === 'done')

  // F-4. This used to call navigator.share({ title, text }) with no `files`
  // key, so the share sheet received a sentence and Messages pasted the card
  // as plain writing. It now shares the card as an image, the way the passport
  // already did, through the one implementation in card-export.ts.
  const handleShare = async () => {
    if (sharing) return
    setSharing(true)
    try {
      const blob = await captureElementToPng(cardRef.current, {
        background: '#0A0A0B',
      })
      if (!blob) {
        toast.error('Could not render your card — please try again')
        return
      }
      const outcome = await shareOrSaveImage(blob, {
        filename: 'trak-evolution-card.png',
        title: `${name} · TRAK Evolution Card`,
      })
      if (outcome === 'saved') toast.success('Card saved as an image')
      if (outcome === 'failed') toast.error('Could not share your card')
      // 'shared' needs no toast — the share sheet is the feedback.
      // 'cancelled' is the player closing that sheet, which is not an error.
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      <MobileShell>
        {/* Top bar */}
        <div className="pt-5 pb-3 flex items-center justify-center">
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)',
          }}>
            EVOLUTION CARD
          </span>
        </div>

        {/* THE CARD */}
        <div className="flex justify-center mt-2">
          <div
            ref={cardRef}
            className="relative"
            style={{
              width: '100%', maxWidth: 360, aspectRatio: '3 / 4',
              borderRadius: 24, padding: 2,
              background: `conic-gradient(from 140deg, ${tier.ring}, rgba(255,255,255,0.04) 35%, ${tier.ring} 65%, rgba(255,255,255,0.04) 95%)`,
              boxShadow: `0 0 60px ${tier.glow}, 0 20px 60px rgba(0,0,0,0.6)`,
            }}
          >
            <div
              className="relative w-full h-full overflow-hidden flex flex-col"
              style={{
                borderRadius: 22,
                background: 'radial-gradient(120% 80% at 50% 0%, #18181C 0%, #101012 55%, #0A0A0B 100%)',
                padding: 22,
              }}
            >
              {/* Volt corner glow */}
              <div className="absolute pointer-events-none" style={{
                inset: 0,
                background: 'radial-gradient(circle at 100% 100%, rgba(200,242,90,0.10), transparent 55%)',
              }} />

              {/* Static diagonal sheen */}
              <div className="absolute pointer-events-none" style={{
                inset: 0, borderRadius: 22, zIndex: 10,
                background: `linear-gradient(105deg, transparent 35%, rgba(255,255,255,${tier.shimmerOpacity}) 50%, transparent 65%)`,
              }} />

              {/* Top row: OVR + Tier */}
              <div className="relative flex items-start justify-between" style={{ zIndex: 20 }}>
                <div>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 200, fontSize: 64, lineHeight: 0.9,
                    letterSpacing: '-0.04em', color: '#FFFFFF',
                  }}>
                    {ovr}
                  </div>
                  <div className="mt-1" style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9, letterSpacing: '0.2em',
                    textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
                  }}>
                    {positionDisplay}{ageGroup ? ` · ${ageGroup}` : ''}
                  </div>

                  {/* Tier progress bar + next-tier label */}
                  <div className="mt-2" style={{ width: 96 }}>
                    <div style={{
                      height: 3, borderRadius: 999, overflow: 'hidden',
                      background: 'rgba(255,255,255,0.08)',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 999,
                        width: `${tierPct}%`,
                        background: tier.label,
                        transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
                      }} />
                    </div>
                    <div style={{
                      marginTop: 4,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 8, letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: tier.label,
                    }}>
                      {tier.nextLabel ? `${toNext} to ${tier.nextLabel}` : 'Peak — Icon tier'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5" style={{
                    borderRadius: 999,
                    border: `1px solid ${tier.ring}`,
                    background: 'rgba(255,255,255,0.02)',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9, letterSpacing: '0.18em',
                    textTransform: 'uppercase', color: tier.label,
                  }}>
                    {tierName} TIER
                  </span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 8, letterSpacing: '0.22em',
                    textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)',
                  }}>
                    {currentSeasonLabel()}
                  </span>
                </div>
              </div>

              {/* Name + club */}
              <div className="relative mt-5 min-w-0" style={{ zIndex: 20 }}>
                <div className="truncate" style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 400, fontSize: 20,
                  letterSpacing: '-0.02em', color: '#FFFFFF',
                }}>
                  {name}
                </div>
                <div className="truncate mt-0.5" style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9, letterSpacing: '0.16em',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)',
                }}>
                  {club || 'Unaffiliated'}
                </div>
              </div>

              {/* Divider */}
              <div className="relative my-4" style={{
                height: 1, zIndex: 20,
                background: 'linear-gradient(90deg, transparent, rgba(200,242,90,0.35), transparent)',
              }} />

              {/* Stats */}
              <div className="relative flex-1 flex flex-col gap-2.5" style={{ zIndex: 20 }}>
                {stats.map(s => (
                  <StatRow
                    key={s.key}
                    label={s.key}
                    value={s.value}
                    delta={deltas[s.key]}
                    barsReady={barsReady}
                  />
                ))}
              </div>

              {/* Footer */}
              <div className="relative mt-4 flex items-center justify-between" style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 8, letterSpacing: '0.22em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)',
                zIndex: 20,
              }}>
                <span>SERIES 01</span>
                <span>{series1Complete ? '· EVOLVED ·' : evolutions.some(e => e.state === 'done') ? '· EVOLVING ·' : '· ACTIVE ·'}</span>
                <span>{currentSeasonLabel()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Share button */}
        <div className="flex justify-center mt-4 px-4">
          <button
            onClick={handleShare}
            style={{
              width: '100%', maxWidth: 360,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
              background: tier.label,
              color: tier.darkText ? '#000000' : '#ffffff',
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500, fontSize: 14,
            }}
          >
            <Share2 size={15} />
            Share card
          </button>
        </div>

        {/* Evolutions */}
        <div className="mt-7 mb-6">
          <div className="flex items-end justify-between mb-3">
            <h2 style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 400, fontSize: 18,
              letterSpacing: '-0.02em', color: '#FFFFFF',
            }}>
              {series1Complete ? 'Series 01 Complete' : 'Active Evolutions'}
            </h2>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9, letterSpacing: '0.18em',
              textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
            }}>
              SERIES 01
            </span>
          </div>

          {series1Complete && (
            <div className="mb-3 px-4 py-3 rounded-[12px] text-center" style={{
              background: 'rgba(200,242,90,0.07)',
              border: '1px solid rgba(200,242,90,0.2)',
            }}>
              <p style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: '#C8F25A',
              }}>
                All Series 01 challenges complete — Series 02 coming soon
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {evolutions.map(e => (
              <EvoRow key={e.title} {...e} questsReady={questsReady} />
            ))}
          </div>

          {/* Series 02 stub */}
          <div className="mt-3 p-4 rounded-[14px] flex items-center gap-3" style={{
            background: '#101012',
            border: '1px solid rgba(255,255,255,0.05)',
            opacity: 0.5,
          }}>
            <div className="flex items-center justify-center" style={{
              width: 36, height: 36, borderRadius: 10,
              background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.25)',
            }}>
              <Lock size={15} />
            </div>
            <div>
              <div style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500, fontSize: 13,
                color: 'rgba(255,255,255,0.4)', letterSpacing: '-0.01em',
              }}>
                Series 02
              </div>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)',
                marginTop: 2,
              }}>
                {series1Complete ? 'Series 01 complete — coming in a future update' : 'Complete Series 01 to unlock'}
              </div>
            </div>
          </div>
        </div>

        {/* Card History */}
        {history.length > 0 && (
          <div className="mt-7 mb-2">
            <div className="flex items-end justify-between mb-3">
              <h2 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 400, fontSize: 18,
                letterSpacing: '-0.02em', color: '#FFFFFF',
              }}>
                Card History
              </h2>
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9, letterSpacing: '0.18em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
              }}>
                {history.length} SNAPSHOT{history.length !== 1 ? 'S' : ''}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {history.map((snap, i) => {
                const snapTier = TIERS[snap.tier]
                const prev = history[i + 1]
                const delta = prev ? snap.ovr - prev.ovr : null
                const dateStr = new Date(snap.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                return (
                  <div key={snap.date + i} className="flex items-center gap-3 px-4 py-3 rounded-[12px]" style={{
                    background: '#101012',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    {/* Tier colour dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: snapTier.label,
                      boxShadow: `0 0 6px ${snapTier.glow}`,
                    }} />
                    {/* Tier + OVR */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontWeight: 400, fontSize: 14,
                        color: '#FFFFFF', letterSpacing: '-0.01em',
                      }}>
                        {snap.tier}
                      </span>
                      <span style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 11, color: 'rgba(255,255,255,0.45)',
                        marginLeft: 6,
                      }}>
                        · {snap.ovr} OVR
                      </span>
                    </div>
                    {/* Delta vs previous */}
                    {delta !== null && delta !== 0 && (
                      <span style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 9,
                        color: delta > 0 ? 'rgba(200,242,90,0.8)' : 'rgba(251,146,60,0.7)',
                      }}>
                        {delta > 0 ? `+${delta}` : `${delta}`}
                      </span>
                    )}
                    {/* Date */}
                    <span style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9, letterSpacing: '0.12em',
                      color: 'rgba(255,255,255,0.3)',
                      flexShrink: 0,
                    }}>
                      {dateStr}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
      </MobileShell>
    </>
  )
}

function StatRow({
  label, value, delta, barsReady,
}: {
  label: string
  value: number
  delta?: number
  barsReady: boolean
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-3">
      <div style={{
        width: 84,
        fontFamily: "'DM Mono', monospace",
        fontSize: 9, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
      }}>
        {label}
      </div>
      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full" style={{
          width: barsReady ? `${pct}%` : '0%',
          background: 'linear-gradient(90deg, rgba(200,242,90,0.7), #C8F25A)',
          transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
        }} />
      </div>
      <div style={{
        width: 28, textAlign: 'right',
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 400, fontSize: 14,
        color: '#FFFFFF', fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      {/* Delta badge — only rendered when non-zero */}
      {delta !== undefined && delta !== 0 && (
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 7, letterSpacing: '0.1em',
          color: delta > 0 ? 'rgba(200,242,90,0.8)' : 'rgba(251,146,60,0.7)',
          minWidth: 20,
        }}>
          {delta > 0 ? `+${delta}` : `${delta}`}
        </div>
      )}
    </div>
  )
}

function EvoRow({ icon: Icon, title, desc, progress, target, status, reward, state, questsReady }: {
  icon: React.ElementType
  title: string
  desc: string
  progress: number
  target: number
  status: string
  reward: string
  state: EvoState
  questsReady: boolean
}) {
  const pct = Math.round((progress / target) * 100)
  const done = state === 'done'
  const locked = state === 'locked'

  return (
    <div className="relative p-4" style={{
      borderRadius: 14,
      background: '#101012',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center flex-shrink-0" style={{
          width: 36, height: 36, borderRadius: 10,
          background: done ? 'rgba(200,242,90,0.12)' : '#0A0A0B',
          border: `1px solid ${done ? 'rgba(200,242,90,0.35)' : 'rgba(255,255,255,0.08)'}`,
          color: done ? '#C8F25A' : locked ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
        }}>
          {locked ? <Lock size={15} /> : done ? <Check size={16} /> : <Icon size={16} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500, fontSize: 14,
              color: '#FFFFFF', letterSpacing: '-0.01em',
            }}>
              {title}
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9, letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: done ? '#C8F25A' : 'rgba(255,255,255,0.4)',
              flexShrink: 0,
            }}>
              {status}
            </span>
          </div>

          <p className="mt-0.5" style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12, color: 'rgba(255,255,255,0.55)',
            letterSpacing: '-0.01em',
          }}>
            {desc}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full" style={{
                width: questsReady ? `${pct}%` : '0%',
                background: done
                  ? 'linear-gradient(90deg, rgba(200,242,90,0.6), #C8F25A)'
                  : 'linear-gradient(90deg, rgba(200,242,90,0.4), rgba(200,242,90,0.85))',
                transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
              }} />
            </div>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9, letterSpacing: '0.14em',
              color: 'rgba(255,255,255,0.45)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {progress}/{target}
            </span>
          </div>

          <div className="mt-2" style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 9, letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(200,242,90,0.75)',
          }}>
            REWARD · {reward}
          </div>
        </div>
      </div>
    </div>
  )
}
