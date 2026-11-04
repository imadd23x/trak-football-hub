import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { MetadataLabel } from '@/components/trak'
import { PlayerFace } from '@/components/trak/PlayerFace'

/* The parent's linked children, on the Profile tab in the same card as the
   player's Connections (TRAK-73, use-case test 25 Sep; the player's moved in
   TRAK-71). One row per child: Arc's avatar with a green dot (TRAK-182) and the
   word "Linked", so the state never rests on colour alone. Profile renders it inside its one
   ParentFamilyContent, so loading, error and no-child states show once. */
export function ParentConnections() {
  const { children } = useParentChildren()
  return (
    <section className="rounded-[18px] px-4 pt-4 pb-1 border border-line bg-surface">
      <MetadataLabel text="CONNECTIONS" />
      <ul aria-label="Linked children">
        {children.map(child => <li key={child.id} className="py-3 flex items-center gap-3 border-b border-line last:border-b-0">
          <PlayerFace name={child.name} size="md" status="online" className="arc flex-shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>Linked</div>
            <div className="truncate text-[13px] text-ink">{child.name}</div>
          </div>
        </li>)}
      </ul>
    </section>
  )
}
