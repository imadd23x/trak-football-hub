import { useQuery } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { fetchAwaitingConsent, fetchParentDevelopment, fetchParentEvents, fetchParentMatches } from '@/lib/parent-data'
import { fetchRosterAwaitingConsent, fetchMyChildLogins, fetchApprovedAwaitingSignup } from '@/lib/parent-consent'

export function useParentMatches() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'matches'],
    queryFn: ({ signal }) => fetchParentMatches(childId!, signal),
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
}

/** The selected child's upcoming events (J8.8). Refetches on refocus, so a withdrawal shows at once (TRAK-88). */
export function useParentEvents() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'events'],
    queryFn: ({ signal }) => fetchParentEvents(childId!, signal),
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
}

export function useParentDevelopment() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'development'],
    queryFn: ({ signal }) => fetchParentDevelopment(childId!, signal),
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
}

export function useChildrenAwaitingConsent() {
  const { parentId } = useParentChildren()
  return useQuery({
    queryKey: ['parent', parentId, 'awaiting-consent'],
    queryFn: ({ signal }) => fetchAwaitingConsent(signal),
    enabled: !!parentId,
    staleTime: 0,
    networkMode: 'always',
  })
}

/** A rostered child who has no account yet and is waiting on this guardian (TRAK-11 phase 4). */
export function useRosterChildrenAwaitingConsent() {
  const { parentId } = useParentChildren()
  return useQuery({
    queryKey: ['parent', parentId, 'roster-awaiting-consent'],
    queryFn: ({ signal }) => fetchRosterAwaitingConsent(signal),
    enabled: !!parentId,
    staleTime: 0,
    networkMode: 'always',
  })
}

export function useChildLogins() {
  const {parentId}=useParentChildren()
  return useQuery({queryKey:['parent',parentId,'child-logins'],queryFn:({signal})=>fetchMyChildLogins(signal),
    enabled:!!parentId,staleTime:0,networkMode:'always'})
}

/** TRAK-98: children this guardian approved who haven't signed up yet. */
export function useApprovedAwaitingSignup() {
  const { parentId } = useParentChildren()
  return useQuery({
    queryKey: ['parent', parentId, 'approved-awaiting'],
    queryFn: ({ signal }) => fetchApprovedAwaitingSignup(signal),
    enabled: !!parentId,
    staleTime: 0,
    // TRAK-121: the child signs up on another device. Re-read on return to the
    // tab, as the family list does, or Home says "waiting" beside a linked child.
    refetchOnWindowFocus: true,
    networkMode: 'always',
  })
}
