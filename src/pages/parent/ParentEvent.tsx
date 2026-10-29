import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { MobileShell, NavBar } from '@/components/trak'
import { ParentFamilyContent, ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { EventDetails } from '@/components/player/EventDetails'
import { CantMakeIt } from '@/components/parent/CantMakeIt'
import { SharedGamePlan } from '@/components/player/SharedGamePlan'
import { SharedGameReview } from '@/components/player/SharedGameReview'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { fetchParentEvent } from '@/lib/parent-data'
import { changesSinceSeen, markEventOpened } from '@/lib/player-events'
import { useEventBack } from '@/lib/event-back'

/**
 * One of the selected child's events (TRAK-131, J8.8): the player's event
 * details, read through child_events so only that child's consent counts.
 * Opening it clears "Changed" for this parent. Refetches on refocus, so a
 * withdrawal hides it at once (TRAK-88).
 */
export default function ParentEvent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const backTo = useEventBack('/parent/matches')
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  const query = useQuery({
    queryKey: ['parent', parentId, childId, 'event', id],
    queryFn: ({ signal }) => fetchParentEvent(childId!, id!, signal),
    enabled: !!parentId && !!childId && !!id,
    networkMode: 'always',
  })
  // TRAK-134: what moved since this device last saw it, read before opening marks it
  // seen, and kept for this visit (a refetch on refocus reads nothing new).
  const [changes, setChanges] = useState<{ key: string; lines: string[] } | null>(null)
  useEffect(() => {
    if (!parentId || !query.data) return
    const key = `${childId}:${query.data.id}:${query.data.sequence}`
    const lines = changesSinceSeen(parentId, query.data)
    setChanges(held => held?.key === key ? held : { key, lines })
    markEventOpened(parentId, query.data)
  }, [parentId, childId, query.data])

  return (
    <MobileShell>
      <div className="pt-3 pb-4 space-y-5">
        <button type="button" onClick={backTo.go}
          className="flex items-center gap-1 min-h-11 text-sm text-muted-foreground">
          <ChevronLeft size={16} /> {backTo.label}
        </button>
        <ParentFamilyContent>
          {query.isError ? <ParentLoadError message="Couldn't load this event." onRetry={() => { void query.refetch() }} />
            : query.isPending ? <ParentLoading />
              : query.data ? <>
                <EventDetails event={query.data} changes={changes?.key === `${childId}:${query.data.id}:${query.data.sequence}` ? changes.lines : []} />
                {/* TRAK-289: once the coach publishes, After the game; the note stays the child's. */}
                {selectedChild && <SharedGameReview event={query.data} childId={selectedChild.id}
                  childName={selectedChild.name.split(/\s+/)[0] || selectedChild.name} as="parent" />}
                {/* TRAK-286: the child's job in the shared plan, and that there's a note, never the note. */}
                {selectedChild && <SharedGamePlan event={query.data} childId={selectedChild.id}
                  childName={selectedChild.name.split(/\s+/)[0] || selectedChild.name} as="parent" />}
                {selectedChild && <CantMakeIt key={selectedChild.id} event={query.data} child={selectedChild} />}
              </>
                : <p className="text-sm text-muted-foreground">This event isn't available for {selectedChild?.name}.</p>}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab="/parent/matches" onNavigate={navigate} />
    </MobileShell>
  )
}
