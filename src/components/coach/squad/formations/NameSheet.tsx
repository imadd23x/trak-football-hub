import { useState, type FormEvent } from 'react'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import { Select } from '@/components/arc/select/select'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, type Format } from '@/lib/games/formations'

/* TRAK-357: New formation (a name, a format and a shape; it starts from the players on the pitch now) and Rename
   (the name alone), one small sheet each, Cancel or the one action. A name is one line of up to 32 characters. */

export type NameSheetMode = { kind: 'new'; format: Format; shape: string } | { kind: 'rename'; name: string }
export type Named = { name: string; format: Format; shape: string }

const NAME_MAX = 32
const FORMAT_OPTIONS = FORMATS.map(format => ({ value: String(format), label: `${format} a side` }))

export function NameSheet({ mode, problem, saving, onClose, onDone }: {
  mode: NameSheetMode
  problem: string | null
  saving: boolean
  onClose: () => void
  onDone: (named: Named) => void
}) {
  const [name, setName] = useState(mode.kind === 'rename' ? mode.name : '')
  const [format, setFormat] = useState<Format>(mode.kind === 'new' ? mode.format : 11)
  const [shape, setShape] = useState(mode.kind === 'new' ? mode.shape : '')
  const [empty, setEmpty] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim().replace(/\s+/g, ' ')
    if (!trimmed) { setEmpty(true); return }
    onDone({ name: trimmed, format, shape })
  }
  const error = empty ? 'Give the formation a name.' : problem
  return <BottomSheet className="arc" open onOpenChange={open => { if (!open) onClose() }} title={mode.kind === 'new' ? 'New formation' : 'Rename formation'}
    description={mode.kind === 'new' ? 'It starts from the players on the pitch now. Make it your own, then save.' : undefined}>
    <form onSubmit={submit} className="grid gap-4 pb-4">
      <label className="grid gap-2">
        <span className="text-sm font-medium text-ink">Formation name</span>
        <input value={name} maxLength={NAME_MAX} placeholder="For example: Park the bus" onChange={e => { setName(e.target.value); setEmpty(false) }}
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'formation-name-error' : undefined}
          className="min-h-11 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      </label>
      {error && <p id="formation-name-error" role="alert" className="text-sm text-danger">{error}</p>}
      {mode.kind === 'new' && <div className="grid grid-cols-2 gap-3">
        <Select label="Format" options={FORMAT_OPTIONS} value={String(format)}
          onValueChange={value => { const next = Number(value) as Format; setFormat(next); setShape(DEFAULT_FORMATION[next]) }} />
        <Select label="Shape" options={FORMATIONS[format].map(s => ({ value: s, label: s }))} value={shape} onValueChange={setShape} />
      </div>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={saving}>{mode.kind === 'new' ? 'Create formation' : 'Rename'}</Button>
      </div>
    </form>
  </BottomSheet>
}
