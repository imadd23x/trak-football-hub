import type { KeyboardEvent } from 'react'

/* Props that make a card tappable and keyboard-operable (TRAK-69). A card that
   holds bars and paragraphs becomes a role="button" container rather than a
   <button>, which may only hold phrasing content. */
export function openable(label: string, open: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: open,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
    },
  }
}
