import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/* TRAK-455 (11 Nov walk-through): a rule for the whole app. Edit is a pencil, never the word; removing a part of a
   training is a bin, not an × (an × reads as "close"). Each says its full name to a screen reader and as a tooltip
   ("Edit warm-up", "Remove warm-up"), and its tap area is 44 px. */
const BOX = 'inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50'

type Props = { label: string; className?: string; disabled?: boolean; haspopup?: boolean }

/** A pencil. `to` makes it a link (a page), else `onClick` (a sheet, a step). */
export function EditIcon({ label, to, onClick, className, disabled, haspopup }: Props & { to?: string; onClick?: () => void }) {
  const look = cn(BOX, 'text-brand hover:bg-raised', className)
  const icon = <Pencil aria-hidden size={18} strokeWidth={1.75} />
  return to
    ? <Link to={to} aria-label={label} title={label} className={look}>{icon}</Link>
    : <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-haspopup={haspopup ? 'dialog' : undefined} className={look}>{icon}</button>
}

/** A bin that removes something at once (an Undo, where there is one, puts it back). */
export function RemoveIcon({ label, onClick, className, disabled }: Props & { onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
    className={cn(BOX, 'text-ink-2 hover:bg-raised hover:text-danger', className)}>
    <Trash2 aria-hidden size={18} strokeWidth={1.75} />
  </button>
}
