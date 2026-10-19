import { useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import {
  fetchAwaitingConsent, fetchParentDevelopment, fetchParentMatchActivity, fetchParentMatchDetail,
  fetchParentMatchPage, fetchParentMatchSummary, fetchParentRecentMatches, type ParentMatchCursor,
} from '@/lib/parent-data'

export function useParentMatchSummary() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'match-summary'],
    queryFn: ({ signal }) => fetchParentMatchSummary(childId!, signal),
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
}

export function useParentRecentMatches() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'recent-matches'],
    queryFn: ({ signal }) => fetchParentRecentMatches(childId!, signal),
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
}

export function useParentMatchActivity() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'match-activity'],
    queryFn: ({ signal }) => fetchParentMatchActivity(childId!, signal),
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
}

export function useParentMatchHistory() {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  // A fresh token also distinguishes A -> B -> A from the original A request.
  const identity = useMemo(() => ({ parentId, childId }), [parentId, childId])
  const activeIdentity = useRef(identity)
  activeIdentity.current = identity
  const [navigation, setNavigation] = useState<{ identity: typeof identity; page: number } | null>(null)
  const pending = useRef<object | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['parent', parentId, childId, 'match-history'],
    queryFn: ({ pageParam, signal }) => fetchParentMatchPage(childId!, pageParam, signal),
    initialPageParam: null as ParentMatchCursor | null,
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!parentId && !!childId,
    networkMode: 'always',
  })
  const pages = query.data?.pages ?? []
  const pageIndex = Math.min(navigation?.identity === identity ? navigation.page : 0, Math.max(0, pages.length - 1))
  const page = pages[pageIndex]
  const hasNext = pageIndex < pages.length - 1 || !!query.hasNextPage
  const nextPageError = query.isFetchNextPageError && pageIndex === pages.length - 1

  async function nextPage() {
    if (!parentId || !childId || !hasNext || query.isFetching) return
    if (pageIndex < pages.length - 1) {
      setNavigation({ identity, page: pageIndex + 1 })
      return
    }
    if (pending.current === identity) return
    pending.current = identity
    try {
      const result = await query.fetchNextPage({ cancelRefetch: false })
      if (activeIdentity.current === identity && !result.isError && result.data && result.data.pages.length > pageIndex + 1) {
        setNavigation({ identity, page: pageIndex + 1 })
      }
    } finally {
      if (pending.current === identity) pending.current = null
    }
  }

  return {
    matches: page?.matches ?? [],
    pageNumber: pageIndex + 1,
    hasPrevious: pageIndex > 0,
    hasNext,
    isPending: query.isPending,
    // Only a failed next-page request may retain the already-visible page.
    isError: query.isError && !query.isFetchNextPageError,
    isLoadingPage: query.isFetchingNextPage,
    isFetching: query.isFetching,
    nextPageError,
    nextPage,
    previousPage: () => { if (pageIndex > 0) setNavigation({ identity, page: pageIndex - 1 }) },
    retry: () => { void query.refetch() },
  }
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


export function useParentMatchDetail(matchId: string) {
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  return useQuery({
    queryKey: ['parent', parentId, childId, 'match-detail', matchId],
    queryFn: ({ signal }) => fetchParentMatchDetail(childId!, matchId, signal),
    enabled: !!parentId && !!childId && !!matchId,
    // Each opening checks access again. Closing cancels and discards its data.
    staleTime: 0,
    gcTime: 0,
    networkMode: 'always',
  })
}
