import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Select } from '@/components/arc/select/select'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { usePlayerRoles } from '@/components/coach/squad/usePlayerRoles'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, type Format } from '@/lib/games/formations'
import { isPosition } from '@/lib/positions'
import { FORMATION_SEEDS, firstXI, reshapeXI, swapXI, type Spot } from '@/lib/squad/formation-board'
import type { SquadRoster } from '../useSquadRoster'
import { FormationBoard, type BoardPlayer } from './FormationBoard'
import { NameSheet, type NameSheetMode } from './NameSheet'
import { refusal, useFormationWrites, useFormations, type Formation, type FormationDraft } from './useFormations'

/* TRAK-357 (Season plan 9/18, spec TRAK-348; Tarek's My Formations mockup, without its Instructions tab): Squad ›
   Formations, the coach's whiteboard of saved line-ups for one squad. Saved formations sit above the editor: a format
   and a shape (Matches' lists), the pitch beside the bench, Undo, Discard changes and Save. Edits stay a draft until
   Save. New, Rename and Delete (it asks first). It opens once every consented player in the squad has a position;
   until then it says how many to place. A squad starts with the mockup's three, saved for it once (Tarek, 5 Nov). The
   formation in view is in the address (?formation=). Matches take a copy in TRAK-360. */

const SAVE_FAILED = "Couldn't save the formation. Check your connection and try again; your changes are still here."
const FORMAT_OPTIONS = FORMATS.map(format => ({ value: String(format), label: `${format} a side` }))
const same = (a: FormationDraft, b: FormationDraft) => JSON.stringify([a.name, a.format, a.shape, a.starters]) === JSON.stringify([b.name, b.format, b.shape, b.starters])
const draftOf = ({ name, format, shape, starters }: Formation): FormationDraft => ({ name, format, shape, starters })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
type Edit = { draft: FormationDraft; history: FormationDraft[] }

export function FormationsTab({ roster }: { roster: SquadRoster }) {
  const { user } = useAuth()
  // The squad picked, or a coach's only squad.
  const squad = roster.squad ?? (roster.squads.length === 1 ? roster.squads[0] : null)
  if (!squad || !user) return <div className="grid justify-items-center gap-2 pt-14 text-center">
    <p className="text-[15px] font-medium text-ink-2">Pick one squad to see its formations</p>
    <p className="max-w-sm text-sm text-ink-3">A formation belongs to one squad, so its players never mix with another's. Choose a squad in the menu.</p>
  </div>
  // Keyed by squad, so one squad's edits never show in another's.
  return <Playbook key={squad} coachId={user.id} squad={squad} roster={roster} />
}

function Playbook({ coachId, squad, roster }: { coachId: string; squad: string; roster: SquadRoster }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const formations = useFormations(coachId, squad)
  const roles = usePlayerRoles(coachId)
  const writes = useFormationWrites(coachId, squad)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [naming, setNaming] = useState<NameSheetMode | null>(null)
  const [namingProblem, setNamingProblem] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
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
    <h2 id="formations-locked" className="text-lg font-medium text-ink">Place {plural(unplaced, 'player')} to open Formations</h2>
    <p className="max-w-prose text-sm text-ink-2">A formation is built from where each player plays, so every player in {squad} needs a position first.</p>
    <Button variant="secondary" onClick={() => navigate('/coach/season-plan/positions')}>Go to Positions</Button>
  </section>
  if (formations.isError || roles.isError) return <LoadError what="your formations" onRetry={() => { void formations.refetch(); void roles.refetch() }} />
  if (!list || roles.isPending || writes.start.isPending) return <LoadingSkeleton label="Loading your formations…" lines={3} rows={2} />

  const header = <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="grid gap-0.5">
      <h2 className="text-lg font-medium text-ink">Your matchday playbook</h2>
      <p className="text-sm text-ink-2">Save a shape and a starting line-up for every way {squad} plays.</p>
    </div>
    <Button variant="secondary" onClick={() => { setNamingProblem(null); setNaming({ kind: 'new', format: 11, shape: DEFAULT_FORMATION[11] }) }}>
      <Plus size={18} aria-hidden="true" />New formation</Button>
  </div>
  const nameSheet = naming && <NameSheet mode={naming} problem={namingProblem} saving={writes.save.isPending} onClose={() => setNaming(null)} onDone={named => {
    if (naming.kind === 'rename') return rename(named.name)
    const from = current ?? { name: named.name, format: named.format, shape: named.shape, starters: {} }
    const draft = { ...named, starters: current ? reshapeXI(from.starters, from.shape, named.shape, named.format) : {} }
    writes.save.mutate({ id: null, draft }, {
      onSuccess: id => { setNaming(null); if (id) choose(id); toast(`${named.name} created.`) },
      onError: error => setNamingProblem(refusal(error) ?? SAVE_FAILED),
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
        toast(`Renamed ${name}.`)
      },
      onError: error => setNamingProblem(refusal(error) ?? SAVE_FAILED),
    })
  }

  if (!saved || !current) return <div className="arc grid gap-5">
    {header}
    <div className="grid justify-items-center gap-2 rounded-2xl border border-line bg-surface p-8 text-center">
      <p className="text-[15px] font-medium text-ink">No formations yet</p>
      <p className="max-w-sm text-sm text-ink-3">Create one: pick a format and a shape, then put your players where you want them.</p>
    </div>
    {nameSheet}
  </div>

  const dirty = !!edit && !same(edit.draft, draftOf(saved))
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
  const discard = () => { setEdits(({ [saved.id]: _gone, ...rest }) => rest); setProblem(null); toast('Changes discarded.') }
  const save = () => writes.save.mutate({ id: saved.id, draft: current }, {
    onSuccess: () => { setEdits(({ [saved.id]: _gone, ...rest }) => rest); setProblem(null); toast(`${current.name} saved.`) },
    onError: error => setProblem(refusal(error) ?? SAVE_FAILED),
  })
  const remove = () => writes.remove.mutate(saved.id, {
    onSuccess: () => {
      setEdits(({ [saved.id]: _gone, ...rest }) => rest)
      setConfirming(false)
      setParams(p => { const next = new URLSearchParams(p); next.delete('formation'); return next }, { replace: true })
      toast(`${saved.name} deleted.`)
    },
    onError: () => setProblem("Couldn't delete the formation. Check your connection and try again."),
  })
  const starting = new Set(Object.values(current.starters))
  const bench = [...boardPlayers.values()].filter(p => p.canPlay && !starting.has(p.id))

  return <div className="arc grid gap-5">
    {header}
    <div role="group" aria-label="Saved formations" className="grid gap-2 tablet:grid-cols-2 laptop:grid-cols-3">
      {list.map(f => {
        const shown = edits[f.id]?.draft ?? draftOf(f), changed = !!edits[f.id] && !same(edits[f.id].draft, draftOf(f))
        return <button key={f.id} type="button" aria-pressed={f.id === saved.id} onClick={() => choose(f.id)}
          className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${f.id === saved.id ? 'border-brand bg-brand/10' : 'border-line bg-surface'}`}>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-[15px] font-medium text-ink">{shown.name}</span>
            <span className="text-sm text-ink-3">{shown.shape} · {changed ? 'Unsaved changes' : `${plural(Object.keys(shown.starters).length, 'starter')} saved`}</span>
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
            <button type="button" aria-label="Rename formation" onClick={() => { setNamingProblem(null); setNaming({ kind: 'rename', name: saved.name }) }}
              className="grid size-10 place-items-center rounded-md text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Pencil size={18} aria-hidden="true" /></button>
          </div>
          <p role="status" className="flex items-center gap-1.5 text-sm text-ink-3">{dirty ? 'Unsaved changes' : <><Check size={14} aria-hidden="true" />All changes saved</>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <Button variant="ghost" onClick={discard}>Discard changes</Button>}
          <Button onClick={save} disabled={!dirty} loading={writes.save.isPending && !naming}>Save changes</Button>
        </div>
      </div>
      {problem && <Alert tone="danger" title={problem} />}

      <div className="grid grid-cols-2 gap-3 tablet:max-w-sm">
        <Select label="Format" options={FORMAT_OPTIONS} value={String(current.format)} onValueChange={value => {
          const format = Number(value) as Format, shape = DEFAULT_FORMATION[format]
          change(d => ({ ...d, format, shape, starters: reshapeXI(d.starters, d.shape, shape, format) }))
        }} />
        <Select label="Shape" options={FORMATIONS[current.format].map(s => ({ value: s, label: s }))} value={current.shape}
          onValueChange={shape => change(d => ({ ...d, shape, starters: reshapeXI(d.starters, d.shape, shape, d.format) }))} />
      </div>

      <FormationBoard title={current.name} shape={current.shape} format={current.format} starters={current.starters} players={boardPlayers} bench={bench}
        onSwap={(a: Spot, b: Spot) => change(d => ({ ...d, starters: swapXI(d.starters, a, b) }))} onUndo={undo} canUndo={!!edit?.history.length} />

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {confirming
          ? <>
            <span className="text-sm text-ink-2">Delete {saved.name}? Your other formations stay as they are.</span>
            <Button variant="danger" size="sm" loading={writes.remove.isPending} onClick={remove}>Delete</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep it</Button>
          </>
          : <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Delete formation</Button>}
      </div>
    </section>
    {nameSheet}
  </div>
}
