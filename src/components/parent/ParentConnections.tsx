import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { MetadataLabel } from '@/components/trak'
import { ParentFamilyContent } from './ParentFamily'

/* The parent's linked children, on the Profile tab in the same card as the
   player's Connections (TRAK-73, use-case test 25 Sep; the player's moved in
   TRAK-71). One row per child: a green dot and the word "Linked", so the
   state never rests on colour alone. */
export function ParentConnections() {
  const { children } = useParentChildren()
  return (
    <section className="rounded-[18px] px-4 pt-4 pb-1 border border-white/[0.07] bg-[#101012]">
      <MetadataLabel text="CONNECTIONS" />
      <ParentFamilyContent>
        <ul aria-label="Linked children">
          {children.map(child => <li key={child.id} className="py-3 flex items-center gap-2 border-b border-white/[0.05] last:border-b-0">
            <span aria-hidden="true" className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#C8F25A' }} />
            <div className="min-w-0">
              <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>Linked</div>
              <div className="truncate text-[13px] text-white/88">{child.name}</div>
            </div>
          </li>)}
        </ul>
      </ParentFamilyContent>
    </section>
  )
}
