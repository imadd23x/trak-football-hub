import { currentLanguage, useTranslation } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { EventRow } from '@/lib/coach-events'
import { LoadError } from '@/components/trak'
import { Timeline } from '@/components/arc/timeline/timeline'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-289 (Games 7/8): the game's History (TRAK-282), the visible start and end of its loop: created, plan drafted,
   shared and each change shared to N, locked at kick-off, evaluation draft saved, published. Newest first, grouped by
   day on this phone's clock (Imad, 23 Oct). Every step is read from what the loop already keeps. */

export function GameHistory({ game, planCreatedAt, savedAt, publishedAt }: {
  game: EventRow & { created_at?: string | null }
  planCreatedAt: string | null; savedAt: string | null; publishedAt: string | null
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const shares = useQuery({
    queryKey: ['coach', user?.id, 'game-share-log', game.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('game_shares').select('id, shared_at, changed').eq('event_id', game.id).order('shared_at')
      if (error) throw error
      return data ?? []
    },
  })
  if (shares.error) return <LoadError what={t('coachMatches:historyWhat')} onRetry={() => void shares.refetch()} />
  if (shares.isPending) return <LoadingSkeleton label={t('coachMatches:loadingHistory')} lines={2} rows={2} />
  const events = [
    game.created_at ? [{ id: 'created', at: game.created_at, title: t('coachMatches:histCreated') }] : [],
    planCreatedAt ? [{ id: 'plan', at: planCreatedAt, title: t('coachMatches:histPlanDrafted') }] : [],
    shares.data.map((share, i) => ({ id: `share-${share.id}`, at: share.shared_at,
      title: t(i === 0 ? 'coachMatches:histPlanShared' : 'coachMatches:histChangesShared', { count: share.changed }) })),
    [{ id: 'locked', at: game.starts_at, title: t('coachMatches:stateLocked') }],
    savedAt ? [{ id: 'draft', at: savedAt, title: t('coachMatches:histDraftSaved') }] : [],
    publishedAt ? [{ id: 'published', at: publishedAt, title: t('coachMatches:histPublished'), tone: 'success' as const }] : [],
  ].flat()
  return <Timeline events={events} now={Date.now()} label={t('coachMatches:history')} headingLevel={3} locale={currentLanguage() === 'en' ? 'en-GB' : currentLanguage()}
    timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />
}
