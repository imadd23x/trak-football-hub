import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Textarea } from '@/components/arc/textarea/textarea'
import { Input } from '@/components/arc/input/input'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { SliderInput } from '@/components/trak/SliderInput'
import { remember, remembered } from '@/lib/screen-memory'
import { trackEvent } from '@/lib/telemetry'
import { BANDS } from '@/lib/types'
import {
  NOTE_MAX, RATINGS, bandMove, bandOf, evalDay, ratingsAverage, sameRatings, startEntry, toPublish,
  type EvaluationEntry, type Ratings,
} from '@/lib/evaluation'
import {
  PROGRESS_OPTIONS, allRated, cleanAddition, emptyObjectives, isProgress, openAfter, toObjectivesPayload,
  type ObjectivesEntry,
} from '@/lib/objective-progress'
import { MAX_PLAYER_OBJECTIVES, PLAYER_OBJECTIVE_MAX } from '@/lib/player-objectives'
import { seasonEvaluationsKey } from './useEvaluation'
import { objectiveProgressKey, stuckObjectivesKey } from './useObjectiveProgress'
import { playerObjectivesKey } from './usePlayerObjectives'

/* TRAK-364 (Season plan 16/18, spec TRAK-348; mockup: Evaluation, Players → Publish). Every consented player of the
   squad, each starting from their latest six ratings, however they were given; the band follows the six. A name opens
   that player alone: the ratings, last time's band, and a note only the player sees, never their family; Done brings
   the list back. A player with no ratings yet starts at 5 each, as the assessment does, and has to be opened and rated
   before Publish: no band is made up for a child the coach hasn't rated. Publish writes everyone at once, or nothing:
   a failed publish keeps everything entered, on the screen and while the coach is away from it. */

const STEPS = [{ id: 'players', label: 'Players' }, { id: 'publish', label: 'Publish' }]
const PUBLISH_FAILED = "Couldn't publish the evaluation. Check your connection and try again; everything you entered is still here."
const first = (name: string) => name.trim().split(/\s+/)[0] || name
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const average = (r: Ratings) => ratingsAverage(r).toFixed(1)

export type EvaluationPlayer = { id: string; name: string; detail: string }

function BandChip({ ratings, move = 0 }: { ratings: Ratings; move?: number }) {
  const band = bandOf(ratings)
  return <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs"
    style={{ color: 'rgb(var(--t-ink))', background: band.bg, border: `1px solid ${band.border}` }}>
    <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: band.color }} />
    {band.word}
    {move > 0 && <><ArrowUp size={12} aria-hidden="true" /><span className="sr-only">, up a band</span></>}
    {move < 0 && <><ArrowDown size={12} aria-hidden="true" /><span className="sr-only">, down a band</span></>}
  </span>
}

/** The evaluation due on `dueOn`, Players then Publish. `players` are the consented players of the squad; `latest` each
 *  one's latest ratings. */
export function EvaluationSteps({ coachId, planId, squad, dueOn, players, waiting, latest, objectivesOf, onPublished, onRefused }: {
  coachId: string
  planId: string
  squad: string
  dueOn: string
  players: EvaluationPlayer[]
  /** Waiting for a parent: not in the evaluation, as nothing is recorded about them. */
  waiting: string[]
  latest: Map<string, Ratings>
  /** TRAK-365: a player's open objectives, which the evaluation asks Progress for. */
  objectivesOf: (playerId: string) => { id: string; title: string }[]
  onPublished: (players: number) => void
  /** The database refused a player (consent withdrawn, a player gone): read the squad again. */
  onRefused: () => void
}) {
  const client = useQueryClient()
  const memory = `evaluation:${planId}:${dueOn}`
  const [entries, setEntries] = useState<Record<string, EvaluationEntry>>(() => remembered<Record<string, EvaluationEntry>>(memory, coachId) ?? {})
  const [objectives, setObjectives] = useState<Record<string, ObjectivesEntry>>(() => remembered<Record<string, ObjectivesEntry>>(`${memory}:objectives`, coachId) ?? {})
  const [step, setStep] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const entryOf = (id: string) => entries[id] ?? startEntry(latest.get(id))
  const change = (id: string, next: Partial<EvaluationEntry>) => {
    const all = { ...entries, [id]: { ...entryOf(id), ...next } }
    setEntries(all)
    // Kept while the coach is away from the screen (in memory only, never on the device), so nothing entered is lost.
    remember(memory, coachId, all)
    setProblem(null)
  }
  const objectivesEntry = (id: string): ObjectivesEntry => objectives[id] ?? emptyObjectives()
  const changeObjectives = (id: string, next: ObjectivesEntry) => {
    const all = { ...objectives, [id]: next }
    setObjectives(all)
    remember(`${memory}:objectives`, coachId, all)
    setProblem(null)
  }
  const moved = (id: string) => { const before = latest.get(id); return !before || !sameRatings(entryOf(id).ratings, before) }
  const changed = players.filter(p => latest.has(p.id) && moved(p.id))
  const unrated = players.filter(p => !entryOf(p.id).rated)
  const objectivesUnsaid = players.filter(p => !allRated(objectivesOf(p.id), objectivesEntry(p.id)))

  const publish = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('publish_evaluation_with_objectives', {
        p_plan_id: planId, p_due_on: dueOn, p_players: toPublish(players.map(p => p.id), Object.fromEntries(players.map(p => [p.id, entryOf(p.id)]))),
        p_objectives: toObjectivesPayload(players.map(p => p.id), objectivesOf, Object.fromEntries(players.map(p => [p.id, objectivesEntry(p.id)]))),
      })
      if (error) throw error
      return data as { assessments?: { squad_player_id: string; assessment_id: string }[] } | null
    },
    onSuccess: async result => {
      // J7 counts each assessment the coach writes, an evaluation's as a session's.
      for (const row of result?.assessments ?? []) {
        const entry = entryOf(row.squad_player_id)
        void trackEvent('assessment_submitted', {
          mode: 'evaluation', players: players.length, assessment_id: row.assessment_id, squad_player_id: row.squad_player_id,
          band: bandOf(entry.ratings).word.toLowerCase(), updated: false, has_message: entry.note.trim().length > 0,
        })
      }
      remember(memory, coachId, undefined)
      remember(`${memory}:objectives`, coachId, undefined)
      await Promise.all([
        client.invalidateQueries({ queryKey: seasonEvaluationsKey(coachId) }),
        client.invalidateQueries({ queryKey: objectiveProgressKey(coachId) }),
        client.invalidateQueries({ queryKey: stuckObjectivesKey(coachId) }),
        client.invalidateQueries({ queryKey: playerObjectivesKey(coachId) }),
        client.invalidateQueries({ queryKey: ['coach', coachId, 'squad-roster'] }),
      ])
      onPublished(players.length)
    },
    onError: (error: { code?: string; message?: string }) => {
      // The database says why it refused (a child waiting for a parent, already published) in words for the coach.
      setProblem((error.code === 'P0001' || error.code === '42501') && error.message ? `${error.message}. Everything you entered is still here.` : PUBLISH_FAILED)
      if (error.code === '42501') onRefused()
    },
  })

  const open = players.find(p => p.id === openId)
  if (open) {
    const entry = entryOf(open.id), before = latest.get(open.id) ?? null, name = first(open.name)
    return (
      <div className="arc grid gap-5">
        <button type="button" onClick={() => setOpenId(null)}
          className="inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ChevronLeft size={16} aria-hidden="true" />All players
        </button>
        <header className="flex items-center gap-4">
          <PlayerFace name={open.name} size="lg" aria-hidden />
          <div className="grid gap-0.5">
            <p className="text-sm text-ink-3">Evaluation · due {evalDay(dueOn)}</p>
            <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{open.name}</h2>
            {open.detail && <p className="text-sm text-ink-3">{open.detail}</p>}
          </div>
        </header>
        <section aria-labelledby="evaluation-ratings" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 id="evaluation-ratings" className="text-lg font-medium text-ink">Ratings</h3>
            <span className="flex items-center gap-2 text-sm text-ink-2"><BandChip ratings={entry.ratings} move={bandMove(entry.ratings, before)} />{average(entry.ratings)}</span>
          </div>
          <p className="text-sm text-ink-3">{before
            ? `From last time: ${bandOf(before).word}, ${average(before)}. Move only what changed.`
            : `No ratings yet: each starts at 5. Set ${name}'s, then press Done.`}</p>
          <div className="grid gap-5">
            {RATINGS.map(({ key, label }) => <SliderInput key={key} label={label} value={entry.ratings[key]}
              onChange={value => change(open.id, { ratings: { ...entry.ratings, [key]: value } })} />)}
          </div>
        </section>
        <ObjectivesSection name={name} open={objectivesOf(open.id)} entry={objectivesEntry(open.id)} onChange={next => changeObjectives(open.id, next)} />
        <Textarea label={`Note to ${name}`} description={`Optional. Only ${name} sees it, never their family.`} rows={3}
          maxLength={NOTE_MAX} value={entry.note} placeholder="e.g. Your first touch has come on. Next: look up before it arrives."
          onChange={event => change(open.id, { note: event.target.value.slice(0, NOTE_MAX) })} />
        <div className="flex justify-end">
          <Button onClick={() => { change(open.id, { rated: true }); setOpenId(null) }}>Done</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="arc grid gap-5">
      <Stepper steps={STEPS} current={step} onStepSelect={setStep} label="Evaluation steps" jumpAhead />
      {step === 0 ? (
        <section aria-labelledby="evaluation-players" className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="grid gap-1">
              <h2 id="evaluation-players" className="text-lg font-medium text-ink">How is each player doing?</h2>
              <p className="text-sm text-ink-2">{latest.size ? 'Everyone starts where they were last time. Change only who moved.'
                : 'Nobody has ratings yet: open each player and rate them once. Next time they start from there.'}</p>
            </div>
            <span className="text-sm text-ink-3">{changed.length ? `${count(changed.length, 'player')} changed` : 'Nobody changed yet'}</span>
          </div>
          {players.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-2">Nobody in {squad} can be evaluated yet.</p>
            : <ul aria-label="Players" className="m-0 grid list-none gap-0 divide-y divide-line rounded-2xl border border-line bg-surface px-4 py-1">
              {players.map(p => {
                const entry = entryOf(p.id), before = latest.get(p.id) ?? null
                const saidObjectives = allRated(objectivesOf(p.id), objectivesEntry(p.id))
                const line = !entry.rated ? 'Not rated yet'
                  : !saidObjectives ? 'Objectives to rate'
                  : [`${bandOf(entry.ratings).word} · ${average(entry.ratings)}`, before && moved(p.id) ? `was ${bandOf(before).word} · ${average(before)}` : null,
                    entry.note.trim() ? 'Note' : null].filter(Boolean).join(' · ')
                return <li key={p.id}>
                  <button type="button" onClick={() => setOpenId(p.id)}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <PlayerFace name={p.name} size="sm" aria-hidden />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className={`truncate text-xs ${entry.rated ? 'text-ink-3' : 'text-warning'}`}>{line}</span>
                    </span>
                    {entry.rated && <BandChip ratings={entry.ratings} move={bandMove(entry.ratings, before)} />}
                  </button>
                </li>
              })}
            </ul>}
          {waiting.length > 0 && <p className="text-sm text-ink-3">Not in this evaluation: {waiting.join(', ')}. Waiting for a parent, so nothing is
            recorded about {waiting.length === 1 ? 'them' : 'any of them'} yet.</p>}
          <div className="flex justify-end">
            <Button onClick={() => setStep(1)}>Next: Publish</Button>
          </div>
        </section>
      ) : (
        <PublishStep players={players} entries={Object.fromEntries(players.map(p => [p.id, entryOf(p.id)]))} latest={latest} waiting={waiting}
          unrated={unrated.map(p => p.name)} objectivesUnsaid={objectivesUnsaid.map(p => p.name)} publishing={publish.isPending} problem={problem}
          onBack={() => setStep(0)} onPublish={() => { setProblem(null); publish.mutate() }} />
      )}
    </div>
  )
}

/** TRAK-365: a player's open objectives, each Not yet, Some progress, On track or Met (which closes it), and room to add
 *  another while they keep fewer than two open. */
function ObjectivesSection({ name, open, entry, onChange }: {
  name: string; open: { id: string; title: string }[]; entry: ObjectivesEntry; onChange: (next: ObjectivesEntry) => void
}) {
  const [text, setText] = useState('')
  const room = openAfter(open, entry) < MAX_PLAYER_OBJECTIVES
  const addition = cleanAddition(text, [...open.map(o => o.title), ...entry.add], PLAYER_OBJECTIVE_MAX)
  if (open.length === 0 && !room) return null
  return (
    <section aria-labelledby="evaluation-objectives" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="grid gap-1">
        <h3 id="evaluation-objectives" className="text-lg font-medium text-ink">Objectives</h3>
        <p className="text-sm text-ink-3">{open.length ? `How is ${name} doing on each? Met closes it.` : `${name} has no objectives yet. You can add one.`}</p>
      </div>
      {open.map(o => (
        <div key={o.id} className="grid gap-2">
          <p className="text-sm font-medium text-ink">{o.title}</p>
          <SegmentedControl label={`Progress on ${o.title}`} options={PROGRESS_OPTIONS} value={entry.progress[o.id] ?? ''}
            onValueChange={value => { if (isProgress(value)) onChange({ ...entry, progress: { ...entry.progress, [o.id]: value } }) }} />
        </div>
      ))}
      {entry.add.length > 0 && <ul className="m-0 grid list-none gap-2 p-0">{entry.add.map(title => (
        <li key={title} className="flex items-center justify-between gap-3 text-sm text-ink">
          <span className="min-w-0 truncate">New: {title}</span>
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...entry, add: entry.add.filter(t => t !== title) })}>Remove</Button>
        </li>))}
      </ul>}
      {room && (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input label="Add another objective" value={text} maxLength={PLAYER_OBJECTIVE_MAX} placeholder="e.g. Scan before receiving"
              onChange={event => setText(event.target.value)} />
          </div>
          <Button variant="secondary" disabled={!addition} onClick={() => { if (addition) { onChange({ ...entry, add: [...entry.add, addition] }); setText('') } }}>Add</Button>
        </div>
      )}
    </section>
  )
}

function PublishStep({ players, entries, latest, waiting, unrated, objectivesUnsaid, publishing, problem, onBack, onPublish }: {
  players: EvaluationPlayer[]
  entries: Record<string, EvaluationEntry>
  latest: Map<string, Ratings>
  waiting: string[]
  unrated: string[]
  objectivesUnsaid: string[]
  publishing: boolean
  problem: string | null
  onBack: () => void
  onPublish: () => void
}) {
  const moves = players.map(p => {
    const before = latest.get(p.id) ?? null, now = entries[p.id].ratings
    return { p, now, before, move: bandMove(now, before), changed: !!before && !sameRatings(now, before) }
  })
  const changed = moves.filter(m => m.changed)
  const notes = players.filter(p => entries[p.id].note.trim()).length
  const blocked = !players.length ? 'There’s nobody to evaluate.'
    : unrated.length ? `Rate ${unrated.length > 2 ? `${first(unrated[0])} and ${unrated.length - 1} others` : unrated.map(first).join(' and ')} first: no ratings yet.`
    : objectivesUnsaid.length ? `Say how ${objectivesUnsaid.length > 2 ? `${first(objectivesUnsaid[0])} and ${objectivesUnsaid.length - 1} others are` : `${objectivesUnsaid.map(first).join(' and ')} ${objectivesUnsaid.length === 1 ? 'is' : 'are'}`} doing on their objectives first.`
    : null
  return (
    <div className="grid gap-5">
      <div className="grid items-start gap-5 laptop:grid-cols-2">
        <section aria-labelledby="evaluation-changed" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="evaluation-changed" className="text-lg font-medium text-ink">What changed</h2>
            <span className="text-sm text-ink-3">{changed.length}</span>
          </div>
          {changed.length === 0 ? <p className="text-sm text-ink-2">Nothing changed. Everyone stays where they were last time.</p>
            : <ul className="m-0 grid list-none gap-2 p-0">{changed.map(({ p, now, before, move }) => (
              <li key={p.id} className="flex items-center gap-3">
                <PlayerFace name={p.name} size="sm" aria-hidden />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="text-xs text-ink-3">{move ? `${bandOf(before!).word} → ${bandOf(now).word}` : `Same band · ${average(before!)} → ${average(now)}`}</span>
                </span>
                <BandChip ratings={now} move={move} />
              </li>))}
            </ul>}
        </section>
        <section aria-labelledby="evaluation-bands" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
          <h2 id="evaluation-bands" className="text-lg font-medium text-ink">Bands</h2>
          <ul className="m-0 grid list-none gap-2 p-0">{BANDS.map(band => {
            const here = moves.filter(m => entries[m.p.id].rated && bandOf(m.now).word === band.word)
            return <li key={band.word} className="flex items-start justify-between gap-3">
              <span className="w-24 shrink-0 text-sm text-ink-2">{band.word}</span>
              <span className="min-w-0 flex-1 text-sm text-ink">{here.length ? here.map(m => first(m.p.name)).join(', ') : <span className="text-ink-3">Nobody</span>}</span>
              <span className="text-sm text-ink-3">{here.length}</span>
            </li>
          })}</ul>
        </section>
      </div>
      <section aria-label="Who sees what" className="grid gap-1 rounded-2xl border border-line bg-surface p-5">
        <p className="text-sm text-ink">Each player sees their band and your note to them. Their family sees the band, never the note. Nobody sees another player’s.</p>
        <p className="text-sm text-ink-3">{count(players.length, 'player')} · {count(changed.length, 'change')} · {count(notes, 'note')}
          {waiting.length ? ` · not in it: ${waiting.join(', ')}, waiting for a parent` : ''}</p>
      </section>
      {problem && <Alert tone="danger" title={problem} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Players</Button>
        <span className="flex flex-wrap items-center justify-end gap-3">
          {blocked && <span className="text-sm text-ink-3">{blocked}</span>}
          <Button loading={publishing} disabled={!!blocked} onClick={onPublish}>Publish to {count(players.length, 'player')}</Button>
        </span>
      </div>
    </div>
  )
}
