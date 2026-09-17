import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { ParentFamilyContent } from './ParentFamily'

export function ParentConnections() {
  const { children } = useParentChildren()
  return (
    <ParentFamilyContent>
      <ul aria-label="Linked children" className="divide-y divide-border">
        {children.map(child => <li key={child.id} className="py-4">
          <p className="text-xs text-muted-foreground">Child · Connected</p>
          <p className="text-sm text-foreground mt-1">{child.name}</p>
        </li>)}
      </ul>
    </ParentFamilyContent>
  )
}
