import { useQuery } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { fetchAwaitingConsent, fetchParentDevelopment, fetchParentMatches } from '@/lib/parent-data'

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
