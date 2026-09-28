import { useQuery } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { fetchAwaitingConsent, fetchParentDevelopment, fetchParentMatches } from '@/lib/parent-data'
import { fetchRosterAwaitingConsent } from '@/lib/parent-consent'

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
