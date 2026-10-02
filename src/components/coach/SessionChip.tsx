import type { ReactNode } from 'react'

/** A pill choice on the session screens (add and edit). */
export function SessionChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
      style={{
        background: active ? 'rgba(200,242,90,0.12)' : '#202024',
        color: active ? '#C8F25A' : 'rgba(255,255,255,0.45)',
        border: `1px solid ${active ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.07)'}`,
        fontFamily: "'DM Sans', sans-serif",
      }}>
      {children}
    </button>
  )
}
