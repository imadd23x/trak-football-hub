import { useTranslation } from '@/lib/i18n'
import { partName, partNote } from '@/lib/training/words'
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { PART_TYPES, type PartType } from '@/lib/training/shelf'
import {
  PART_NAME_MAX, drillKey, fromLibrary, hasOwnDrills, isSameDrill, libraryFor, libraryOf, tagFor, type Part, type PlanDrill, type Usage,
} from '@/lib/training/parts'
import { KIND_ORDER, LIBRARY, START_LEVEL, alsoCalled, changedBy, fit, kindInfo, nextLevel, searchDrills, step, type Changed, type LibraryDrill } from '@/lib/training/library'
import { DrillPitch, PitchKey } from './library/DrillPitch'
import { AboutDrill, CHIP, ChangeNote, DetailList } from './library/DrillInfo'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { SearchField } from '@/components/arc/search-field/search-field'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'

/* TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): the planner's pop-ups. Add a part (Trak's eight, or
   the coach's own name). TRAK-404 took Leave out: drafts save themselves. TRAK-392 (Drill Library 7/11): See more drills lists the part's Library drills by
   drill type, with search; View drill shows one with its picture and Easier / Harder, then Use this drill. Write your
   own and the My drills filter left with coach-made drills (Kostas, 8 Nov). */

/** Add a part: it goes at the end; the planner then opens it. */
export function AddPartSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (type: PartType, name: string) => void }) {
  const [picked, setPicked] = useState<PartType | null>(null)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const { t } = useTranslation()
  useEffect(() => { if (open) { setPicked(null); setName(''); setProblem(null) } }, [open])
  const add = () => {
    const own = name.trim()
    if (own) return onAdd('own', own.slice(0, PART_NAME_MAX))
    if (!picked) return setProblem(t('coachTraining:pickPartOrName'))
    onAdd(picked, PART_TYPES.find(p => p.key === picked)!.name)
  }
  return <BottomSheet className="arc" open={open} onOpenChange={next => { if (!next) onClose() }} detents={[0.92]} title={t('coachTraining:addAPart')}
    description={t('coachTraining:addPartDesc')}>
    <div className="grid gap-5 pb-4">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t('coachTraining:pickAPart')}</legend>
        <div className="grid grid-cols-1 gap-2 tablet:grid-cols-2">
          {PART_TYPES.map(type => <button key={type.key} type="button" aria-pressed={picked === type.key}
            onClick={() => { setPicked(type.key); setName(''); setProblem(null) }}
            className={`grid gap-0.5 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${picked === type.key ? 'border-brand bg-brand/10' : 'border-line bg-surface'}`}>
            <span className="text-[15px] font-medium text-ink">{partName(type.name)}</span>
            <span className="text-sm text-ink-3">{partNote(type.key)}</span>
          </button>)}
        </div>
      </fieldset>
      <Input label={t('coachTraining:orNameOwn')} description={t('coachTraining:orNameOwnEx')} value={name}
        maxLength={PART_NAME_MAX} autoComplete="off" onChange={e => { setName(e.target.value); if (e.target.value.trim()) setPicked(null); setProblem(null) }} />
      {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('coachSchedule:cancel')}</Button>
        <Button onClick={add}>{t('coachTraining:addPart')}</Button>
      </div>
    </div>
  </BottomSheet>
}

type Filter = 'all' | 'used'

/** Find another drill (TRAK-404, Kostas 10 Nov: a fourth choice, from the whole Drill Library). The part's own drills
 *  first, grouped by drill type (team drills first, then Individual and Goalkeeping), then the rest of the Library by
 *  kind; the search covers it all. */
export function MoreDrillsSheet({ part, players, usage, bookmarks, onClose, onPick }: {
  part: Part | null; players: number; usage: Usage; bookmarks: readonly string[]; onClose: () => void; onPick: (drill: PlanDrill) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const { t } = useTranslation()
  useEffect(() => { if (part) { setQuery(''); setFilter('all') } }, [part?.key]) // eslint-disable-line react-hooks/exhaustive-deps -- a new part starts afresh
  const own = useMemo(() => part ? libraryFor(part.type) : [], [part])
  const rest = useMemo(() => part && hasOwnDrills(part.type) ? LIBRARY.filter(d => !own.includes(d)) : [], [part, own])
  const pool = useMemo(() => [...own, ...rest], [own, rest])
  const all = useMemo(() => pool.map(d => fromLibrary(d, players, START_LEVEL)), [pool, players])
  if (!part) return null
  const byId = new Map(all.map(d => [d.trak_drill, d]))
  const found = query.trim() ? searchDrills(query, { players, level: START_LEVEL }, () => true, pool) : pool
  const shown = found.filter(d => filter === 'all' || usage.byDrill.has(drillKey(byId.get(d.id)!) ?? ''))
  const groupOf = (d: LibraryDrill) => d.focus === 'individual' ? 'Individual' : d.focus === 'goalkeeping' ? 'Goalkeeping'
    : d.kind === 'warmup' ? kindInfo(d.kind).name : d.type
  // Searching, the best match first, in one list; otherwise by drill type, in the Library's order.
  const mine = shown.filter(d => own.includes(d)), others = shown.filter(d => !own.includes(d))
  const groups = query.trim() ? [{ name: t('coachTraining:drillsFound'), drills: shown }]
    : [...[...new Set(mine.filter(d => d.focus === 'team').map(groupOf)), 'Individual', 'Goalkeeping']
        .map(name => ({ name, drills: mine.filter(d => groupOf(d) === name) })),
      // The rest of the Library, by kind.
      ...KIND_ORDER.map(kind => ({ name: kind === 'warmup' ? kindInfo(kind).name : (kindInfo(kind) as { long: string }).long, drills: others.filter(d => d.kind === kind), rest: true }))]
      .filter(g => g.drills.length)
  const firstRest = groups.findIndex(g => 'rest' in g)
  return <BottomSheet className="arc" open onOpenChange={next => { if (!next) onClose() }} detents={[0.92]}
    title={t('coachTraining:findFor', { part: partName(part.name) })}>
    <div className="grid gap-4 pb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><SearchField label={t('coachTraining:searchDrills')} placeholder={t('coachTraining:searchDrillsEx')} value={query} onValueChange={setQuery} /></div>
        <SegmentedControl label={t('coachTraining:show')} value={filter} onValueChange={value => setFilter(value as Filter)}
          options={[{ value: 'all', label: t('coachTraining:filterAll') }, { value: 'used', label: t('coachTraining:youveUsed') }]} />
      </div>
      {groups.length === 0 ? <p className="text-[15px] text-ink-2">{filter === 'used' && !query.trim()
        ? t('coachTraining:noneUsed') : t('coachTraining:noDrillsMatch')}</p>
        : groups.map((group, i) => <section key={group.name} aria-label={group.name} className="grid gap-2">
          {i === firstRest && i > 0 && <p className="border-t border-line pt-3 text-sm font-medium text-ink-2">{t('coachTraining:restOfLibrary')}</p>}
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{group.name}</h3>
          <ul aria-label={group.name} className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
            {group.drills.map(lib => {
              const d = byId.get(lib.id)!
              const picked = isSameDrill(d, part.drill)
              const tag = tagFor(d, part.type, all, usage, bookmarks)
              return <li key={lib.id} className="flex items-center justify-between gap-3 py-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="text-[15px] font-medium text-ink break-words">{lib.name}</p>
                  <p className="text-[13px] text-ink-3">{[d.numbers, d.area].filter(Boolean).join(' · ')}</p>
                  {tag && <p className="text-[13px] text-brand">{tag}</p>}
                </div>
                {picked ? <Badge tone="success"><Check aria-hidden size={14} />{t('coachTraining:picked')}</Badge>
                  : <Button size="sm" variant="secondary" aria-label={t('coachTraining:pickNamed', { name: lib.name })} onClick={() => onPick(d)}>{t('coachTraining:pick')}</Button>}
              </li>
            })}
          </ul>
        </section>)}
      <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>{t('coachSchedule:close')}</Button></div>
    </div>
  </BottomSheet>
}

/** View drill: a Library drill fitted to the squad, with its picture, Easier / Harder (and what changed), the five
 *  details, why, how and what to watch for. Use this drill picks it at the level set here; the picked drill opens at
 *  its own level, and Done keeps a change. */
export function ViewDrillSheet({ drill, part, players, onClose, onUse }: {
  drill: LibraryDrill | null; part: Part | null; players: number; onClose: () => void; onUse: (drill: PlanDrill) => void
}) {
  const picked = !!drill && libraryOf(part?.drill)?.id === drill.id
  const start = picked ? part?.drill?.trak_level ?? START_LEVEL : START_LEVEL
  const [level, setLevel] = useState(start)
  const [changed, setChanged] = useState<Changed | null>(null)
  const { t } = useTranslation()
  useEffect(() => { setLevel(start); setChanged(null) }, [drill?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- each drill opens afresh
  if (!drill || !part) return null
  const fitted = fit(drill, players, level)
  const press = (by: -1 | 1) => {
    const next = step(drill, players, level, by)
    if (next) { setLevel(next.level); setChanged(changedBy(by, next.changes)) }
  }
  const also = alsoCalled(drill)
  const use = () => onUse(fromLibrary(drill, players, level))
  // Kostas, 10 Nov: wider than the other pop-ups, so the picture and the words beside it have room.
  return <BottomSheet className="arc" wide open onOpenChange={next => { if (!next) onClose() }} detents={[0.96]} title={drill.name}
    description={also.length ? t('coachTraining:alsoCalled', { names: also.join(', ') }) : undefined}>
    <div className="grid gap-4 pb-4">
      <p className="flex flex-wrap gap-1.5">
        <span className={CHIP}>{kindInfo(drill.kind).name}</span>
        {drill.kind !== 'warmup' && <span className={CHIP}>{drill.type}</span>}
      </p>
      <div className="grid items-start gap-4 laptop:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
        <div className="grid gap-3">
          <DrillPitch drill={drill} players={players} level={level} />
          <PitchKey legend={fitted.legend} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={nextLevel(drill, players, level, -1) === null} onClick={() => press(-1)}><ArrowDown aria-hidden size={16} />{t('coachTraining:easier')}</Button>
            <Button variant="secondary" disabled={nextLevel(drill, players, level, 1) === null} onClick={() => press(1)}><ArrowUp aria-hidden size={16} />{t('coachTraining:harder')}</Button>
          </div>
          <ChangeNote changed={changed} idle={t('coachTraining:setForPlayers', { players })} />
        </div>
        <div className="grid gap-4"><AboutDrill drill={drill} /></div>
      </div>
      <DetailList details={fitted.details} changed={changed} />
      <div className="flex flex-wrap justify-end gap-2">
        {picked ? <Button onClick={use}><Check aria-hidden size={16} />{t('coachTraining:done')}</Button> : <>
          <Button variant="secondary" onClick={onClose}>{t('coachSchedule:close')}</Button>
          <Button onClick={use}>{t('coachTraining:useThisDrill')}</Button>
        </>}
      </div>
    </div>
  </BottomSheet>
}
