import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { People } from '@/components/coach/EventSheetCoach'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

type Person = { id: string; name: string }
type Register = { came: Person[]; missed: Person[] }

/**
 * TRAK-182 (live run 3, 16 Oct): a logged session's sheet said only "Logged."
 * It now shows the saved register: who came and who didn't. A failed read says
 * so, never an empty register.
 */
export function LoggedAttendance({ sessionId, coachId }: { sessionId: string; coachId: string }) {
  const [register, setRegister] = useState<Register | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let stale = false
    setRegister(null); setFailed(false)
    void Promise.all([
      supabase.from('session_attendance').select('squad_player_id, status').eq('session_id', sessionId),
      supabase.from('squad_players').select('id, player_name').eq('coach_user_id', coachId),
    ]).then(([attendance, roster]) => {
      if (stale) return
      if (attendance.error || roster.error) { setFailed(true); return }
      const names = new Map((roster.data ?? []).map(p => [p.id, p.player_name || 'Player']))
      const rows = (attendance.data ?? []).map(a => ({ id: a.squad_player_id as string, name: names.get(a.squad_player_id) ?? 'Player', present: a.status === 'present' }))
      setRegister({ came: rows.filter(r => r.present), missed: rows.filter(r => !r.present) })
    })
    return () => { stale = true }
  }, [sessionId, coachId])

  const heading = 'text-[15px] font-medium text-ink mb-2'
  if (failed) return <p role="alert" className="text-[13px] text-ink-2">Couldn't load who came.</p>
  if (!register) return <LoadingSkeleton label="Loading…" lines={1} avatar rows={3} />
  return (
    <div className="space-y-5">
      <div>
        <h3 className={heading}>Attended · {register.came.length}</h3>
        <People heading="Attended" people={register.came} />
      </div>
      {register.missed.length > 0 && (
        <div>
          <h3 className={heading}>Didn't come · {register.missed.length}</h3>
          <People heading="Didn't come" people={register.missed} />
        </div>
      )}
    </div>
  )
}
