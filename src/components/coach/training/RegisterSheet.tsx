import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { TakeRegister } from '@/components/coach/TakeRegister'
import { SessionLog } from '@/components/coach/SessionLog'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { gameWhen } from '@/components/coach/games/useGames'
import type { Training } from './useTraining'

/* TRAK-298 (Training 5/5): Who's here is the existing register, in a sheet; View log is the session's log. TRAK-339:
   moved here so the Next training card opens the same sheet as the training's page. */

export function RegisterSheet({ training, sheet, sessionId, onClose }: {
  training: Training; sheet: 'register' | 'log' | null; sessionId: string | null; onClose: () => void
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  if (!user) return null
  return <BottomSheet className="arc" open={!!sheet} onOpenChange={open => { if (!open) onClose() }} detents={[0.62, 0.92]}
    title={sheet === 'log' ? 'The log' : 'Who’s here'} description={[gameWhen(training).day, training.title].join(' · ')}>
    <div className="pb-4">
      {sheet === 'register' && <TakeRegister eventId={training.id} coachId={user.id} sessionId={sessionId} squad={training.squad ?? null}
        onSaved={() => {
          onClose()
          void client.invalidateQueries({ queryKey: ['coach', user.id, 'training-registers'] })
          void client.invalidateQueries({ queryKey: ['coach', user.id, 'training-here'] })
        }} />}
      {sheet === 'log' && sessionId && <SessionLog sessionId={sessionId} coachId={user.id} />}
    </div>
  </BottomSheet>
}
