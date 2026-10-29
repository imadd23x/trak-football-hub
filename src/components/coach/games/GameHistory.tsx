import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { EventRow } from '@/lib/coach-events'
import { LoadError } from '@/components/trak'
import { Timeline } from '@/components/arc/timeline/timeline'

/* TRAK-289 (Games 7/8): the game's History (TRAK-282), the visible start and end of its loop: created, plan drafted,
   shared and each change shared to N, locked at kick-off, evaluation draft saved, published. Newest first, grouped by
   day on this phone's clock (Imad, 23 Oct). Every step is read from what the loop already keeps. */

export function GameHistory({ game, planCreatedAt, savedAt, publishedAt }: {
  game: EventRow & { created_at?: string | null }
  planCreatedAt: string | null; savedAt: string | null; publishedAt: string | null
}) {
  const { user } = useAuth()
  const shares = useQuery({
    queryKey: ['coach', user?.id, 'game-share-log', game.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('game_shares').select('id, shared_at, changed').eq('event_id', game.id).order('shared_at')
      if (error) throw error
      return data ?? []
    },
  })
  if (shares.error) return <LoadError what="this game’s history" onRetry={() => void shares.refetch()} />
  if (shares.isPending) return <p role="status" className="text-[13px] text-ink-3">Loading the history…</p>
  const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
  const events = [
    game.created_at ? [{ id: 'created', at: game.created_at, title: 'Match created' }] : [],
    planCreatedAt ? [{ id: 'plan', at: planCreatedAt, title: 'Plan drafted' }] : [],
    shares.data.map((share, i) => ({ id: `share-${share.id}`, at: share.shared_at,
      title: i === 0 ? `Plan shared with ${players(share.changed)}` : `Changes shared with ${players(share.changed)}` })),
    [{ id: 'locked', at: game.starts_at, title: 'Locked at kick-off' }],
    savedAt ? [{ id: 'draft', at: savedAt, title: 'Evaluation draft saved' }] : [],
    publishedAt ? [{ id: 'published', at: publishedAt, title: 'Evaluation published. The loop is closed.', tone: 'success' as const }] : [],
  ].flat()
  return <Timeline events={events} now={Date.now()} label="History" headingLevel={3} locale="en-GB"
    timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />
}
