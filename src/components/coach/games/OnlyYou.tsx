import { LockIcon } from '@/components/icons/LockIcon'
import { Tooltip } from '@/components/arc/tooltip/tooltip'

/** Imad's lock at a card's top right (TRAK-328): "Only you can see this" on hover, focus or a tap. `what` names it for
 *  screen readers. On Tactics & analysis, and the evaluation's How they scored (TRAK-374). */
export function OnlyYou({ what }: { what: string }) {
  return <Tooltip content="Only you can see this" openOnTap>
    <button type="button" aria-label={`Who sees ${what}`}
      className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <LockIcon size={20} />
    </button>
  </Tooltip>
}
