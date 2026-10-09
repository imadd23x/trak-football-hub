import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { MobileShell, NavBar } from '@/components/trak'
import { ParentFamilyContent, ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { EventDetails } from '@/components/player/EventDetails'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { fetchParentEvent } from '@/lib/parent-data'
import { markEventOpened } from '@/lib/player-events'

/**
 * One of the selected child's events (TRAK-131, J8.8): the player's event
 * details, read through child_events so only that child's consent counts.
 * Opening it clears "Changed" for this parent. Refetches on refocus, so a
 * withdrawal hides it at once (TRAK-88).
 */
export default function ParentEvent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  const query = useQuery({
    queryKey: ['parent', parentId, childId, 'event', id],
    queryFn: ({ signal }) => fetchParentEvent(childId!, id!, signal),
    enabled: !!parentId && !!childId && !!id,
    networkMode: 'always',
  })
  useEffect(() => { if (parentId && query.data) markEventOpened(parentId, query.data) }, [parentId, query.data])

  return (
    <MobileShell>
      <div className="pt-3 pb-4 space-y-5">
        <button type="button" onClick={() => navigate('/parent/matches')}
          className="flex items-center gap-1 min-h-11 text-sm text-muted-foreground">
          <ChevronLeft size={16} /> Matches
        </button>
        <ParentFamilyContent>
          {query.isError ? <ParentLoadError message="Couldn't load this event." onRetry={() => { void query.refetch() }} />
            : query.isPending ? <ParentLoading />
              : query.data ? <EventDetails event={query.data} />
                : <p className="text-sm text-muted-foreground">This event isn't available for {selectedChild?.name}.</p>}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab="/parent/matches" onNavigate={navigate} />
    </MobileShell>
  )
}
