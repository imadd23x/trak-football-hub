import { useState } from 'react'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, lineName, type Format } from '@/lib/games/formations'
import { CONTEXT, EXPECTATIONS, fitFormat, playerPlan, type PlayerPlans } from '@/lib/games/lineup'
import type { PlanForm } from '@/lib/games/plan'
import { useIsMobile } from '@/hooks/use-mobile'
import type { Candidate, useWhoCanCome } from './useGames'
import { MiniPitch, Pitch, type PitchPlayer } from './Pitch'
import { PlayerPanel, type Target } from './PlayerPanel'
import { LoadError } from '@/components/trak'
import { Avatar } from '@/components/arc/avatar/avatar'
import { Badge } from '@/components/arc/badge/badge'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { ExpandableText } from '@/components/arc/expandable-text/expandable-text'
import { Progress } from '@/components/arc/progress/progress'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import { Select } from '@/components/arc/select/select'
import { LockedValue } from './LockedValue'

/* TRAK-285 (Games 3/8): plan step 2, line-up and jobs (TRAK-282; the mockup's Squad step merged in, Imad 27 Oct). The
   coach picks a format and a formation, places players who can come, and gives each a job and a note. Off the pitch,
   a player is on the bench unless the coach leaves them out in their sheet (Imad, 28 Oct). The sheet is a bottom sheet
   on a phone, and a panel beside the pitch on a tablet or laptop, where the pitch stays in view. TRAK-287: locked at
   kick-off, the pitch and the sheet only show what was planned. */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
const FORMAT_OPTIONS = FORMATS.map(format => ({ value: String(format), label: `${format} a side` }))
const contextLabel = new Map(CONTEXT.map(tag => [tag.value, tag.label]))
const expectationLabel = new Map(EXPECTATIONS.map(level => [level.value, level.label]))

export function LineUpAndJobs({ form, onFormChange, who, locked = false }: {
  form: PlanForm; onFormChange: (form: PlanForm) => void; who: ReturnType<typeof useWhoCanCome>; locked?: boolean
}) {
  const phone = useIsMobile()
  const [target, setTarget] = useState<Target | null>(null)
  const shape = form.formation ?? DEFAULT_FORMATION[form.format]
  const setPlayers = (players: PlayerPlans) => onFormChange({ ...form, players })
  const setFormat = (value: string) => {
    const format = Number(value) as Format
    onFormChange({ ...form, format, players: fitFormat(form.players, format),
      formation: form.formation && FORMATIONS[format].includes(form.formation) ? form.formation : null })
  }

  if (who.error) return <LoadError what="who can come" onRetry={who.retry} />
  if (who.isPending) return <p role="status" className="pt-6 text-center text-[13px] text-ink-3">Loading who can come…</p>

  const plan = (player: Candidate) => playerPlan(form.players, player.id)
  const starters = new Map<number, Candidate>()
  for (const player of who.players) {
    const { role, slot } = plan(player)
    if (role === 'starter' && slot != null && slot <= form.format) starters.set(slot, player)
  }
  const onPitch = new Map<number, PitchPlayer>([...starters].map(([slot, player]) => [slot, { ...player, stretch: plan(player).expectation === 'stretch' }]))
  const placed = [...starters].sort(([a], [b]) => a - b).map(([, player]) => player)
  // Anyone who can come and isn't on the pitch or left out is on the bench.
  const bench = who.players.filter(player => !player.absent && plan(player).role !== 'not_selected' && !placed.includes(player))
  const leftOut = who.players.filter(player => !player.absent && plan(player).role === 'not_selected')
  const cantMakeIt = who.players.filter(player => player.absent && plan(player).role !== 'starter')
  const withJob = placed.filter(player => plan(player).job.trim()).length
  const title = target?.kind === 'slot' ? `${lineName(shape, target.slot)}, slot ${target.slot}`
    : who.players.find(player => target && player.id === target.id)?.name ?? 'Player'
  const panel = target && <PlayerPanel target={target} players={form.players} onPlayers={setPlayers} candidates={who.players}
    shape={shape} onTarget={setTarget} locked={locked} />
  // The name opens the sheet. The job sits beside it, not inside the button: a long job has its own Read more.
  const row = (player: Candidate, detail: string) => (
    <li key={player.id} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-2 py-3">
      <Avatar name={player.name} size="sm" aria-hidden="true" />
      <button type="button" onClick={() => setTarget({ kind: 'player', id: player.id })}
        className="justify-self-start rounded text-left text-base font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {player.name}<span className="font-normal text-ink-3">{detail}</span>
      </button>
      <div className="col-start-2 grid gap-1">
        {plan(player).role !== 'not_selected' && (plan(player).job.trim()
          ? <ExpandableText lines={2} className="text-sm text-ink-2">{plan(player).job}</ExpandableText>
          : <span className="text-sm text-ink-3">No job yet</span>)}
        {(player.absent || plan(player).expectation !== 'usual' || plan(player).context.length > 0) && <span className="arc flex flex-wrap gap-1.5">
          {/* TRAK-286: a starter whose family said they can't make it, after the plan was made. Never the reason. */}
          {player.absent && <Badge size="sm" tone="warning">Can’t make it</Badge>}
          {plan(player).context.map(tag => <Badge key={tag} size="sm" tone="warning">{contextLabel.get(tag)}</Badge>)}
          {plan(player).expectation !== 'usual' && <Badge size="sm" tone="info">Expect: {expectationLabel.get(plan(player).expectation)}</Badge>}
        </span>}
      </div>
    </li>
  )

  return (
    <div className="grid gap-4">
      <section aria-labelledby="plan-shape" className={card}>
        <h2 id="plan-shape" className="text-lg font-medium text-ink">Format and formation</h2>
        <div className="max-w-[220px]">{locked ? <LockedValue label="Format" value={`${form.format} a side`} />
          : <Select label="Format" options={FORMAT_OPTIONS} value={String(form.format)} onValueChange={setFormat} />}</div>
        <div className="grid gap-2">
          <p id="plan-formation" className="text-sm font-medium text-ink">Formation</p>
          <RadioCards aria-labelledby="plan-formation" minColumnWidth={150} value={shape} disabled={locked}
            options={FORMATIONS[form.format].map(option => ({ value: option, label: option, icon: <MiniPitch shape={option} /> }))}
            onValueChange={formation => onFormChange({ ...form, formation })} />
        </div>
      </section>

      <div className="grid gap-4 tablet:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] tablet:items-start">
        <section aria-labelledby="plan-pitch" className={`${card} tablet:sticky tablet:top-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="plan-pitch" className="text-lg font-medium text-ink">{shape}</h2>
            <span className="text-sm text-ink-3">Attacking →</span>
          </div>
          <Pitch shape={shape} starters={onPitch} selected={target?.kind === 'slot' ? target.slot
            : target ? playerPlan(form.players, target.id).slot : null}
            onSelect={slot => setTarget(starters.has(slot) ? { kind: 'player', id: starters.get(slot)!.id } : { kind: 'slot', slot })} />
          <p className="text-sm text-ink-3">{locked ? 'Tap a player to see their job.' : 'Tap a slot to pick who plays there, or a player to give them a job.'}</p>
          {[...onPitch.values()].some(player => player.stretch) && <p className="flex items-center gap-2 text-sm text-ink-3">
            <span aria-hidden="true" className="size-3 rounded-full border border-ink/60 bg-[rgb(var(--t-attention))]" />Yellow: stretch</p>}
        </section>
        {phone
          ? <BottomSheet className="arc" open={!!target} onOpenChange={open => { if (!open) setTarget(null) }} title={title} detents={[0.6, 0.92]}>{panel}</BottomSheet>
          : <aside aria-label={target ? title : 'Selected player'} className={card}>
              {target ? <><h2 className="text-lg font-medium text-ink">{title}</h2>{panel}</>
                : <p className="text-sm text-ink-2">Pick a slot or a player to see their job, note and expectation here.</p>}
            </aside>}
      </div>

      <section aria-labelledby="plan-jobs" className={card}>
        <div className="grid gap-3">
          <h2 id="plan-jobs" className="text-lg font-medium text-ink">Everyone’s job</h2>
          <Progress label={`${withJob} of ${form.format} starters have a job`} value={withJob} max={form.format} />
        </div>
        {placed.length + bench.length === 0
          ? <p className="text-sm text-ink-2">Nobody can come yet. Confirm players in Squad › Availability.</p>
          : <ul className="divide-y divide-line">
              {placed.map(player => row(player, ` · ${lineName(shape, plan(player).slot!)}`))}
              {bench.map(player => row(player, ' · Bench'))}
            </ul>}
      </section>

      {leftOut.length > 0 && <section aria-labelledby="plan-left-out" className={card}>
        <h2 id="plan-left-out" className="text-lg font-medium text-ink">Not selected</h2>
        <p className="text-sm text-ink-3">Their families see “Not in the squad this week”. Each player reads your note.</p>
        <ul className="divide-y divide-line">{leftOut.map(player => row(player, ''))}</ul>
      </section>}

      {cantMakeIt.length > 0 && <section aria-labelledby="plan-cant" className={card}>
        <h2 id="plan-cant" className="text-lg font-medium text-ink">Can’t make it</h2>
        <p className="text-sm text-ink-3">Their families said they can’t make it, so they can’t be placed.</p>
        <ul className="grid gap-2">{cantMakeIt.map(player => <li key={player.id} className="flex items-center gap-3 px-2 py-1">
          <Avatar name={player.name} size="sm" aria-hidden="true" />
          <span className="flex-1 text-base text-ink-2">{player.name}</span>
          <span className="arc"><Badge size="sm" tone="warning">Can’t make it</Badge></span>
        </li>)}</ul>
      </section>}
    </div>
  )
}
