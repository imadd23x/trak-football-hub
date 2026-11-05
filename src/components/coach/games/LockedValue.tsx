/** TRAK-287: a choice as it stood at kick-off, in words where its picker was, so a locked plan stays easy to read. */
export function LockedValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="whitespace-pre-line text-sm text-ink-2">{value}</p>
    </div>
  )
}
