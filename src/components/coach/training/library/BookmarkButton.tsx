import { Bookmark } from 'lucide-react'
import { toast } from 'sonner'
import type { LibraryDrill } from '@/lib/training/library'
import { useBookmarks, useToggleBookmark } from '../useTraining'

/* TRAK-390 (Drill Library 5/11): the bookmark (Kostas, 8 Nov: a bookmark means My drills; + means Add to training). In
   a card's corner it fills in once the drill is in My drills; on the drill page it's a button that reads Add to My
   drills / In My drills. Tap again to take it out. */

function useBookmark(drill: LibraryDrill) {
  const bookmarks = useBookmarks()
  const toggle = useToggleBookmark()
  const on = !!bookmarks.data?.includes(drill.id)
  const flip = () => {
    const next = !on
    toggle.mutate({ drill: drill.id, on: next }, {
      onSuccess: () => toast(next ? 'Added to My drills' : 'Removed from My drills'),
      onError: () => toast.error('Couldn’t save. Check your connection and try again.'),
    })
  }
  return { on, flip, ready: bookmarks.isSuccess }
}

/** The bookmark in a card's corner. */
export function CardBookmark({ drill }: { drill: LibraryDrill }) {
  const { on, flip, ready } = useBookmark(drill)
  if (!ready) return null
  return (
    <button type="button" aria-pressed={on} aria-label={`${on ? 'In My drills' : 'Add to My drills'}: ${drill.name}`} onClick={flip}
      className="absolute right-1.5 top-1.5 inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-line bg-surface text-brand hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary tablet:right-2 tablet:top-2">
      <Bookmark aria-hidden size={19} strokeWidth={2} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

/** Add to My drills / In My drills, on the drill page. */
export function PageBookmark({ drill }: { drill: LibraryDrill }) {
  const { on, flip, ready } = useBookmark(drill)
  return (
    <button type="button" aria-pressed={on} disabled={!ready} onClick={flip}
      className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${on ? 'border-brand/30 bg-brand/10 text-brand' : 'border-line-strong bg-surface text-ink hover:bg-raised'}`}>
      <Bookmark aria-hidden size={18} strokeWidth={2} fill={on ? 'currentColor' : 'none'} />
      {on ? 'In My drills' : 'Add to My drills'}
    </button>
  )
}
