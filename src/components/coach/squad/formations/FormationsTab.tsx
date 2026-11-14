import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, LayoutGrid, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { MorphSelect } from '@/components/arc/morph-select/morph-select'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { usePlayerRoles } from '@/components/coach/squad/usePlayerRoles'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, type Format } from '@/lib/games/formations'
import { shapeItems } from '@/lib/games/shape-items'
import { isPosition } from '@/lib/positions'
import { FORMATION_SEEDS, firstXI, reshapeXI, swapXI, type Spot } from '@/lib/squad/formation-board'
import type { SquadRoster } from '../useSquadRoster'
import { FormationBoard, type BoardPlayer } from './FormationBoard'
import { NameSheet, type NameSheetMode } from './NameSheet'
import { UseForMatchesSheet } from './UseForMatchesSheet'
import { weekdayDayMonth } from '@/lib/squad/format'
import { i18n, useTranslation } from '@/lib/i18n'
import { refusal, useFormationWrites, useFormations, type Formation, type FormationDraft } from './useFormations'

/* TRAK-357 (Season plan 9/18, spec TRAK-348; Tarek's My Formations mockup, without its Instructions tab): Squad ›
   Formations, the coach's whiteboard of saved line-ups for one squad. Saved formations sit above the editor: a format
   and a shape (Matches' lists), the pitch beside the bench, Undo, Discard changes and Save. Edits stay a draft until
   Save. New, Rename and Delete (it asks first). It opens once every consented player in the squad has a position;
   until then it says how many to place. A squad starts with the mockup's three, saved for it once (Tarek, 5 Nov). The
   formation in view is in the address (?formation=).
   TRAK-360: Use for matches copies the saved formation into upcoming matches; Make default loads it into a fresh match of
   its format; Set for matchday lists the matches it was copied to. */

const saveFailed = () => i18n.t('coachSquad:fmSaveFailed')
/** TRAK-407: read when shown, so the labels follow the language. */
const formatOptions = () => FORMATS.map(format => ({ value: String(format), label: i18n.t('coachSquad:fmASide', { count: format }) }))
const same = (a: FormationDraft, b: FormationDraft) => JSON.stringify([a.name, a.format, a.shape, a.starters]) === JSON.stringify([b.name, b.format, b.shape, b.starters])
const draftOf = ({ name, format, shape, starters }: Formation): FormationDraft => ({ name, format, shape, starters })
type Edit = { draft: FormationDraft; history: FormationDraft[] }

export function FormationsTab({ roster }: { roster: SquadRoster }) {
  const { user } = useAuth()
  const { t } = useTranslation()
  // The squad picked, or a coach's only squad.
  const squad = roster.squad ?? (roster.squads.length === 1 ? roster.squads[0] : null)
  // TRAK-432: Arc's empty state; the squad is chosen in the menu, so there is no button here.
  if (!squad || !user) return <div className="arc pt-10">
    <EmptyState icon={<LayoutGrid size={24} strokeWidth={1.5} />} title={t('coachSquad:fmPickSquad')} description={t('coachSquad:fmPickSquadBody')} />
  </div>
  // Keyed by squad, so one squad's edits never show in another's.
  return <Playbook key={squad} coachId={user.id} squad={squad} roster={roster} />
}

function Playbook({ coachId, squad, roster }: { coachId: string; squad: string; roster: SquadRoster }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const formations = useFormations(coachId, squad)
  const roles = usePlayerRoles(coachId)
  const writes = useFormationWrites(coachId, squad)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [naming, setNaming] = useState<NameSheetMode | null>(null)
  const [namingProblem, setNamingProblem] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [using, setUsing] = useState(false)
  // TRAK-453: the last copy into matches, shown on the page with an Undo until the coach closes it (no timer).
  const [copied, setCopied] = useState<{ id: string; name: string; eventIds: string[] } | null>(null)
  const [useProblem, setUseProblem] = useState<string | null>(null)
  const started = useRef(false)

  // Everyone consented in the squad, in shirt order, as the board shows them.
  const squadPlayers = useMemo(() => roster.players.filter(p => p.age_group?.trim() === squad)
    .sort((a, b) => (a.shirt_number ?? 999) - (b.shirt_number ?? 999) || a.player_name.localeCompare(b.player_name)), [roster.players, squad])
  const consented = useMemo(() => squadPlayers.filter(p => !roster.consentPending.has(p.id)), [squadPlayers, roster.consentPending])
  const unplaced = consented.filter(p => !isPosition(p.position)).length
  const boardPlayers = useMemo(() => {
    const byId = new Map<string, BoardPlayer>()
    for (const p of squadPlayers) byId.set(p.id, {
      id: p.id, name: p.player_name, shirt: p.shirt_number, position: p.position, also: roles.of(p.id).also, canPlay: !roster.consentPending.has(p.id),
    })
    return byId
  }, [squadPlayers, roster.consentPending, roles])

  // Leaving or reloading with edits not saved asks first.
  const unsaved = Object.keys(edits).length > 0
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  // The squad's first three, saved once, with starters picked by position. A squad that has had them (and deleted
  // them) gets none again: the database says so, and the list stays empty.
  const list = formations.data
  useEffect(() => {
    if (!list || list.length > 0 || unplaced > 0 || roles.isPending || started.current) return
    started.current = true
    const pickable = consented.map(p => ({ id: p.id, position: p.position }))
    writes.start.mutate(FORMATION_SEEDS.map(seed => ({ ...seed, starters: firstXI(pickable, seed.shape) })))
  }, [list, unplaced, roles.isPending, consented, writes.start])

  // Arc's styles apply inside .arc; a phone's frame doesn't give one (the laptop's does), so each view brings its own.
  if (unplaced > 0) return <section aria-labelledby="formations-locked" className="arc grid justify-items-start gap-3 rounded-2xl border border-line bg-surface p-6">
    <h2 id="formations-locked" className="text-lg font-medium text-ink">{t('coachSquad:fmPlaceToOpen', { count: unplaced })}</h2>
    <p className="max-w-prose text-sm text-ink-2">{t('coachSquad:fmNeedsPosition', { squad })}</p>
    <Button variant="secondary" onClick={() => navigate('/coach/season-plan/positions')}>{t('coachSquad:fmGoPositions')}</Button>
  </section>
  if (formations.isError || roles.isError) return <LoadError what={t('coachSquad:fmWhat')} onRetry={() => { void formations.refetch(); void roles.refetch() }} />
  if (!list || roles.isPending || writes.start.isPending) return <LoadingSkeleton label={t('coachSquad:fmLoading')} lines={3} rows={2} />

  const header = <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="grid gap-0.5">
      <h2 className="text-lg font-medium text-ink">{t('coachSquad:fmPlaybook')}</h2>
    </div>
    <Button variant="secondary" onClick={() => { setNamingProblem(null); setNaming({ kind: 'new', format: 11, shape: DEFAULT_FORMATION[11] }) }}>
      <Plus size={18} aria-hidden="true" />{t('coachSquad:fmNew')}</Button>
  </div>
  const nameSheet = naming && <NameSheet mode={naming} problem={namingProblem} saving={writes.save.isPending} onClose={() => setNaming(null)} onDone={named => {
    if (naming.kind === 'rename') return rename(named.name)
    const from = current ?? { name: named.name, format: named.format, shape: named.shape, starters: {} }
    const draft = { ...named, starters: current ? reshapeXI(from.starters, from.shape, named.shape, named.format) : {} }
    writes.save.mutate({ id: null, draft }, {
      onSuccess: id => { setNaming(null); if (id) choose(id); toast(t('coachSquad:fmCreated', { name: named.name })) },
      onError: error => setNamingProblem(refusal(error) ?? saveFailed()),
    })
  }} />

  const activeId = list.find(f => f.id === params.get('formation'))?.id ?? list[0]?.id
  const saved = list.find(f => f.id === activeId)
  const edit = saved ? edits[saved.id] : undefined
  const current = saved ? edit?.draft ?? draftOf(saved) : undefined
  function choose(id: string) { setConfirming(false); setProblem(null); setParams(p => { const next = new URLSearchParams(p); next.set('formation', id); return next }, { replace: true }) }
  function rename(name: string) {
    if (!saved) return
    writes.save.mutate({ id: saved.id, draft: { ...draftOf(saved), name } }, {
      onSuccess: () => {
        setNaming(null)
        setEdits(all => (all[saved.id] ? { ...all, [saved.id]: { ...all[saved.id], draft: { ...all[saved.id].draft, name } } } : all))
        toast(t('coachSquad:fmRenamed', { name }))
      },
      onError: error => setNamingProblem(refusal(error) ?? saveFailed()),
    })
  }

  if (!saved || !current) return <div className="arc grid gap-5">
    {header}
    <div className="grid justify-items-center gap-2 rounded-2xl border border-line bg-surface p-8 text-center">
      <p className="text-[15px] font-medium text-ink">{t('coachSquad:fmNone')}</p>
      <p className="max-w-sm text-sm text-ink-3">{t('coachSquad:fmNoneBody')}</p>
    </div>
    {nameSheet}
  </div>

  const dirty = !!edit && !same(edit.draft, draftOf(saved))
  const copyTo = (eventIds: string[]) => writes.use.mutate({ id: saved.id, eventIds }, {
    onSuccess: () => { setUsing(false); setUseProblem(null); setCopied({ id: saved.id, name: saved.name, eventIds }) },
    onError: error => setUseProblem((error as { code?: string }).code === 'P0001' ? t('coachSquad:fmLocked')
      : t('coachSquad:fmCopyFailed')),
  })
  // Undo puts each match back to what it held before the copy; the saved formation is not touched.
  const undoCopy = () => { if (copied) writes.undoCopy.mutate({ id: copied.id, eventIds: copied.eventIds }, {
    onSuccess: () => { toast(t('coachSquad:fmUndoneCopy', { name: copied.name, count: copied.eventIds.length })); setCopied(null) },
    onError: error => setProblem((error as { code?: string }).code === 'P0001' ? t('coachSquad:fmUndoCopyLocked') : t('coachSquad:fmUndoCopyFailed')),
  }) }
  const makeDefault = (on: boolean) => writes.setDefault.mutate({ id: saved.id, on }, {
    onSuccess: () => toast(on ? t('coachSquad:fmDefaultOn', { name: saved.name, count: saved.format }) : t('coachSquad:fmDefaultOff', { name: saved.name })),
    onError: () => setProblem(t('coachSquad:fmDefaultFailed')),
  })
  const change = (next: (draft: FormationDraft) => FormationDraft) => {
    setProblem(null)
    setEdits(all => {
      const was = all[saved.id]?.draft ?? draftOf(saved)
      return { ...all, [saved.id]: { draft: next(was), history: [...(all[saved.id]?.history ?? []), was] } }
    })
  }
  const undo = () => setEdits(all => {
    const history = all[saved.id]?.history ?? []
    if (!history.length) return all
    const draft = history[history.length - 1]
    if (same(draft, draftOf(saved)) && history.length === 1) { const { [saved.id]: _gone, ...rest } = all; return rest }
    return { ...all, [saved.id]: { draft, history: history.slice(0, -1) } }
  })
  const discard = () => { setEdits(({ [saved.id]: _gone, ...rest }) => rest); setProblem(null); toast(t('coachSquad:fmDiscarded')) }
  const save = () => writes.save.mutate({ id: saved.id, draft: current }, {
    onSuccess: () => { setEdits(({ [saved.id]: _gone, ...rest }) => rest); setProblem(null); toast(t('coachSquad:fmSaved', { name: current.name })) },
    onError: error => setProblem(refusal(error) ?? saveFailed()),
  })
  const remove = () => writes.remove.mutate(saved.id, {
    onSuccess: () => {
      setEdits(({ [saved.id]: _gone, ...rest }) => rest)
      setConfirming(false)
      setParams(p => { const next = new URLSearchParams(p); next.delete('formation'); return next }, { replace: true })
      toast(t('coachSquad:fmDeleted', { name: saved.name }))
    },
    onError: () => setProblem(t('coachSquad:fmDeleteFailed')),
  })
  const starting = new Set(Object.values(current.starters))
  const bench = [...boardPlayers.values()].filter(p => p.canPlay && !starting.has(p.id))

  return <div className="arc grid gap-5">
    {header}
    <div role="group" aria-label={t('coachSquad:fmSavedList')} className="grid gap-2 tablet:grid-cols-2 laptop:grid-cols-3">
      {list.map(f => {
        const shown = edits[f.id]?.draft ?? draftOf(f), changed = !!edits[f.id] && !same(edits[f.id].draft, draftOf(f))
        return <button key={f.id} type="button" aria-pressed={f.id === saved.id} onClick={() => choose(f.id)}
          className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${f.id === saved.id ? 'border-brand bg-brand/10' : 'border-line bg-surface'}`}>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-[15px] font-medium text-ink">{shown.name}</span>
            <span className="text-sm text-ink-3">{shown.shape} · {changed ? t('coachSquad:fmUnsaved') : t('coachSquad:fmStartersSaved', { count: Object.keys(shown.starters).length })}</span>
          </span>
          {f.id === saved.id && <Check size={18} aria-hidden="true" className="shrink-0 text-brand" />}
        </button>
      })}
    </div>

    <section aria-labelledby="formation-name" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <div className="flex items-center gap-1">
            <h2 id="formation-name" className="text-xl font-medium text-ink">{current.name}</h2>
            <button type="button" aria-label={t('coachSquad:fmRename')} onClick={() => { setNamingProblem(null); setNaming({ kind: 'rename', name: saved.name }) }}
              className="grid size-10 place-items-center rounded-md text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Pencil size={18} aria-hidden="true" /></button>
          </div>
          <p role="status" className="flex items-center gap-1.5 text-sm text-ink-3">{dirty ? t('coachSquad:fmUnsaved') : <><Check size={14} aria-hidden="true" />{t('coachSquad:fmAllSaved')}</>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <Button variant="ghost" onClick={discard}>{t('coachSquad:fmDiscard')}</Button>}
          <Button onClick={save} disabled={!dirty} loading={writes.save.isPending && !naming}>{t('coachSchedule:saveChanges')}</Button>
        </div>
      </div>
      {copied && <Alert open tone="success" title={t('coachSquad:fmCopied', { name: copied.name, count: copied.eventIds.length })} onDismiss={() => setCopied(null)}>
        <Button size="sm" variant="secondary" loading={writes.undoCopy.isPending} onClick={undoCopy}>{t('coachSquad:fmUndoCopy')}</Button>
      </Alert>}
      {problem && <Alert tone="danger" title={problem} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={dirty} onClick={() => { setUseProblem(null); setUsing(true) }}>{t('coachSquad:fmUse')}</Button>
        <Button variant="secondary" size="sm" disabled={dirty} loading={writes.setDefault.isPending} onClick={() => makeDefault(!saved.isDefault)}>
          {saved.isDefault ? t('coachSquad:fmRemoveDefault') : t('coachSquad:fmMakeDefault', { count: saved.format })}</Button>
        {saved.isDefault && <Badge size="sm" tone="info">{t('coachSquad:fmDefaultBadge', { count: saved.format })}</Badge>}
        {dirty && <span className="text-sm text-ink-3">{t('coachSquad:fmSaveFirst')}</span>}
      </div>

      {/* TRAK-453: one control for format and shape, the one a match's line-up has; a shape in another format switches the format. */}
      <div className="tablet:max-w-sm">
        <span className="arc"><MorphSelect label={t('coachSquad:fmFormatAndShape')} items={shapeItems()} value={current.shape} searchable={false} panelWidth={200}
          onValueChange={shape => change(d => {
            const format = FORMATS.find(size => FORMATIONS[size].includes(shape)) ?? d.format
            return { ...d, format, shape, starters: reshapeXI(d.starters, d.shape, shape, format) }
          })} /></span>
      </div>

      <FormationBoard title={current.name} shape={current.shape} format={current.format} starters={current.starters} players={boardPlayers} bench={bench}
        onSwap={(a: Spot, b: Spot) => change(d => ({ ...d, starters: swapXI(d.starters, a, b) }))} onUndo={undo} canUndo={!!edit?.history.length} />

      {/* TRAK-452 (11 Nov walk-through): Set for matchday shows only once the formation has been copied to a match. */}
      {saved.copies.length > 0 && <section aria-label={t('coachSquad:fmSetMatchday')} className="grid gap-2 border-t border-line pt-4">
        <h3 className="text-[15px] font-medium text-ink">{t('coachSquad:fmSetMatchday')}</h3>
        <ul className="m-0 grid list-none gap-1 p-0">{saved.copies.map(copy => <li key={copy.eventId} className="text-sm text-ink-2">
          {t('coachSquad:fmCopiedOn', { label: copy.label, day: weekdayDayMonth(copy.copiedAt.slice(0, 10)) })}
          {copy.notComing > 0 && t('coachSquad:fmNotComing', { count: copy.notComing })}
          {copy.skipped > 0 && t('coachSquad:fmSkipped', { count: copy.skipped })}</li>)}</ul>
      </section>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {confirming
          ? <>
            <span className="text-sm text-ink-2">{t('coachSquad:fmDeleteAsk', { name: saved.name })}</span>
            <Button variant="danger" size="sm" loading={writes.remove.isPending} onClick={remove}>{t('coachSchedule:delete')}</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t('coachSquad:fmKeep')}</Button>
          </>
          : <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>{t('coachSquad:fmDelete')}</Button>}
      </div>
    </section>
    {nameSheet}
    {using && <UseForMatchesSheet formation={saved} squad={squad} using={writes.use.isPending} problem={useProblem} onClose={() => setUsing(false)} onUse={copyTo} />}
  </div>
}
