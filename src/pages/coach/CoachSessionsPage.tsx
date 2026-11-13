import { useCallback, useEffect, useState } from 'react'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { History, Plus } from 'lucide-react'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Button } from '@/components/arc/button/button'
import { useCoachSquad } from '@/lib/coach-squad'

export default function CoachSessionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<any[]>([])
  /* Three states, not two. `[]` alone cannot distinguish "the coach has logged
     nothing" from "we could not ask" — and the empty copy below is a factual
     claim about sessions the coach created themselves. */
  const [loadFailed, setLoadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // TRAK-176/305: the squad picked at the top (or All), plus whole-roster sessions.
  const { eventInSquad } = useCoachSquad(user?.id)
  const shown = sessions.filter(s => eventInSquad(s.squad))

  const loadSessions = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('coach_sessions')
      .select('*')
      .eq('coach_user_id', user.id)
      .order('session_date', { ascending: false })
    if (error) {
      // Keep whatever was already on screen. Blanking the list on a failed
      // refresh would itself be the false empty state this guards against.
      setLoadFailed(true)
      return
    }
    setLoadFailed(false)
    setSessions(data || [])
  }, [user])

  useEffect(() => { void loadSessions() }, [loadSessions])

  const retry = async () => {
    setRetrying(true)
    try { await loadSessions() } finally { setRetrying(false) }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const isMatch = (s: any) => s.session_type?.toLowerCase() === 'match'

  return (
    <MobileShell>
      {/* Topbar */}
      <div className="flex items-center justify-between px-5 py-[10px] border-b border-line shrink-0">
        {/* TRAK-334: the trail (Home › Log › Sessions); its last crumb is the page's name. */}
        <CoachTrail current="Sessions" />
        <h1 className="sr-only">Sessions</h1>
        <button
          onClick={() => navigate('/coach/sessions')}
          className="flex items-center justify-center w-8 h-8 rounded-[9px] bg-brand active:scale-95 transition-transform"
          aria-label="New session"
        >
          <Plus size={16} className="text-on-brand" strokeWidth={2.5} />
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {loadFailed && shown.length === 0 ? (
          <div className="mt-4">
            <LoadError what="your sessions" onRetry={retry} retrying={retrying} />
          </div>
        ) : shown.length === 0 ? (
          // TRAK-432: Arc's empty state: icon, one line, and the button that logs one.
          <div className="arc pt-6">
            <EmptyState icon={<History size={24} strokeWidth={1.5} />} title="No sessions logged yet"
              description="A training or match you log shows up here."
              action={<Button onClick={() => navigate('/coach/sessions')}>Log a session</Button>} />
          </div>
        ) : (
          <div className="space-y-0">
            {shown.map((s) => (
              // TRAK-102: a row opens its session.
              <button
                type="button"
                key={s.id}
                onClick={() => navigate(`/coach/sessions/${s.id}`)}
                className="w-full text-left flex items-center gap-3 py-3 border-b border-line active:bg-raised"
              >
                {/* Icon */}
                <div className="w-[34px] h-[34px] rounded-[10px] bg-raised flex items-center justify-center shrink-0">
                  <span
                    className={`text-[13px] font-semibold ${
                      isMatch(s) ? 'text-success' : 'text-ink-3'
                    }`}
                  >
                    {isMatch(s) ? 'M' : 'T'}
                  </span>
                </div>

                {/* Title + metadata */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-ink truncate">
                    {isMatch(s)
                      ? s.opponent || s.title || 'Match'
                      : s.title || 'Training'}
                  </p>
                  <p
                    className="text-[9px] text-ink-3 mt-0.5 truncate"
                    style={{ fontFamily: 'var(--t-font-mono)' }}
                  >
                    {isMatch(s) ? 'Match' : 'Training'}
                    {s.session_date ? ` · ${formatDate(s.session_date)}` : ''}
                    {isMatch(s) && s.competition ? ` · ${s.competition}` : ''}
                  </p>
                </div>

                {/* Badge */}
                {isMatch(s) ? (
                  <span className="inline-flex items-center h-5 px-2 rounded-[5px] text-[9px] font-medium uppercase tracking-[0.05em] bg-success/15 text-success">
                    {s.result || 'W'}
                    {s.score ? ` ${s.score}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center h-5 px-2 rounded-[5px] text-[9px] font-medium uppercase tracking-[0.05em] bg-raised text-ink-3">
                    {s.focus || 'Tactical'}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No Sessions tab: History is opened from Home, so Home stays marked. */}
      {/* TRAK-254: "+ Create" in the side menu on a laptop; no "+" here on a phone. */}
      <QuickAdd sideMenuOnly />
      <NavBar role="coach" activeTab="/coach/home" onNavigate={navigate} />
    </MobileShell>
  )
}
