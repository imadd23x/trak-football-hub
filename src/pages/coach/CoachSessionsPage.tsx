import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { Plus } from 'lucide-react'

export default function CoachSessionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sessions, setSessions] = useState<any[]>([])
  /* Three states, not two. `[]` alone cannot distinguish "the coach has logged
     nothing" from "we could not ask" — and the empty copy below is a factual
     claim about sessions the coach created themselves. */
  const [loadFailed, setLoadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

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
      <div className="flex items-center justify-between px-5 py-[10px] border-b border-white/[0.07] shrink-0">
        <h1 className="text-[15px] font-semibold text-white/90">Sessions</h1>
        <button
          onClick={() => navigate('/coach/sessions')}
          className="flex items-center justify-center w-8 h-8 rounded-[9px] bg-[#C8F25A] active:scale-95 transition-transform"
          aria-label="New session"
        >
          <Plus size={16} className="text-black" strokeWidth={2.5} />
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {loadFailed && sessions.length === 0 ? (
          <div className="mt-4">
            <LoadError what="your sessions" onRetry={retry} retrying={retrying} />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-white/45 text-sm mt-4">No sessions logged yet.</p>
        ) : (
          <div className="space-y-0">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 py-3 border-b border-white/[0.05]"
              >
                {/* Icon */}
                <div className="w-[34px] h-[34px] rounded-[10px] bg-[#202024] flex items-center justify-center shrink-0">
                  <span
                    className={`text-[13px] font-semibold ${
                      isMatch(s) ? 'text-green-400' : 'text-white/[0.45]'
                    }`}
                  >
                    {isMatch(s) ? 'M' : 'T'}
                  </span>
                </div>

                {/* Title + metadata */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white/[0.88] truncate">
                    {isMatch(s)
                      ? s.opponent || s.title || 'Match'
                      : s.title || 'Training'}
                  </p>
                  <p
                    className="text-[9px] text-white/[0.22] mt-0.5 truncate"
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  >
                    {isMatch(s) ? 'Match' : 'Training'}
                    {s.session_date ? ` · ${formatDate(s.session_date)}` : ''}
                    {isMatch(s) && s.competition ? ` · ${s.competition}` : ''}
                  </p>
                </div>

                {/* Badge */}
                {isMatch(s) ? (
                  <span className="inline-flex items-center h-5 px-2 rounded-[5px] text-[9px] font-medium uppercase tracking-[0.05em] bg-green-500/15 text-green-400">
                    {s.result || 'W'}
                    {s.score ? ` ${s.score}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center h-5 px-2 rounded-[5px] text-[9px] font-medium uppercase tracking-[0.05em] bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.45)]">
                    {s.focus || 'Tactical'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
