import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { Textarea } from '@/components/arc/textarea/textarea'
import { MAX_SEASON_OBJECTIVES, OBJECTIVE_LINE_MAX, OBJECTIVE_TITLE_MAX, SEASON_OBJECTIVE_PRESETS } from '@/lib/season-plan'

/* TRAK-350's season objectives card, which TRAK-356's Edit after sharing shares: up to three, each a title and what it
   looks like, from the mockup's six or the coach's own. Before the first share an objective is deleted; after it, it
   is removed, and kept in its history. */

export type EditableObjective = { key: string; id?: string; title: string; looksLike: string }

export function SeasonObjectivesEditor({ objectives, focusKey, removeWord, onChange, onAdd }: {
  objectives: EditableObjective[]
  /** The one just added to write, which takes the focus. */
  focusKey: string | null
  removeWord: 'Delete' | 'Remove'
  onChange: (next: EditableObjective[]) => void
  onAdd: (title: string, looksLike: string) => void
}) {
  const full = objectives.length >= MAX_SEASON_OBJECTIVES
  const chosen = new Set(objectives.map(o => o.title.trim()))
  const set = (key: string, patch: Partial<EditableObjective>) => onChange(objectives.map(o => (o.key === key ? { ...o, ...patch } : o)))

  return (
    <section aria-labelledby="season-objectives" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="season-objectives" className="text-lg font-medium text-ink">Season objectives</h2>
        <span className="text-sm text-ink-3">{objectives.length} of {MAX_SEASON_OBJECTIVES}</span>
      </div>
      {objectives.length === 0 && <p className="text-sm text-ink-3">None yet. Pick from the list or write your own.</p>}
      <ol className="grid gap-4">
        {objectives.map((o, index) => (
          <li key={o.key} className="grid gap-2 rounded-xl border border-line p-3">
            <Input label={`Objective ${index + 1}`} value={o.title} maxLength={OBJECTIVE_TITLE_MAX} autoFocus={o.key === focusKey}
              placeholder="For example: Win the second ball" onChange={event => set(o.key, { title: event.target.value })} />
            <Textarea label="What it looks like" value={o.looksLike} maxLength={OBJECTIVE_LINE_MAX} rows={2}
              onChange={event => set(o.key, { looksLike: event.target.value })} />
            <span className="justify-self-end">
              <Button variant="ghost" size="sm" aria-label={`${removeWord} ${o.title.trim() || `objective ${index + 1}`}`}
                onClick={() => onChange(objectives.filter(other => other.key !== o.key))}>
                <Trash2 size={16} aria-hidden="true" />{removeWord}
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <div className="grid gap-2">
        <h3 className="text-sm font-medium text-ink-2">Add one</h3>
        {full && <p className="text-sm text-ink-3">Up to three. {removeWord} one to add another.</p>}
        <div className="flex flex-wrap gap-2">
          {SEASON_OBJECTIVE_PRESETS.filter(preset => !chosen.has(preset.title)).map(preset => (
            <Button key={preset.title} variant="secondary" size="sm" disabled={full} title={preset.looksLike}
              onClick={() => onAdd(preset.title, preset.looksLike)}>
              <Plus size={16} aria-hidden="true" />{preset.title}
            </Button>
          ))}
          <Button variant="secondary" size="sm" disabled={full} onClick={() => onAdd('', '')}>
            <Plus size={16} aria-hidden="true" />Write your own
          </Button>
        </div>
      </div>
    </section>
  )
}
