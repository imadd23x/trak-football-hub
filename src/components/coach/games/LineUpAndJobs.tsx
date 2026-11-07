import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, lineName, slotsOf } from '@/lib/games/formations'
import { fitFormat, followPosition, moveTo, playerPlan, type LineUpDrop, type PlayerPlan, type PlayerPlans } from '@/lib/games/lineup'
import type { PlanForm } from '@/lib/games/plan'
import { fitOf, positionsShort, slotPosition } from '@/lib/squad/formation-board'
import { useIsMobile } from '@/hooks/use-mobile'
import { usePlayerRoles } from '@/components/coach/squad/usePlayerRoles'
import { DragGhost } from '@/components/coach/squad/formations/FormationBoard'
import { usePointerSwap } from '@/components/coach/squad/formations/usePointerSwap'
import type { Candidate, useWhoCanCome } from './useGames'
import { ListFace, MarkersKey, Pitch, type LineUpSpot, type PitchPlayer } from './Pitch'
import { PlayerPanel, type Target } from './PlayerPanel'
import { LoadError } from '@/components/trak'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { Badge } from '@/components/arc/badge/badge'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { MorphSelect } from '@/components/arc/morph-select/morph-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-285 (Games 3/8): plan step 2, line-up and jobs (TRAK-282; the mockup's Squad step merged in, Imad 27 Oct). The
   coach picks a format and a formation, places players who can come, and gives each a job and a note. Off the pitch,
   a player is on the bench unless the coach leaves them out (Imad, 28 Oct). The sheet is a bottom sheet on a phone,
   and a panel beside the pitch on a tablet or laptop, where the pitch stays in view. TRAK-287: locked at kick-off, the
   pitch and the sheet only show what was planned. TRAK-329 (Imad, 2 Nov): format and formation are one Arc morph
   select on the pitch's top left, a header per format, so a shape in another format switches the format.
   TRAK-358 (Season plan 10/18, spec TRAK-348): Formations' pitch, with Bench and Not selected as tabs beside it
   (under it on a tablet and a phone). A player drags onto a place, a face or a tab; tapping a place still picks who
   plays there, and tapping a face opens their sheet. Placed outside their position and Can also play, a player gets
   Out of position ticked; moved back, it goes, unless the coach ticked it. Everyone's job went: the faces carry the
   markers, and Review & share counts the starters with a job. A family's "Can't make it" shows as before, until
   Not attending (TRAK-359). */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
const SHAPES = FORMATS.map(format => ({ label: `${format} a side`, options: FORMATIONS[format].map(shape => ({ value: shape, label: shape })) }))
type List = 'bench' | 'not_selected'

export function LineUpAndJobs({ form, onFormChange, who, locked = false }: {
  form: PlanForm; onFormChange: (form: PlanForm) => void; who: ReturnType<typeof useWhoCanCome>; locked?: boolean
}) {
  const { user } = useAuth()
  // TRAK-358: Can also play, so a placement outside it ticks Out of position.
  const roles = usePlayerRoles(user?.id)
  const phone = useIsMobile()
  const [target, setTarget] = useState<Target | null>(null)
  const [list, setList] = useState<List>('bench')
  const shape = form.formation ?? DEFAULT_FORMATION[form.format]
  const plan = (player: Candidate) => playerPlan(form.players, player.id)
  const inSlot = (slot: number) => who.players.find(player => plan(player).role === 'starter' && plan(player).slot === slot)

  /** Whether a plan stands outside the player's position and Can also play, on `on`'s places. */
  const outOn = (on: string) => (id: string, at: PlayerPlan) => {
    const player = who.players.find(candidate => candidate.id === id)
    return !!player && at.role === 'starter' && at.slot != null && at.slot <= slotsOf(on).length
      && fitOf({ id, position: player.position, also: roles.of(id).also }, slotPosition(on, at.slot)) === 'out'
  }
  const setPlayers = (players: PlayerPlans) => onFormChange({ ...form, players: followPosition(form.players, players, outOn(shape), outOn(shape)) })
  // A shape's lines add up to its format less the keeper, so each shape belongs to one format.
  const setShape = (formation: string) => {
    const format = FORMATS.find(size => FORMATIONS[size].includes(formation)) ?? form.format
    onFormChange({ ...form, format, formation, players: followPosition(form.players, fitFormat(form.players, format), outOn(shape), outOn(formation)) })
  }
  // A drag: from a place or a face, onto a place, a face, or a list's tab or panel.
  const swap = usePointerSwap<LineUpSpot>((from, to) => {
    const id = from.startsWith('slot:') ? inSlot(Number(from.slice(5)))?.id : from.startsWith('player:') ? from.slice(7) : undefined
    if (!id || locked) return
    const where: LineUpDrop = to.startsWith('slot:') ? { kind: 'slot', slot: Number(to.slice(5)) }
      : to.startsWith('player:') ? { kind: 'player', id: to.slice(7) } : { kind: 'list', role: to === 'list:bench' ? 'bench' : 'not_selected' }
    const next = moveTo(form.players, id, where)
    if (next === form.players) return
    setPlayers(next)
    // Beside the pitch, the sheet follows the player just moved, as picking them for a place does.
    if (!phone) setTarget({ kind: 'player', id })
  })
  const drag = locked ? null : swap

  if (who.error || roles.isError) return <LoadError what="who can come" onRetry={() => { who.retry(); void roles.refetch() }} />
  if (who.isPending || roles.isPending) return <LoadingSkeleton label="Loading who can come…" lines={1} avatar rows={4} className="pt-6" />

  const starters = new Map<number, PitchPlayer>()
  for (const player of who.players) {
    const { role, slot } = plan(player)
    if (role === 'starter' && slot != null && slot <= form.format) starters.set(slot, { ...player, plan: plan(player) })
  }
  const placed = new Set([...starters.values()].map(player => player.id))
  // Anyone who can come and isn't on the pitch or left out is on the bench.
  const bench = who.players.filter(player => !player.absent && plan(player).role !== 'not_selected' && !placed.has(player.id))
  const leftOut = who.players.filter(player => !player.absent && plan(player).role === 'not_selected')
  const cantMakeIt = who.players.filter(player => player.absent && plan(player).role !== 'starter')
  const title = target?.kind === 'slot' ? `${lineName(shape, target.slot)}, slot ${target.slot}`
    : who.players.find(player => target && player.id === target.id)?.name ?? 'Player'
  const panel = target && <PlayerPanel target={target} players={form.players} onPlayers={setPlayers} candidates={who.players}
    shape={shape} onTarget={setTarget} locked={locked} />
  const open = (player: Candidate) => setTarget({ kind: 'player', id: player.id })
  const opened = (player: Candidate) => target?.kind === 'player' && target.id === player.id
  const detail = (player: Candidate) => `${player.shirt != null ? `#${player.shirt} · ` : ''}${positionsShort(player.position, roles.of(player.id).also)}`
  const faces = (players: Candidate[], words: 'bench' | 'not selected') =>
    <ul role="group" aria-label={words === 'bench' ? 'Bench' : 'Not selected'} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 p-0">
      {players.map(player => <li key={player.id}>
        <ListFace player={player} plan={plan(player)} list={words} detail={detail(player)} on={opened(player)} onOpen={() => open(player)} swap={drag} />
      </li>)}
    </ul>
  // While a drag is over a tab or its panel, it lights up; each is a drop target until kick-off.
  const dropOn = (spot: LineUpSpot) => (drag ? { 'data-spot': spot } : {})
  const lit = (spot: LineUpSpot) => (drag?.drag?.over === spot ? 'ring-2 ring-brand' : '')

  return (
    <div className="grid gap-4">
      {/* TRAK-323 (Imad, 30 Oct): on a laptop the pitch, the tabs and the selected player's sheet sit side by side, the
          pitch and the sheet staying in view; on a tablet the tabs go under them. */}
      <div className="grid gap-4 tablet:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] tablet:items-start laptop:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <section aria-labelledby="plan-pitch" className={`${card} tablet:sticky tablet:top-[calc(var(--ph-pinned,0px)+1rem)]`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plan-pitch" className={locked ? 'text-lg font-medium text-ink' : 'sr-only'}>{shape}</h2>
            {!locked && <span className="arc"><MorphSelect label="Formation" hideLabel items={SHAPES} value={shape} onValueChange={setShape}
              searchable={false} panelWidth={200} /></span>}
            <span className="text-sm text-ink-3">Attacking ↑</span>
          </div>
          <Pitch shape={shape} format={form.format} starters={starters} swap={drag}
            selected={target?.kind === 'slot' ? target.slot : target ? playerPlan(form.players, target.id).slot : null}
            onSelect={slot => setTarget(starters.has(slot) ? { kind: 'player', id: starters.get(slot)!.id } : { kind: 'slot', slot })} />
          <DragGhost drag={drag?.drag ?? null} />
          <p className="text-sm text-ink-3">{locked ? 'Tap a player to see their job.'
            : 'Drag a player onto a place, or tap a place to pick who plays there. Tap a player to give them a job.'}</p>
          <MarkersKey />
        </section>
        {phone
          ? <BottomSheet className="arc" open={!!target} onOpenChange={next => { if (!next) setTarget(null) }} title={title} detents={[0.6, 0.92]}>{panel}</BottomSheet>
          : <aside aria-label={target ? title : 'Selected player'} className={`${card} tablet:sticky tablet:top-[calc(var(--ph-pinned,0px)+1rem)] laptop:order-3`}>
              {target ? <><h2 className="text-lg font-medium text-ink">{title}</h2>{panel}</>
                : <p className="text-sm text-ink-2">Pick a slot or a player to see their job and expectation here.</p>}
            </aside>}
        <div className="grid min-w-0 gap-4 tablet:col-span-2 laptop:order-2 laptop:col-span-1">
          <section aria-label="Off the pitch" className={`arc ${card}`}>
            <Tabs value={list} onValueChange={value => setList(value as List)}>
              <TabsList aria-label="Off the pitch">
                <TabsTrigger value="bench" {...dropOn('list:bench')} className={lit('list:bench')}>Bench · {bench.length}</TabsTrigger>
                <TabsTrigger value="not_selected" {...dropOn('list:not_selected')} className={lit('list:not_selected')}>Not selected · {leftOut.length}</TabsTrigger>
              </TabsList>
              {/* Both panels stay mounted, so a tab is never mid-animation when a drag lands; the other is hidden. */}
              <TabsContent value="bench" forceMount hidden={list !== 'bench'} {...dropOn('list:bench')} className={`grid gap-3 rounded-xl ${lit('list:bench')}`}>
                {!locked && <p className="text-sm text-ink-3">Drag a player onto a place on the pitch, or onto Not selected to leave them out.</p>}
                {bench.length === 0
                  ? <p className="text-sm text-ink-2">{starters.size + leftOut.length === 0 ? 'Nobody can come yet. Confirm players in Squad › Availability.' : 'Nobody on the bench.'}</p>
                  : faces(bench, 'bench')}
              </TabsContent>
              <TabsContent value="not_selected" forceMount hidden={list !== 'not_selected'} {...dropOn('list:not_selected')} className={`grid gap-3 rounded-xl ${lit('list:not_selected')}`}>
                <p className="text-sm text-ink-3">Their families see “Not in the squad this week”. Each player reads your note.</p>
                {leftOut.length === 0
                  ? <p className="text-sm text-ink-2">{locked ? 'Nobody was left out.' : 'Nobody is left out. Drag a player onto this tab, or pick Not selected in their sheet.'}</p>
                  : faces(leftOut, 'not selected')}
              </TabsContent>
            </Tabs>
          </section>

          {cantMakeIt.length > 0 && <section aria-labelledby="plan-cant" className={card}>
            <h2 id="plan-cant" className="text-lg font-medium text-ink">Can’t make it</h2>
            <p className="text-sm text-ink-3">Their families said they can’t make it, so they can’t be placed.</p>
            <ul className="grid gap-2">{cantMakeIt.map(player => <li key={player.id} className="flex items-center gap-3 px-2 py-1">
              <PlayerFace name={player.name} size="sm" aria-hidden="true" />
              <span className="flex-1 text-base text-ink-2">{player.name}</span>
              <span className="arc"><Badge size="sm" tone="warning">Can’t make it</Badge></span>
            </li>)}</ul>
          </section>}
        </div>
      </div>
    </div>
  )
}
