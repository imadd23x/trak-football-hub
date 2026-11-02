import { Check } from 'lucide-react'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, lineName } from '@/lib/games/formations'
import { CONTEXT, EXPECTATIONS, PLAYER_LIMITS, fitFormat, place, playerPlan, setRole, takeOff, type PlayerPlan, type PlayerPlans } from '@/lib/games/lineup'
import type { PlanForm } from '@/lib/games/plan'
import type { Candidate, useWhoCanCome } from './useGames'
import { Pitch, SlotMark, type PitchPlayer } from './Pitch'
import { LoadError } from '@/components/trak'
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu'
import { InlineEdit } from '@/components/arc/inline-edit/inline-edit'
import { MorphSelect } from '@/components/arc/morph-select/morph-select'
import { SortableDataTable, type DataColumn } from '@/components/arc/sortable-data-table/sortable-data-table'

/* TRAK-285 (Games 3/8): plan step 2, line-up and jobs (TRAK-282; the mockup's Squad step merged in, Imad 27 Oct). The
   coach picks a formation, places players who can come, and gives each a job. Off the pitch, a player is on the bench
   unless the coach leaves them out (Imad, 28 Oct). TRAK-287: locked at kick-off, the pitch and the squad only show what
   was planned. TRAK-329 (Imad, 2 Nov): format and formation are one Arc morph select on the pitch's top left, a header
   per format, so a shape in another format switches the format. TRAK-330 (Imad, 2 Nov): the pitch fills the column;
   each slot is an Arc morph select (empty: who plays there; filled: Take off the pitch first). Under it, everyone in the
   match squad in an Arc sortable table under their own position: the job (or, left out, the note to them, TRAK-319) in
   Arc's inline edit, and context and expectation in Arc dropdown menus. */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
const SHAPES = FORMATS.map(format => ({ label: `${format} a side`, options: FORMATIONS[format].map(shape => ({ value: shape, label: shape })) }))
const expectationLabel = new Map(EXPECTATIONS.map(level => [level.value, level.label]))
/** The slot list's first choice once someone plays there. */
const OFF = '__off'
/** Subheaders, by the position on each player's profile. Anything else on a profile reads as not recorded. */
const POSITIONS = [
  { key: 'goalkeeper', label: 'Goalkeepers' }, { key: 'defender', label: 'Defenders' }, { key: 'midfielder', label: 'Midfielders' },
  { key: 'attacker', label: 'Attackers' }, { key: 'none', label: 'Position not recorded' },
]
const positionOf = (position: string | null | undefined) => {
  const key = (position ?? '').trim().toLowerCase()
  return key === 'forward' ? 'attacker' : POSITIONS.some(group => group.key === key) && key !== 'none' ? key : 'none'
}
const rank = (player: Candidate) => player.absent ? 2 : player.confirmed ? 0 : 1
const firstName = (name: string) => name.split(/\s+/)[0] ?? name
const tick = (on: boolean) => <Check size={15} style={{ opacity: on ? 1 : 0 }} />
/** A slot as the coach hears it. */
const slotName = (slot: number, player?: PitchPlayer) => player
  ? `${player.name}, slot ${slot}${player.stretch ? ', stretch' : ''}${player.absent ? ", can't make it" : ''}`
  : `Slot ${slot}, empty`

type Row = { id: string; no: number | null; name: string; availability: string; job: string; context: string; expectation: string; position: string; player: Candidate }

export function LineUpAndJobs({ form, onFormChange, who, locked = false }: {
  form: PlanForm; onFormChange: (form: PlanForm) => void; who: ReturnType<typeof useWhoCanCome>; locked?: boolean
}) {
  const shape = form.formation ?? DEFAULT_FORMATION[form.format]
  const setPlayers = (players: PlayerPlans) => onFormChange({ ...form, players })
  // A shape's lines add up to its format less the keeper, so each shape belongs to one format.
  const setShape = (formation: string) => {
    const format = FORMATS.find(size => FORMATIONS[size].includes(formation)) ?? form.format
    onFormChange({ ...form, format, formation, players: fitFormat(form.players, format) })
  }

  if (who.error) return <LoadError what="who can come" onRetry={who.retry} />
  if (who.isPending) return <p role="status" className="pt-6 text-center text-[13px] text-ink-3">Loading who can come…</p>

  const plan = (player: Candidate) => playerPlan(form.players, player.id)
  const set = (player: Candidate, next: Partial<PlayerPlan>) => setPlayers({ ...form.players, [player.id]: { ...plan(player), ...next } })
  const starters = new Map<number, Candidate>()
  for (const player of who.players) {
    const { role, slot } = plan(player)
    if (role === 'starter' && slot != null && slot <= form.format) starters.set(slot, player)
  }
  const onPitch = new Map<number, PitchPlayer>([...starters].map(([slot, player]) => [slot, { ...player, stretch: plan(player).expectation === 'stretch' }]))
  const slotOf = (player: Candidate) => [...starters].find(([, starter]) => starter === player)?.[0]
  // A family's "can't make it" after a player was placed leaves them on the pitch, flagged, until the coach moves them.
  const out = (player: Candidate) => player.absent && slotOf(player) === undefined

  // Who plays in a slot: Confirmed first, then Not confirmed; "Can't make it" shows and can't be picked.
  const candidates = [...who.players].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const slotControl = (slot: number, side: 'start' | 'end') => {
    const starter = starters.get(slot)
    const name = slotName(slot, onPitch.get(slot))
    if (locked) return <span role="img" aria-label={name}><SlotMark player={onPitch.get(slot)} /></span>
    const items = [
      ...(starter ? [{ value: OFF, label: 'Take off the pitch' }] : []),
      ...candidates.map(candidate => {
        const tags = [candidate.absent ? "can't make it" : candidate.confirmed ? '' : 'not confirmed', slotOf(candidate) !== undefined ? 'on the pitch' : '']
        return { value: candidate.id, label: [candidate.name, ...tags.filter(Boolean)].join(' · '), disabled: candidate.absent }
      }),
    ]
    return <span className="arc"><MorphSelect label={name} hideLabel compact trigger={<SlotMark player={onPitch.get(slot)} />} items={items}
      value={starter?.id ?? null} align={side} panelWidth={260}
      onValueChange={id => setPlayers(id === OFF ? takeOff(form.players, starter!.id) : place(form.players, id, slot))} /></span>
  }

  const roleOf = (player: Candidate) => {
    const slot = slotOf(player)
    return slot !== undefined ? `Starting · ${lineName(shape, slot)}` : plan(player).role === 'not_selected' ? 'Not selected' : 'Bench'
  }
  // Under the name: where they are, and the moves off the pitch (Imad, 28 Oct: bench unless left out).
  const roleControl = (player: Candidate) => {
    if (out(player)) return null
    const role = roleOf(player)
    if (locked) return <span className="text-sm text-ink-3">{role}</span>
    const starting = slotOf(player) !== undefined
    const items = starting
      ? [{ label: 'Bench', onSelect: () => setPlayers(takeOff(form.players, player.id)) },
         { label: 'Not selected', onSelect: () => setPlayers(setRole(takeOff(form.players, player.id), player.id, 'not_selected')) }]
      : [{ label: role === 'Bench' ? 'Not selected' : 'Bench', onSelect: () => setPlayers(setRole(form.players, player.id, role === 'Bench' ? 'not_selected' : 'bench')) }]
    return <DropdownMenu label={role} ariaLabel={`${player.name}: ${role}`} items={items} />
  }
  // One box per player, theirs alone (TRAK-319): the job, or for a player left out, the note to them.
  const jobControl = (player: Candidate) => {
    if (out(player)) return '–'
    const note = plan(player).role === 'not_selected'
    const value = note ? plan(player).note : plan(player).job
    if (locked) return value ? <span className="whitespace-pre-line">{value}</span> : '–'
    const first = firstName(player.name)
    const max = note ? PLAYER_LIMITS.note : PLAYER_LIMITS.job
    return <InlineEdit key={note ? 'note' : 'job'} label={note ? `Note to ${first} · only ${first} sees it` : `Job · only ${first} sees it`}
      value={value} multiline variant="body" placeholder={note ? 'Add a note' : 'Add a job'}
      validate={next => next.length > max ? `Up to ${max} characters` : null} onSave={next => set(player, note ? { note: next } : { job: next })} />
  }
  // Only the coach sees context and expectation, and only players in the squad have them.
  const inSquad = (player: Candidate) => !out(player) && plan(player).role !== 'not_selected'
  const contextControl = (player: Candidate) => {
    if (!inSquad(player)) return '–'
    const context = plan(player).context
    const picked = CONTEXT.filter(tag => context.includes(tag.value)).map(tag => tag.label).join(', ') || 'None'
    if (locked) return picked
    return <DropdownMenu label={picked} ariaLabel={`Context, ${player.name}: ${picked}`} items={CONTEXT.map(tag => ({
      label: tag.label, icon: tick(context.includes(tag.value)), keepOpen: true,
      onSelect: () => set(player, { context: context.includes(tag.value) ? context.filter(value => value !== tag.value) : [...context, tag.value] }),
    }))} />
  }
  const expectationControl = (player: Candidate) => {
    if (!inSquad(player)) return '–'
    const expectation = plan(player).expectation
    const label = expectationLabel.get(expectation) ?? 'Usual'
    if (locked) return label
    return <DropdownMenu label={label} ariaLabel={`Expectation, ${player.name}: ${label}`} items={EXPECTATIONS.map(level => ({
      label: level.label, icon: tick(level.value === expectation), onSelect: () => set(player, { expectation: level.value }),
    }))} />
  }

  const rows: Row[] = who.players.map(player => ({
    id: player.id, no: player.shirt ?? null, name: player.name, position: positionOf(player.position), player,
    // Never the reason (TRAK-137): only that the family said they can't make it.
    availability: player.absent ? 'Can’t make it' : player.confirmed ? 'Confirmed' : 'Not confirmed',
    job: plan(player).role === 'not_selected' ? plan(player).note : plan(player).job,
    context: inSquad(player) ? CONTEXT.filter(tag => plan(player).context.includes(tag.value)).map(tag => tag.label).join(', ') : '',
    expectation: inSquad(player) ? expectationLabel.get(plan(player).expectation) ?? '' : '',
  }))
  const columns: DataColumn<Row>[] = [
    { key: 'no', label: 'No', width: 64 },
    { key: 'name', label: 'Name', primary: true, render: (_, row) => <span className="grid justify-items-start gap-1">
      <span className="font-medium text-ink">{row.name}</span>{roleControl(row.player)}</span> },
    { key: 'availability', label: 'Availability' },
    { key: 'job', label: 'Job', render: (_, row) => jobControl(row.player) },
    { key: 'context', label: 'Context', render: (_, row) => contextControl(row.player) },
    { key: 'expectation', label: 'Expectation', render: (_, row) => expectationControl(row.player) },
  ]

  return (
    <div className="grid gap-4">
      <section aria-labelledby="plan-pitch" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="plan-pitch" className={locked ? 'text-lg font-medium text-ink' : 'sr-only'}>{shape}</h2>
          {!locked && <span className="arc"><MorphSelect label="Formation" hideLabel items={SHAPES} value={shape} onValueChange={setShape}
            searchable={false} panelWidth={200} /></span>}
          <span className="text-sm text-ink-3">Attacking →</span>
        </div>
        <Pitch shape={shape} slot={slotControl} />
        {!locked && <p className="text-sm text-ink-3">Tap a slot to pick who plays there. Jobs, context and expectations are in the squad below.</p>}
        {[...onPitch.values()].some(player => player.stretch) && <p className="flex items-center gap-2 text-sm text-ink-3">
          <span aria-hidden="true" className="size-3 rounded-full border border-ink/60 bg-[rgb(var(--t-attention))]" />Yellow: stretch</p>}
      </section>

      <section aria-labelledby="plan-squad" className={card}>
        {/* No jobs bar (Imad, 2 Nov): sorting by Job lists who has none last. */}
        <h2 id="plan-squad" className="text-lg font-medium text-ink">Squad</h2>
        {who.players.length === 0 ? <p className="text-sm text-ink-2">Nobody can come yet. Confirm players in Squad › Availability.</p>
          : <div className="arc min-w-0"><SortableDataTable rows={rows} columns={columns} rowKey="id" caption="The match squad"
              defaultSort={{ key: 'no', direction: 'asc' }} groups={POSITIONS} groupOf={row => row.position} /></div>}
      </section>
    </div>
  )
}
