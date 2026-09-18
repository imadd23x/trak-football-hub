import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'

const COACH_ID  = '11111111-1111-1111-1111-111111111111'
const PLAYER_ID = '22222222-2222-2222-2222-222222222222'
const PARENT_ID = '33333333-3333-3333-3333-333333333333'
const SQUAD_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const CLUB_ID = '44444444-4444-4444-4444-444444444444'

const ACCOUNTS = [
  { email: 'coach@trak.dev',  password: 'TrakDev123', role: 'coach',  name: 'Alex Martinez'   },
  { email: 'player@trak.dev', password: 'TrakDev123', role: 'player', name: 'Jamie Wilson'     },
  { email: 'parent@trak.dev', password: 'TrakDev123', role: 'parent', name: 'Sarah Wilson'     },
  { email: 'club@trak.dev',   password: 'TrakDev123', role: 'club',   name: 'City FC Academy'  },
]

type Step = { label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }

export default function DevSetupPage() {
  const navigate = useNavigate()
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const update = (label: string, status: Step['status'], detail?: string) =>
    setSteps(prev => {
      const existing = prev.find(s => s.label === label)
      if (existing) return prev.map(s => s.label === label ? { ...s, status, detail } : s)
      return [...prev, { label, status, detail }]
    })

  const trySignUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error && /already registered|already exists/i.test(error.message)) {
      // Already exists — try sign in to get the user
      const { data: si } = await supabase.auth.signInWithPassword({ email, password })
      return si?.user ?? null
    }
    return data?.user ?? null
  }

  const run = async () => {
    setRunning(true)
    setSteps([])

    try {
      // ── 1. Create accounts ──────────────────────────────────────────
      const userIds: Record<string, string> = {}

      for (const acc of ACCOUNTS) {
        update(`Create ${acc.role} account`, 'running')
        const user = await trySignUp(acc.email, acc.password)
        if (!user) {
          update(`Create ${acc.role} account`, 'error', 'Sign-up failed — check if email confirmation is disabled in Supabase Auth settings')
          setRunning(false)
          return
        }
        userIds[acc.role] = user.id
        update(`Create ${acc.role} account`, 'done', user.email ?? acc.email)
      }

      const coachId  = userIds['coach']
      const playerId = userIds['player']
      const parentId = userIds['parent']
      const clubId   = userIds['club']

      // ── 2. Sign in as coach to seed coach data ───────────────────────
      update('Sign in as coach', 'running')
      await supabase.auth.signInWithPassword({ email: 'coach@trak.dev', password: 'TrakDev123' })
      update('Sign in as coach', 'done')

      update('Coach profile + details', 'running')
      await supabase.from('profiles').upsert({ user_id: coachId, role: 'coach' as any, full_name: 'Alex Martinez', invite_code: 'DEMO' }, { onConflict: 'user_id' })
      await supabase.from('coach_details').upsert({ user_id: coachId, current_club: 'City FC Academy', team: 'U15s', coach_role: 'Head Coach' }, { onConflict: 'user_id' })
      update('Coach profile + details', 'done')

      // ── 3. Sign in as player to seed player data ─────────────────────
      update('Sign in as player', 'running')
      await supabase.auth.signInWithPassword({ email: 'player@trak.dev', password: 'TrakDev123' })
      update('Sign in as player', 'done')

      update('Player profile + details', 'running')
      await supabase.from('profiles').upsert({ user_id: playerId, role: 'player' as any, full_name: 'Jamie Wilson' }, { onConflict: 'user_id' })
      await supabase.from('player_details').upsert({ user_id: playerId, date_of_birth: '2010-05-15', position: 'CM', current_club: 'City FC Academy', age_group: 'U15', shirt_number: 8 }, { onConflict: 'user_id' })
      update('Player profile + details', 'done')

      update('Seed 10 matches', 'running')
      const now = Date.now()
      const matches = [
        { team_score: 3, opponent_score: 1, opponent: 'Riverside United', competition: 'League',  venue: 'Home', minutes_played: 90, goals: 1, assists: 1, self_rating: 8, body_condition: 'good',      card_received: 'None',   created_at: new Date(now - 1   * 86400000).toISOString() },
        { team_score: 1, opponent_score: 2, opponent: 'North Academy',    competition: 'League',  venue: 'Away', minutes_played: 90, goals: 0, assists: 0, self_rating: 5, body_condition: 'average',   card_received: 'Yellow', created_at: new Date(now - 8   * 86400000).toISOString() },
        { team_score: 2, opponent_score: 2, opponent: 'East City FC',     competition: 'Cup',     venue: 'Home', minutes_played: 90, goals: 1, assists: 0, self_rating: 7, body_condition: 'good',      card_received: 'None',   created_at: new Date(now - 15  * 86400000).toISOString() },
        { team_score: 4, opponent_score: 0, opponent: 'Valley Rangers',   competition: 'League',  venue: 'Home', minutes_played: 90, goals: 2, assists: 1, self_rating: 9, body_condition: 'excellent', card_received: 'None',   created_at: new Date(now - 22  * 86400000).toISOString() },
        { team_score: 0, opponent_score: 3, opponent: 'Metro Boys',       competition: 'League',  venue: 'Away', minutes_played: 75, goals: 0, assists: 0, self_rating: 4, body_condition: 'tired',     card_received: 'None',   created_at: new Date(now - 29  * 86400000).toISOString() },
        { team_score: 2, opponent_score: 1, opponent: 'Hillside FC',      competition: 'League',  venue: 'Home', minutes_played: 90, goals: 0, assists: 2, self_rating: 7, body_condition: 'good',      card_received: 'None',   created_at: new Date(now - 36  * 86400000).toISOString() },
        { team_score: 1, opponent_score: 1, opponent: 'South Stars',      competition: 'Cup',     venue: 'Away', minutes_played: 90, goals: 1, assists: 0, self_rating: 6, body_condition: 'average',   card_received: 'None',   created_at: new Date(now - 43  * 86400000).toISOString() },
        { team_score: 3, opponent_score: 2, opponent: 'Park City',        competition: 'League',  venue: 'Home', minutes_played: 90, goals: 0, assists: 1, self_rating: 8, body_condition: 'good',      card_received: 'None',   created_at: new Date(now - 50  * 86400000).toISOString() },
        { team_score: 2, opponent_score: 0, opponent: 'West United',      competition: 'League',  venue: 'Away', minutes_played: 85, goals: 1, assists: 0, self_rating: 7, body_condition: 'good',      card_received: 'None',   created_at: new Date(now - 57  * 86400000).toISOString() },
        { team_score: 1, opponent_score: 4, opponent: 'Crestwood FC',     competition: 'League',  venue: 'Away', minutes_played: 90, goals: 0, assists: 0, self_rating: 5, body_condition: 'tired',     card_received: 'None',   created_at: new Date(now - 64  * 86400000).toISOString() },
      ].map(m => ({ ...m, self_rating: String(m.self_rating), user_id: playerId, position: 'CM', age_group: 'U15' }))
      // Guarded: a plain insert here duplicated the whole match history on
      // every re-run, despite this page promising it is safe to repeat.
      const { data: existingMatches } = await supabase.from('matches')
        .select('id').eq('user_id', playerId).limit(1)
      if (!existingMatches?.length) {
        await supabase.from('matches').insert(matches)
      }
      update('Seed 10 matches', 'done')


      // ── 4. Sign back in as coach to create squad + assessments ───────
      update('Sign in as coach (squad + assessments)', 'running')
      await supabase.auth.signInWithPassword({ email: 'coach@trak.dev', password: 'TrakDev123' })
      update('Sign in as coach (squad + assessments)', 'done')

      update('Squad player link', 'running')
      // The coach seeds the roster row UNLINKED. A coach cannot attach a player
      // to their squad by asserting that player's user id — that was finding F3
      // of the K1/K2 departure audit, and this page was doing it. Linking is the
      // player's own act, below.
      await supabase.from('squad_players').upsert({ id: SQUAD_ID, coach_user_id: coachId, player_name: 'Jamie Wilson', position: 'CM', shirt_number: 8 }, { onConflict: 'id' })

      // Sign in as the player and link the real way, with the coach's code.
      // link_player_to_coach() adopts the unlinked row above by name, so it
      // keeps SQUAD_ID and every assessment seeded against it below still lands
      // on the same row. This also means the dev seed exercises the linking path
      // the pilot actually uses, instead of a shortcut only the seed can take.
      await supabase.auth.signInWithPassword({ email: 'player@trak.dev', password: 'TrakDev123' })
      // 'as any' on the name: the committed types.ts omits this RPC, same as
      // provision_my_profile in AuthContext.
      const { data: linkedId, error: linkError } = await supabase.rpc('link_player_to_coach' as any, { p_code: 'DEMO' })
      await supabase.auth.signInWithPassword({ email: 'coach@trak.dev', password: 'TrakDev123' })

      if (linkError) {
        update('Squad player link', 'error', linkError.message)
      } else if (linkedId && linkedId !== SQUAD_ID) {
        // A second unlinked row with the same name would make the adoption
        // ambiguous and the RPC would create a new row instead of adopting.
        update('Squad player link', 'error', `linked ${linkedId}, expected the seeded row — assessments would attach to the wrong row`)
      } else {
        update('Squad player link', 'done')
      }

      update('3 coach assessments', 'running')
      const seedAssessments = [
        { coach_user_id: coachId, squad_player_id: SQUAD_ID, appearance: 'started', work_rate: 8, tactical: 7, attitude: 9, technical: 7, physical: 8, coachability: 8, flag: 'fair',     created_at: new Date(now - 1  * 86400000).toISOString(), _note: 'First touch under pressure needs work — losing the ball in central areas when pressed. Also needs to check his shoulder more before receiving and hold his position better when tracking runners from midfield.' },
        { coach_user_id: coachId, squad_player_id: SQUAD_ID, appearance: 'started', work_rate: 6, tactical: 6, attitude: 7, technical: 6, physical: 7, coachability: 7, flag: 'generous', created_at: new Date(now - 8  * 86400000).toISOString(), _note: 'Struggled to keep the ball under pressure in an away environment. Passing tempo too slow — needs to play quicker one-touch combinations in tight areas and move immediately after playing the ball.' },
        { coach_user_id: coachId, squad_player_id: SQUAD_ID, appearance: 'started', work_rate: 9, tactical: 8, attitude: 9, technical: 8, physical: 9, coachability: 9, flag: 'fair',     created_at: new Date(now - 22 * 86400000).toISOString(), _note: 'Outstanding performance. To reach the next level focus on aerial duels — winning second balls in midfield — and work on the long switch of play to find wide players in space.' },
      ]
      const { data: existingAssessments } = await supabase.from('coach_assessments')
        .select('id').eq('squad_player_id', SQUAD_ID).limit(1)
      if (!existingAssessments?.length) {
        for (const a of seedAssessments) {
          const { _note, ...row } = a
          const { data: ins } = await supabase.from('coach_assessments').insert(row as any).select('id').maybeSingle()
          if (ins?.id) {
            await supabase.from('coach_assessment_notes').insert({ assessment_id: ins.id, coach_user_id: coachId, note: _note })
          }
        }
      }
      update('3 coach assessments', 'done')

      update('Seed calendar events', 'running')
      const dt = (daysFromNow: number, hour: number, min = 0) => {
        const d = new Date(); d.setDate(d.getDate() + daysFromNow); d.setHours(hour, min, 0, 0); return d.toISOString()
      }
      const { data: existingEvents } = await supabase.from('coach_calendar_events')
        .select('id').eq('coach_user_id', coachId).limit(1)
      if (existingEvents?.length) { update('Seed calendar events', 'done') } else {
      await supabase.from('coach_calendar_events').insert([
        {
          coach_user_id: coachId,
          title: 'Training — Pressing & Transitions',
          event_type: 'training',
          starts_at: dt(2, 18),
          ends_at:   dt(2, 19, 30),
          venue: 'City FC Academy — Pitch 2',
          published: true,
          source: 'ai_text',
        },
        {
          coach_user_id: coachId,
          title: 'League Match vs Riverside United',
          event_type: 'match',
          starts_at: dt(5, 15),
          venue: 'Riverside Ground',
          opponent: 'Riverside United',
          published: true,
          source: 'ai_text',
        },
        {
          coach_user_id: coachId,
          title: 'Training — Set Pieces',
          event_type: 'training',
          starts_at: dt(9, 18),
          venue: 'City FC Academy — Main Pitch',
          published: true,
          source: 'ai_text',
        },
        {
          coach_user_id: coachId,
          title: 'Regional Cup — Quarter Final',
          event_type: 'tournament',
          starts_at: dt(14, 14),
          venue: 'Central Sports Complex',
          published: true,
          source: 'ai_text',
        },
      ])
      update('Seed calendar events', 'done')
      }

      update('Player of the Week award', 'running')
      // Plain insert here was not idempotent, so every re-run added another
      // identical award and the player's passport showed duplicates.
      const { data: existingAward } = await supabase.from('recognition_awards')
        .select('id')
        .eq('squad_player_id', SQUAD_ID)
        .eq('award_type', 'player_of_week')
        .eq('awarded_for', 'Week of 14 Apr')
        .maybeSingle()
      if (!existingAward) {
        await supabase.from('recognition_awards').insert({
          coach_user_id: coachId, squad_player_id: SQUAD_ID,
          award_type: 'player_of_week', awarded_for: 'Week of 14 Apr',
          note: 'Best performance vs Valley Rangers — 2 goals, 1 assist.',
          created_at: new Date(now - 6 * 86400000).toISOString(),
        })
      }
      update('Player of the Week award', 'done')

      // ── 5. Sign in as parent to seed parent data ─────────────────────
      update('Sign in as parent', 'running')
      await supabase.auth.signInWithPassword({ email: 'parent@trak.dev', password: 'TrakDev123' })
      update('Sign in as parent', 'done')

      update('Parent profile + links', 'running')
      await supabase.from('profiles').upsert({ user_id: parentId, role: 'parent' as any, full_name: 'Sarah Wilson' }, { onConflict: 'user_id' })
      await supabase.from('player_parent_links').upsert({ player_user_id: playerId, parent_user_id: parentId }, { onConflict: 'player_user_id,parent_user_id' }).then(() => {})
      await supabase.from('parent_invites').upsert({ player_user_id: playerId, parent_email: 'parent@trak.dev' }).then(() => {})
      update('Parent profile + links', 'done')

      // ── 6. Sign out ─────────────────────────────────────────────────
      // ── Club admin account ────────────────────────────────────────────
      update('Club admin profile', 'running')
      await supabase.auth.signInWithPassword({ email: 'club@trak.dev', password: 'TrakDev123' })
      await supabase.from('profiles').upsert({
        user_id: clubId, role: 'club', full_name: 'City FC Academy',
      }, { onConflict: 'user_id' })
      update('Club admin profile', 'done', 'club@trak.dev')

      await supabase.auth.signOut()
      setDone(true)

    } catch (err: any) {
      update('Unexpected error', 'error', err?.message ?? String(err))
    }

    setRunning(false)
  }

  const iconFor = (s: Step['status']) =>
    s === 'done' ? '[done]' : s === 'error' ? '[err]' : s === 'running' ? '...' : '·'

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-start px-5 py-10 max-w-md mx-auto">
      <div className="w-full mb-8">
        <p className="text-[9px] font-medium tracking-[0.12em] text-white/30 uppercase mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>Dev only</p>
        <h1 className="text-[26px] font-light text-white/90 leading-tight" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>
          Seed test accounts
        </h1>
        <p className="text-[12px] text-white/40 mt-1">
          Creates coach / player / parent accounts with realistic sample data. Safe to run multiple times.
        </p>
      </div>

      <div className="w-full rounded-[14px] p-4 mb-5 space-y-1"
        style={{ background: 'rgba(200,242,90,0.05)', border: '1px solid rgba(200,242,90,0.15)' }}>
        {[
          { role: 'Coach',  email: 'coach@trak.dev' },
          { role: 'Player', email: 'player@trak.dev' },
          { role: 'Parent', email: 'parent@trak.dev' },
          { role: 'Admin',  email: 'club@trak.dev'   },
        ].map(a => (
          <div key={a.role} className="flex justify-between text-[12px]">
            <span className="text-white/50">{a.role}</span>
            <span className="text-[#C8F25A]/70" style={{ fontFamily: "'DM Mono', monospace" }}>{a.email} · TrakDev123</span>
          </div>
        ))}
      </div>

      {steps.length > 0 && (
        <div className="w-full rounded-[14px] p-4 mb-5 space-y-2"
          style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}>
          {steps.map(s => (
            <div key={s.label} className="flex items-start gap-2 text-[12px]">
              <span className="flex-shrink-0 w-4">{iconFor(s.status)}</span>
              <div>
                <span className="text-white/70">{s.label}</span>
                {s.detail && <p className="text-[10px] text-white/35 mt-0.5">{s.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {done ? (
        <div className="w-full space-y-2">
          <div className="text-center py-3 text-[14px] font-semibold text-[#C8F25A]">All done!</div>
          <button onClick={() => navigate('/')}
            className="w-full py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm">
            Go to app →
          </button>
        </div>
      ) : (
        <button onClick={run} disabled={running}
          className="w-full py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm disabled:opacity-50 transition-opacity">
          {running ? 'Setting up...' : 'Run Setup →'}
        </button>
      )}

      <p className="text-[10px] text-white/20 mt-4 text-center" style={{ fontFamily: "'DM Mono', monospace" }}>
        Note: Disable "Confirm email" in Supabase Auth settings if sign-up fails
      </p>

      <button onClick={() => navigate('/')} className="mt-3 text-[11px] text-white/25 hover:text-white/50">
        ← Back to landing
      </button>
    </div>
  )
}
