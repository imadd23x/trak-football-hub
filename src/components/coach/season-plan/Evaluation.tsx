import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Textarea } from '@/components/arc/textarea/textarea'
import { Input } from '@/components/arc/input/input'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { SliderInput } from '@/components/trak/SliderInput'
import { ReportPreview } from '@/components/coach/squad/PlayerReport'
import { remember, remembered } from '@/lib/screen-memory'
import { trackEvent } from '@/lib/telemetry'
import { BANDS } from '@/lib/types'
import {
  NOTE_MAX, RATINGS, bandMove, bandOf, evalDay, ratingsAverage, sameRatings, startEntry, toPublish,
  type EvaluationEntry, type Ratings,
} from '@/lib/evaluation'
import {
  PROGRESS_OPTIONS, allRated, cleanAddition, emptyObjectives, isProgress, openAfter, toObjectivesPayload,
  type ObjectivesEntry, type Progress,
} from '@/lib/objective-progress'
import { MAX_PLAYER_OBJECTIVES, PLAYER_OBJECTIVE_MAX } from '@/lib/player-objectives'
import { seasonEvaluationsKey, sentOnDayKey } from './useEvaluation'
import { objectiveProgressKey, stuckObjectivesKey } from './useObjectiveProgress'
import { playerObjectivesKey } from './usePlayerObjectives'

/* TRAK-364 (Season plan 16/18, spec TRAK-348; mockup: Evaluation, Players → Publish), TRAK-531 (Reports 8/10, Imad
   21 Nov): report day. Every consented player of the squad, each starting from his latest assessment: his six ratings,
   and his objectives' answers from one since the last report day; the band follows the six. A name opens that player
   alone: the ratings, last time's band, his objectives and an optional note to him and his parents, which goes in both
   copies of the report. Preview shows his report as Send will store it; "Send {name}'s report" sends his alone, and the
   list then says Sent. "Send to N players" sends the rest, and closes the day. A player with no ratings yet starts at 5
   each, as the assessment does, and has to be opened before he is sent: no band is made up for a child the coach hasn't
   rated. A send writes all its players or nothing: a failed one keeps everything entered, on the screen and while the
   coach is away from it. */

const STEPS = [{ id: 'players', label: 'Players' }, { id: 'send', label: 'Send' }]
const SEND_FAILED = "Couldn't send the reports. Check your connection and try again; everything you entered is still here."
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

/** The report day `dueOn`, Players then Send. `players` are the consented players of the squad; `latest` each one's
 *  latest ratings; `sent` those already sent their report on this day. */
export function EvaluationSteps({ coachId, planId, squad, dueOn, lastReportDay, players, waiting, latest, sent, answersOf, objectivesOf, onPublished, onRefused }: {
  coachId: string
  planId: string
  squad: string
  dueOn: string
  /** The last report day sent before this one, which the report counts from. */
  lastReportDay: string | null
  players: EvaluationPlayer[]
  /** Waiting for a parent: not in the report day, as nothing is recorded about them. */
  waiting: string[]
  latest: Map<string, Ratings>
  sent: Set<string>
  /** His latest answer to each objective since the last report day, where the objectives start. */
  answersOf: (playerId: string) => Partial<Record<string, Progress>> | undefined
  /** TRAK-365: a player's open objectives, which the report day asks Progress for. */
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
  const [preview, setPreview] = useState(false)
  const [sentOne, setSentOne] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const entryOf = (id: string) => entries[id] ?? startEntry(latest.get(id))
  const change = (id: string, next: Partial<EvaluationEntry>) => {
    const all = { ...entries, [id]: { ...entryOf(id), ...next } }
    setEntries(all)
    // Kept while the coach is away from the screen (in memory only, never on the device), so nothing entered is lost.
    remember(memory, coachId, all)
    setProblem(null)
  }
  const objectivesEntry = (id: string): ObjectivesEntry => objectives[id] ?? {
    ...emptyObjectives(),
    progress: Object.fromEntries(objectivesOf(id).flatMap(o => { const said = answersOf(id)?.[o.id]; return said ? [[o.id, said]] : [] })),
  }
  const changeObjectives = (id: string, next: ObjectivesEntry) => {
    const all = { ...objectives, [id]: next }
    setObjectives(all)
    remember(`${memory}:objectives`, coachId, all)
    setProblem(null)
  }
  const toSend = players.filter(p => !sent.has(p.id))
  const moved = (id: string) => { const before = latest.get(id); return !before || !sameRatings(entryOf(id).ratings, before) }
  const changed = toSend.filter(p => latest.has(p.id) && moved(p.id))
  const unrated = toSend.filter(p => !entryOf(p.id).rated)
  const objectivesUnsaid = toSend.filter(p => !allRated(objectivesOf(p.id), objectivesEntry(p.id)))

  const send = useMutation({
    // `close`: the squad's Send, which closes the day; one player's leaves it open for the rest.
    mutationFn: async ({ ids, close }: { ids: string[]; close: boolean }) => {
      const { data, error } = await supabase.rpc('publish_evaluation_with_objectives', {
        p_plan_id: planId, p_due_on: dueOn, p_players: toPublish(ids, Object.fromEntries(ids.map(id => [id, entryOf(id)]))),
        p_objectives: toObjectivesPayload(ids, objectivesOf, Object.fromEntries(ids.map(id => [id, objectivesEntry(id)]))),
        p_close: close,
      })
      if (error) throw error
      return data as { evaluation_id?: string; assessments?: { squad_player_id: string; assessment_id: string }[] } | null
    },
    onSuccess: async (result, { ids, close }) => {
      // J7 counts each assessment the coach writes, a report day's as a session's.
      for (const row of result?.assessments ?? []) {
        const entry = entryOf(row.squad_player_id)
        void trackEvent('assessment_submitted', {
          mode: 'evaluation', players: ids.length, assessment_id: row.assessment_id, squad_player_id: row.squad_player_id,
          band: bandOf(entry.ratings).word.toLowerCase(), updated: false, has_message: entry.note.trim().length > 0,
        })
      }
      // Sent at once, before the day's list is read again, so nobody shows as still to send.
      if (result?.evaluation_id) client.setQueryData(sentOnDayKey(coachId, result.evaluation_id), (had: Set<string> | undefined) => new Set([...(had ?? []), ...ids]))
      if (close) {
        remember(memory, coachId, undefined)
        remember(`${memory}:objectives`, coachId, undefined)
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: seasonEvaluationsKey(coachId) }),
        client.invalidateQueries({ queryKey: objectiveProgressKey(coachId) }),
        client.invalidateQueries({ queryKey: stuckObjectivesKey(coachId) }),
        client.invalidateQueries({ queryKey: playerObjectivesKey(coachId) }),
        client.invalidateQueries({ queryKey: ['coach', coachId, 'squad-roster'] }),
        ...ids.map(id => client.invalidateQueries({ queryKey: ['coach', coachId, 'sent-reports', id] })),
      ])
      if (close) onPublished(ids.length)
      else {
        setSentOne(players.find(p => p.id === ids[0])?.name ?? null)
        setPreview(false)
        setOpenId(null)
      }
    },
    onError: (error: { code?: string; message?: string }) => {
      // The database says why it refused (a child waiting for a parent, already sent) in words for the coach.
      setProblem((error.code === 'P0001' || error.code === '42501') && error.message ? `${error.message}. Everything you entered is still here.` : SEND_FAILED)
      if (error.code === '42501') onRefused()
    },
  })

  const open = toSend.find(p => p.id === openId)
  if (open && preview) {
    const entry = entryOf(open.id)
    return (
      <div className="arc grid gap-5">
        <button type="button" onClick={() => setPreview(false)}
          className="inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ChevronLeft size={16} aria-hidden="true" />{open.name}
        </button>
        <ReportPreview playerId={open.id} name={open.name} coachId={coachId} reportDay={dueOn} lastReportDay={lastReportDay}
          ratings={entry.ratings} progress={objectivesEntry(open.id).progress} note={entry.note} />
      </div>
    )
  }
  if (open) {
    const entry = entryOf(open.id), before = latest.get(open.id) ?? null, name = first(open.name)
    const oneBlocked = allRated(objectivesOf(open.id), objectivesEntry(open.id)) ? null : `Say how ${name} is doing on the objectives first.`
    return (
      <div className="arc grid gap-5">
        <button type="button" onClick={() => setOpenId(null)}
          className="inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ChevronLeft size={16} aria-hidden="true" />All players
        </button>
        <header className="flex items-center gap-4">
          <PlayerFace name={open.name} playerId={open.id} size="lg" aria-hidden />
          <div className="grid gap-1">
            <p className="text-sm text-ink-3">Report · due {evalDay(dueOn)}</p>
            <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{open.name}</h2>
            {open.detail && <p className="text-sm text-ink-3">{open.detail}</p>}
          </div>
        </header>
        <section aria-labelledby="evaluation-ratings" className="grid gap-4 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 id="evaluation-ratings" className="text-lg font-medium text-ink">Ratings</h3>
            <span className="flex items-center gap-2 text-sm text-ink-2"><BandChip ratings={entry.ratings} move={bandMove(entry.ratings, before)} />{average(entry.ratings)}</span>
          </div>
          <p className="text-sm text-ink-3">{before
            ? `From last time: ${bandOf(before).word}, ${average(before)}.`
            : `No ratings yet: each starts at 5. Set ${name}'s, then press Done.`}</p>
          <div className="grid gap-5">
            {RATINGS.map(({ key, label }) => <SliderInput key={key} label={label} value={entry.ratings[key]}
              onChange={value => change(open.id, { ratings: { ...entry.ratings, [key]: value } })} />)}
          </div>
        </section>
        <ObjectivesSection name={name} open={objectivesOf(open.id)} entry={objectivesEntry(open.id)} onChange={next => changeObjectives(open.id, next)} />
        <Textarea label={`Note to ${name} and parents`} rows={3}
          maxLength={NOTE_MAX} value={entry.note} placeholder="e.g. Your first touch has come on. Next: look up before it arrives."
          onChange={event => change(open.id, { note: event.target.value.slice(0, NOTE_MAX) })} />
        {problem && <Alert tone="danger" title={problem} />}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {oneBlocked && <span className="text-sm text-ink-3">{oneBlocked}</span>}
          <Button variant="ghost" onClick={() => setPreview(true)}>Preview</Button>
          <Button variant="secondary" loading={send.isPending} disabled={!!oneBlocked || send.isPending}
            onClick={() => { setProblem(null); send.mutate({ ids: [open.id], close: false }) }}>Send {name}’s report</Button>
          <Button onClick={() => { change(open.id, { rated: true }); setOpenId(null) }}>Done</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="arc grid gap-5">
      {sentOne && <Alert tone="success" title={`${first(sentOne)}’s report is sent.`} />}
      <Stepper steps={STEPS} current={step} onStepSelect={setStep} label="Report steps" jumpAhead />
      {step === 0 ? (
        <section aria-labelledby="evaluation-players" className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="grid gap-2">
              <h2 id="evaluation-players" className="text-lg font-medium text-ink">How is each player doing?</h2>
            </div>
            <span className="text-sm text-ink-3">{changed.length ? `${count(changed.length, 'player')} changed` : 'Nobody changed yet'}</span>
          </div>
          {players.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-5 laptop:p-6 text-sm text-ink-2">Nobody in {squad} can get a report yet.</p>
            : <ul aria-label="Players" className="m-0 grid list-none gap-0 divide-y divide-line rounded-2xl border border-line bg-surface px-4 py-1">
              {players.map(p => {
                if (sent.has(p.id)) return <li key={p.id} className="flex min-h-14 items-center gap-3 py-2">
                  <PlayerFace name={p.name} playerId={p.id} size="sm" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.name}</span>
                  <Badge tone="success" size="sm">Sent</Badge>
                </li>
                const entry = entryOf(p.id), before = latest.get(p.id) ?? null
                const saidObjectives = allRated(objectivesOf(p.id), objectivesEntry(p.id))
                const line = !entry.rated ? 'Not rated yet'
                  : !saidObjectives ? 'Objectives to rate'
                  : [`${bandOf(entry.ratings).word} · ${average(entry.ratings)}`, before && moved(p.id) ? `was ${bandOf(before).word} · ${average(before)}` : null,
                    entry.note.trim() ? 'Note' : null].filter(Boolean).join(' · ')
                return <li key={p.id}>
                  <button type="button" onClick={() => { setSentOne(null); setOpenId(p.id) }}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <PlayerFace name={p.name} playerId={p.id} size="sm" aria-hidden />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className={`truncate text-xs ${entry.rated ? 'text-ink-3' : 'text-warning'}`}>{line}</span>
                    </span>
                    {entry.rated && <BandChip ratings={entry.ratings} move={bandMove(entry.ratings, before)} />}
                  </button>
                </li>
              })}
            </ul>}
          <div className="flex justify-end">
            <Button onClick={() => setStep(1)}>Next: Send</Button>
          </div>
        </section>
      ) : (
        <SendStep players={toSend} everyone={players.length} entries={Object.fromEntries(toSend.map(p => [p.id, entryOf(p.id)]))} latest={latest} waiting={waiting}
          unrated={unrated.map(p => p.name)} objectivesUnsaid={objectivesUnsaid.map(p => p.name)} sending={send.isPending} problem={problem}
          onBack={() => setStep(0)} onSend={() => { setProblem(null); send.mutate({ ids: toSend.map(p => p.id), close: true }) }} />
      )}
    </div>
  )
}

/** TRAK-365: a player's open objectives, each Not yet, Some progress, On track or Met (which closes it), and room to add
 *  another while they keep fewer than two open. */
export function ObjectivesSection({ name, open, entry, onChange }: {
  name: string; open: { id: string; title: string }[]; entry: ObjectivesEntry; onChange: (next: ObjectivesEntry) => void
}) {
  const [text, setText] = useState('')
  const room = openAfter(open, entry) < MAX_PLAYER_OBJECTIVES
  const addition = cleanAddition(text, [...open.map(o => o.title), ...entry.add], PLAYER_OBJECTIVE_MAX)
  if (open.length === 0 && !room) return null
  return (
    <section aria-labelledby="evaluation-objectives" className="grid gap-4 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
      <div className="grid gap-2">
        <h3 id="evaluation-objectives" className="text-lg font-medium text-ink">Objectives</h3>
        {!open.length && <p className="text-sm text-ink-3">{`${name} has no objectives yet. You can add one.`}</p>}
      </div>
      {open.map(o => (
        <div key={o.id} className="grid gap-2">
          <p className="text-sm font-medium text-ink">{o.title}</p>
          {/* TRAK-534: four answers don't fit a phone's card in one row, so there they sit two by two instead of scrolling out of view. */}
          <SegmentedControl label={`Progress on ${o.title}`} options={PROGRESS_OPTIONS} value={entry.progress[o.id] ?? ''}
            className="[&>div]:grid [&>div]:grid-cols-2 tablet:[&>div]:flex"
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

/** The squad's Send: what changes for the players still to send, and the button that sends them and closes the day. */
function SendStep({ players, everyone, entries, latest, waiting, unrated, objectivesUnsaid, sending, problem, onBack, onSend }: {
  players: EvaluationPlayer[]
  /** Everyone on the day, those already sent included. */
  everyone: number
  entries: Record<string, EvaluationEntry>
  latest: Map<string, Ratings>
  waiting: string[]
  unrated: string[]
  objectivesUnsaid: string[]
  sending: boolean
  problem: string | null
  onBack: () => void
  onSend: () => void
}) {
  const moves = players.map(p => {
    const before = latest.get(p.id) ?? null, now = entries[p.id].ratings
    return { p, now, before, move: bandMove(now, before), changed: !!before && !sameRatings(now, before) }
  })
  const changed = moves.filter(m => m.changed)
  const notes = players.filter(p => entries[p.id].note.trim()).length
  const blocked = !everyone ? 'There’s nobody to send a report to.'
    : unrated.length ? `Rate ${unrated.length > 2 ? `${first(unrated[0])} and ${unrated.length - 1} others` : unrated.map(first).join(' and ')} first: no ratings yet.`
    : objectivesUnsaid.length ? `Say how ${objectivesUnsaid.length > 2 ? `${first(objectivesUnsaid[0])} and ${objectivesUnsaid.length - 1} others are` : `${objectivesUnsaid.map(first).join(' and ')} ${objectivesUnsaid.length === 1 ? 'is' : 'are'}`} doing on their objectives first.`
    : null
  return (
    <div className="grid gap-5">
      <div className="grid items-start gap-4 laptop:grid-cols-2">
        <section aria-labelledby="evaluation-changed" className="grid gap-3 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="evaluation-changed" className="text-lg font-medium text-ink">What changed</h2>
            <span className="text-sm text-ink-3">{changed.length}</span>
          </div>
          {changed.length === 0 ? <p className="text-sm text-ink-2">Nothing changed. Everyone stays where they were last time.</p>
            : <ul className="m-0 grid list-none gap-2 p-0">{changed.map(({ p, now, before, move }) => (
              <li key={p.id} className="flex items-center gap-3">
                <PlayerFace name={p.name} playerId={p.id} size="sm" aria-hidden />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="text-xs text-ink-3">{move ? `${bandOf(before!).word} → ${bandOf(now).word}` : `Same band · ${average(before!)} → ${average(now)}`}</span>
                </span>
                <BandChip ratings={now} move={move} />
              </li>))}
            </ul>}
        </section>
        <section aria-labelledby="evaluation-bands" className="grid gap-3 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
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
      <p className="text-sm text-ink-3">{count(players.length, 'player')} · {count(changed.length, 'change')} · {count(notes, 'note')}
        {waiting.length ? ` · not in it: ${waiting.join(', ')}, waiting for a parent` : ''}</p>
      {problem && <Alert tone="danger" title={problem} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Players</Button>
        <span className="flex flex-wrap items-center justify-end gap-3">
          {blocked && <span className="text-sm text-ink-3">{blocked}</span>}
          {/* Everyone already sent one by one: Send only closes the day. */}
          <Button loading={sending} disabled={!!blocked} onClick={onSend}>{players.length ? `Send to ${count(players.length, 'player')}` : 'Done'}</Button>
        </span>
      </div>
    </div>
  )
}
