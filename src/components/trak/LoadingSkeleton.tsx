import { Skeleton } from '@/components/arc/skeleton/skeleton'

/** TRAK-335 (Imad, 2 Nov): while something loads, Arc's skeleton shaped like what's coming (lines, an avatar where a
 *  person goes), in place of a "Loading…" line. Screen readers hear `label` ("Loading the match…"); a list repeats the
 *  shape `rows` times and is still heard once. */
export function LoadingSkeleton({ label, lines = 3, avatar = false, rows = 1, className }: {
  label: string; lines?: number; avatar?: boolean; rows?: number; className?: string
}) {
  return (
    <div className={['arc grid gap-5', className].filter(Boolean).join(' ')}>
      <Skeleton label={label} lines={lines} avatar={avatar} />
      {rows > 1 && <div aria-hidden="true" className="grid gap-5">
        {Array.from({ length: rows - 1 }, (_, row) => <Skeleton key={row} label={label} lines={lines} avatar={avatar} />)}
      </div>}
    </div>
  )
}
