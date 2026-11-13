import { useEffect, useState } from 'react'
import { trackEvent } from '@/lib/telemetry'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { computeMatchScore } from '@/lib/rating-engine'
import { localTodayISO } from '@/lib/event-time'

/**
 * Quick Match Log — 1-minute capture at full-time.
 * Writes to coach_sessions + session_attendance + matches (for linked players).
 */

type SquadPlayer = { id: string; player_name: string; linked_player_id: string | null; position: string | null; age: number | null }

export default function CoachQuickMatchLog() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [squad, setSquad] = useState<SquadPlayer[]>([])
  const [opponent, setOpponent] = useState('')
  const [scoreUs, setScoreUs] = useState('')
  const [scoreThem, setScoreThem] = useState('')
  const [competition, setCompetition] = useState<'League' | 'Tournament' | 'Friendly'>('League')
  const [venue, setVenue] = useState<'Home' | 'Away'>('Home')
  const [attended, setAttended] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  /* Match coverage is measured against the fixture list by date, so the day the
     match was PLAYED has to be recorded — a Sunday match logged on Monday would
     otherwise miss its fixture entirely and read as uncovered. */
  const [matchDate, setMatchDate] = useState(localTodayISO)

  useEffect(() => {
    if (!user) return
    supabase.from('squad_players').select('id, player_name, linked_player_id, position, age')
      .eq('coach_user_id', user.id)
      .order('player_name')
      .then(({ data }) => setSquad(data || []))
  }, [user])

  const togglePlayer = (id: string) => {
    setAttended(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAll = () => setAttended(new Set(squad.map(p => p.id)))
  const clearAll = () => setAttended(new Set())

  const canSave = opponent.trim().length > 0 && scoreUs !== '' && scoreThem !== ''

  const handleSave = async () => {
    if (!user || !canSave) return
    setSaving(true)
    const title = `vs ${opponent.trim()}`
    const { data: session, error } = await supabase
      .from('coach_sessions')
      .insert({
        coach_user_id: user.id,
        title,
        session_type: 'match',
        competition,
        venue,
        notes: `${scoreUs}-${scoreThem}`,
      })
      .select()
      .single()

    if (error || !session) {
      toast.error('Could not save match')
      setSaving(false)
      return
    }

    if (attended.size > 0) {
      const attendedPlayers = squad.filter(p => attended.has(p.id))

      // session_attendance rows
      const attendanceRows = attendedPlayers.map(p => ({
        session_id: session.id,
        squad_player_id: p.id,
        status: 'present',
      }))
      await supabase.from('session_attendance').insert(attendanceRows)

      // matches rows for every linked player
      const linkedPlayers = attendedPlayers.filter(p => p.linked_player_id)
      if (linkedPlayers.length > 0) {
        const matchRows = linkedPlayers.map(p => {
          // Map squad position string to rating-engine position key
          const posRaw = (p.position || '').toLowerCase()
          const pos =
            posRaw.includes('goalkeeper') || posRaw === 'gk' ? 'gk'
            : posRaw.includes('defender') || posRaw === 'def' || posRaw === 'cb' || posRaw === 'lb' || posRaw === 'rb' ? 'def'
            : posRaw.includes('attacker') || posRaw === 'att' || posRaw === 'cf' || posRaw === 'st' || posRaw === 'lw' || posRaw === 'rw' ? 'att'
            : 'mid'

          const computed_rating = computeMatchScore({
            position: pos,
            competition: competition.toLowerCase() as 'league' | 'cup' | 'friendly',
            venue: venue.toLowerCase() as 'home' | 'away',
            opponent: opponent.trim(),
            score_us: Number(scoreUs) || 0,
            score_them: Number(scoreThem) || 0,
            minutes_played: 90,
            card: 'none',
            body_condition: 'good',
            self_rating: 'average',
            position_inputs: {},
            is_friendly: competition === 'Friendly',
          })

          return {
            linked_player_id: p.linked_player_id!,
            opponent: opponent.trim(),
            team_score: Number(scoreUs) || 0,
            opponent_score: Number(scoreThem) || 0,
            competition,
            venue,
            position: p.position || 'Midfielder',
            age_group: p.age != null ? String(p.age) : 'U19+',
            computed_rating,
          }
        })

        // Direct insert is blocked by RLS (user_id ≠ coach's auth.uid()).
        // Use the SECURITY DEFINER RPC which verifies the coach→player link
        // before writing, so the row actually reaches the player's match history.
        for (const row of matchRows) {
          await supabase.rpc('log_match_for_player', {
            p_user_id:         row.linked_player_id,
            p_opponent:        row.opponent,
            p_team_score:      row.team_score,
            p_opponent_score:  row.opponent_score,
            p_competition:     row.competition,
            p_venue:           row.venue,
            p_position:        row.position,
            p_age_group:       row.age_group,
            p_minutes_played:  90,
            p_goals:           0,
            p_assists:         0,
            p_card_received:   'None',
            p_body_condition:  'Average',
            p_self_rating:     'Average',
            p_computed_rating: row.computed_rating,
            p_match_date:      matchDate,
          })
        }

        trackEvent('match_logged', {
          actor: 'coach',
          players: matchRows.length,
          match_date: matchDate,
          competition,
          venue,
        })
      }
    }

    toast.success('Match logged')
    setSaving(false)
    navigate('/coach/sessions/list')
  }

  const result =
    scoreUs === '' || scoreThem === '' ? null :
    Number(scoreUs) > Number(scoreThem) ? 'W' :
    Number(scoreUs) < Number(scoreThem) ? 'L' : 'D'

  return (
    <MobileShell>
      {/* Topbar */}
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-line">
        <button
          onClick={() => navigate('/coach/sessions')}
          className="w-[34px] h-[34px] bg-raised border border-line rounded-[10px] flex items-center justify-center"
          aria-label="Back"
        >
          <ChevronLeft size={14} className="text-ink" />
        </button>
        <span
          className="text-[16px] font-medium text-ink tracking-tight"
          style={{ fontFamily: 'var(--t-font)' }}
        >
          Quick match log
        </span>
        <div className="w-[34px]" />
      </div>

      <div className="pt-5 pb-32 space-y-5">
        {/* Match date */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <span
            className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 block mb-3"
            style={{ fontFamily: 'var(--t-font-mono)' }}
          >
            DATE PLAYED
          </span>
          <input
            type="date"
            value={matchDate}
            max={localTodayISO()}
            onChange={e => setMatchDate(e.target.value)}
            className="w-full bg-transparent text-[20px] text-ink outline-none"
            style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}
          />
        </div>

        {/* Opponent + score */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <span
            className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 block mb-3"
            style={{ fontFamily: 'var(--t-font-mono)' }}
          >
            OPPONENT
          </span>
          <input
            value={opponent}
            onChange={e => setOpponent(e.target.value)}
            placeholder="Opponent name"
            className="w-full bg-transparent text-[20px] text-ink placeholder-ink-3 outline-none"
            style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}
          />

          <div className="grid grid-cols-3 items-center gap-3 mt-5">
            <div className="text-center">
              <span
                className="block text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 mb-2"
                style={{ fontFamily: 'var(--t-font-mono)' }}
              >US</span>
              <input
                inputMode="numeric"
                value={scoreUs}
                onChange={e => setScoreUs(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="0"
                className="w-full bg-ground border border-line rounded-[12px] py-3 text-center text-[28px] text-ink placeholder-ink-3 outline-none"
                style={{ fontFamily: 'var(--t-font)' }}
              />
            </div>
            <div className="text-center">
              <span
                className="block text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 mb-2"
                style={{ fontFamily: 'var(--t-font-mono)' }}
              >RESULT</span>
              <div
                className="w-full py-3 rounded-[12px] text-center text-[28px]"
                style={{
                  fontFamily: 'var(--t-font)',
                  color: result === 'W' ? 'rgb(var(--t-brand))' : result === 'L' ? 'rgb(var(--t-ink-3))' : 'rgb(var(--t-ink-2))',
                }}
              >
                {result || '–'}
              </div>
            </div>
            <div className="text-center">
              <span
                className="block text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 mb-2"
                style={{ fontFamily: 'var(--t-font-mono)' }}
              >THEM</span>
              <input
                inputMode="numeric"
                value={scoreThem}
                onChange={e => setScoreThem(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="0"
                className="w-full bg-ground border border-line rounded-[12px] py-3 text-center text-[28px] text-ink placeholder-ink-3 outline-none"
                style={{ fontFamily: 'var(--t-font)' }}
              />
            </div>
          </div>
        </div>

        {/* Competition + venue chips */}
        <div className="rounded-[18px] p-4 border border-line bg-surface space-y-4">
          <div>
            <span
              className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 block mb-2"
              style={{ fontFamily: 'var(--t-font-mono)' }}
            >
              COMPETITION
            </span>
            <div className="flex gap-2 flex-wrap">
              {(['League', 'Tournament', 'Friendly'] as const).map(c => (
                <Chip key={c} active={competition === c} onClick={() => setCompetition(c)}>{c}</Chip>
              ))}
            </div>
          </div>
          <div>
            <span
              className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 block mb-2"
              style={{ fontFamily: 'var(--t-font-mono)' }}
            >
              VENUE
            </span>
            <div className="flex gap-2">
              {(['Home', 'Away'] as const).map(v => (
                <Chip key={v} active={venue === v} onClick={() => setVenue(v)}>{v}</Chip>
              ))}
            </div>
          </div>
        </div>

        {/* Attendance */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <div className="flex items-center justify-between mb-3">
            <span
              className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3"
              style={{ fontFamily: 'var(--t-font-mono)' }}
            >
              ATTENDED · {attended.size}/{squad.length}
            </span>
            <div className="flex gap-3">
              <button
                onClick={selectAll}
                className="text-[10px] tracking-[0.12em] uppercase text-brand"
                style={{ fontFamily: 'var(--t-font-mono)' }}
              >ALL</button>
              <button
                onClick={clearAll}
                className="text-[10px] tracking-[0.12em] uppercase text-ink-3"
                style={{ fontFamily: 'var(--t-font-mono)' }}
              >NONE</button>
            </div>
          </div>

          {squad.length === 0 ? (
            <p className="text-[12px] text-ink-3 py-2">
              No squad yet. Add players from the Squad tab first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {squad.map(p => {
                const on = attended.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePlayer(p.id)}
                    className="text-left px-3 py-2.5 rounded-[10px] transition-colors"
                    style={{
                      background: on ? 'rgb(var(--t-brand) / 0.08)' : 'rgb(var(--t-raised))',
                      border: `1px solid ${on ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}`,
                      color: on ? 'rgb(var(--t-ink))' : 'rgb(var(--t-ink-2))',
                      fontFamily: 'var(--t-font)',
                      fontSize: 13,
                    }}
                  >
                    {p.player_name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky save bar */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] px-5 pb-5 pt-3"
        style={{
          background: 'linear-gradient(180deg, rgb(var(--t-ground) / 0) 0%, rgb(var(--t-ground)) 35%)',
        }}
      >
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="w-full py-3.5 rounded-[12px] text-[14px] font-medium transition-opacity"
          style={{
            background: canSave ? 'rgb(var(--t-brand))' : 'rgb(var(--t-raised))',
            color: canSave ? 'rgb(var(--t-on-brand))' : 'rgb(var(--t-ink-3))',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save match'}
        </button>
      </div>
    </MobileShell>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
      style={{
        background: active ? 'rgb(var(--t-brand) / 0.12)' : 'rgb(var(--t-raised))',
        color: active ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))',
        border: `1px solid ${active ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}`,
        fontFamily: 'var(--t-font)',
      }}
    >
      {children}
    </button>
  )
}