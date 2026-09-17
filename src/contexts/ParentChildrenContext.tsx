import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { fetchParentChildren, type ParentChild } from '@/lib/parent-data'

interface ParentChildrenState {
  parentId: string | null
  children: ParentChild[]
  selectedChild: ParentChild | null
  selectChild: (childId: string) => void
  loading: boolean
  error: boolean
  retry: () => void
}

const ParentChildrenContext = createContext<ParentChildrenState | null>(null)

export function ParentChildrenProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const location = useLocation()
  const parentId = profile?.role === 'parent' ? user?.id ?? null : null
  const [selection, setSelection] = useState<{ parentId: string; childId: string } | null>(null)
  const query = useQuery({
    queryKey: ['parent', parentId, 'children'],
    queryFn: ({ signal }) => fetchParentChildren(parentId!, signal),
    enabled: !!parentId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    networkMode: 'always',
  })
  const { refetch } = query
  // An existing parent can accept another invite without a full page reload.
  // Refresh membership on navigation so that new or removed links are reconciled.
  useEffect(() => { if (parentId) void refetch() }, [parentId, location.key, refetch])
  useEffect(() => { setSelection(null) }, [parentId])
  // Never expose a previous parent's data, or cached links after a failed refresh.
  const linkedChildren = parentId && !query.isError ? query.data ?? [] : []
  const selectedChild = linkedChildren.find(child =>
    selection?.parentId === parentId && child.id === selection.childId,
  ) ?? linkedChildren[0] ?? null

  return (
    <ParentChildrenContext.Provider value={{
      parentId,
      children: linkedChildren,
      selectedChild,
      selectChild: childId => {
        if (parentId && linkedChildren.some(child => child.id === childId)) setSelection({ parentId, childId })
      },
      loading: !!parentId && query.isPending,
      error: !!parentId && query.isError,
      retry: () => { void query.refetch() },
    }}>
      {children}
    </ParentChildrenContext.Provider>
  )
}

export function useParentChildren(): ParentChildrenState {
  const context = useContext(ParentChildrenContext)
  if (!context) throw new Error('Parent pages must be inside ParentChildrenProvider')
  return context
}
