import { i18n, useTranslation } from '@/lib/i18n'
import { lineWord, positionsShown } from '@/lib/position-words'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useFeatureState } from '@/components/trak/parked'
import { DEFAULT_FORMATION, FORMATIONS, FORMATS, lineName, slotsOf } from '@/lib/games/formations'
import { fitFormat, followPosition, moveTo, playerPlan, type LineUpDrop, type PlayerPlan, type PlayerPlans } from '@/lib/games/lineup'
import type { PlanForm } from '@/lib/games/plan'
import { fitOf, slotPosition } from '@/lib/squad/formation-board'
import { useIsMobile } from '@/hooks/use-mobile'
import { usePlayerRoles } from '@/components/coach/squad/usePlayerRoles'
import { DragGhost } from '@/components/coach/squad/formations/FormationBoard'
import { usePointerSwap } from '@/components/coach/squad/formations/usePointerSwap'
import type { Candidate, useWhoCanCome } from './useGames'
import { ListFace, MarkersKey, Pitch, type LineUpSpot, type PitchPlayer } from './Pitch'
import { PlayerPanel, type Target } from './PlayerPanel'
import { LoadError } from '@/components/trak'
import { Alert } from '@/components/arc/alert/alert'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { MorphSelect } from '@/components/arc/morph-select/morph-select'
import { shapeItems } from '@/lib/games/shape-items'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-285 (Games 3/8): plan step 2, line-up and jobs (TRAK-282; the mockup's Squad step merged in, Imad 27 Oct).    coach picks a format and a formation, places players who can come, and gives each a job and a note. Off the pitch,
   a player is on the bench unless the coach leaves them out (Imad, 28 Oct). The sheet is a bottom sheet on a phone,
   and a panel beside the pitch on a tablet or laptop, where the pitch stays in view. TRAK-287: locked at kick-off, the
   pitch and the sheet only show what was planned. TRAK-329 (Imad, 2 Nov): format and formation are one Arc morph
   select on the pitch's top left, a header per format, so a shape in another format switches the format.
   TRAK-358 (Season plan 10/18, spec TRAK-348): Formations' pitch, with Bench and Not selected as tabs beside it
   (under it on a tablet and a phone). A player drags onto a place, a face or a tab; tapping a place still picks who
   plays there, and tapping a face opens their sheet. Placed outside their position and Can also play, a player gets
   Out of position ticked; moved back, it goes, unless the coach ticked it. Everyone's job went: the faces carry the
   markers, and Review & share counts the starters with a job. TRAK-359 (Tarek, 3 Nov): a third tab, Not attending.
   Everyone is coming unless they're there. A family's "Can't make it" puts the child there, flagged, and the database
   keeps them there until the family undoes it; a report that comes after the coach placed them only flags them. */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
/** A tab's name with its count under it, so three tabs fit the card on a phone and beside the pitch. The name is still
 *  "Bench · 6" to a screen reader. */
const TabLabel = ({ name, count }: { name: string; count: number }) =>
  <span className="grid justify-items-center leading-tight"><span>{name} </span><span className="text-xs">· {count}</span></span>
type List = 'bench' | 'not_selected' | 'not_attending'
const LISTS = { 'list:bench': 'bench', 'list:not_selected': 'not_selected', 'list:not_attending': 'not_attending' } as const

/** TRAK-360: the formation last copied into this match, and how many of its starters weren't coming or were skipped. */
export type FormationCopy = { name: string; format: number | null; notComing: number; skipped: number; byDefault: boolean }

export function LineUpAndJobs({ form, onFormChange, who, locked = false, copy = null }: {
  form: PlanForm; onFormChange: (form: PlanForm) => void; who: ReturnType<typeof useWhoCanCome>; locked?: boolean; copy?: FormationCopy | null
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  // TRAK-358: Can also play, so a placement outside it ticks Out of position.
  const roles = usePlayerRoles(user?.id)
  const phone = useIsMobile()
  const seasonPlan = useFeatureState('season_plan')
  const [target, setTarget] = useState<Target | null>(null)
  const [list, setList] = useState<List>('bench')
  const shape = form.formation ?? DEFAULT_FORMATION[form.format]
  const plan = (player: Candidate) => playerPlan(form.players, player.id)
  const familyReported = (id: string) => playerPlan(form.players, id).role === 'not_attending' && !!who.players.find(player => player.id === id)?.absent
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
    // The database keeps a family-reported child in Not attending, so a drag doesn't try.
    if (!id || locked || familyReported(id)) return
    const where: LineUpDrop = to.startsWith('slot:') ? { kind: 'slot', slot: Number(to.slice(5)) }
      : to.startsWith('player:') ? { kind: 'player', id: to.slice(7) } : { kind: 'list', role: LISTS[to as keyof typeof LISTS] ?? 'bench' }
    const next = moveTo(form.players, id, where)
    if (next === form.players) return
    setPlayers(next)
    // Beside the pitch, the sheet follows the player just moved, as picking them for a place does.
    if (!phone) setTarget({ kind: 'player', id })
  })
  const drag = locked ? null : swap

  if (who.error || roles.isError) return <LoadError what={t('coachMatches:whoCanComeWhat')} onRetry={() => { who.retry(); void roles.refetch() }} />
  if (who.isPending || roles.isPending) return <LoadingSkeleton label={t('coachMatches:loadingWhoCanCome')} lines={1} avatar rows={4} className="pt-6" />

  const starters = new Map<number, PitchPlayer>()
  for (const player of who.players) {
    const { role, slot } = plan(player)
    if (role === 'starter' && slot != null && slot <= form.format) starters.set(slot, { ...player, plan: plan(player) })
  }
  const placed = new Set([...starters.values()].map(player => player.id))
  // Everyone is coming unless they're in Not attending, and on the bench unless they're on the pitch or left out. A
  // family's "Can't make it" is a flag on the face, wherever the child is.
  const bench = who.players.filter(player => !['not_selected', 'not_attending'].includes(plan(player).role) && !placed.has(player.id))
  const leftOut = who.players.filter(player => plan(player).role === 'not_selected')
  const notComing = who.players.filter(player => plan(player).role === 'not_attending')
  const title = target?.kind === 'slot' ? t('coachMatches:slotTitle', { line: lineWord(lineName(shape, target.slot)), slot: target.slot })
    : who.players.find(player => target && player.id === target.id)?.name ?? t('nav:player')
  const panel = target && <PlayerPanel target={target} players={form.players} onPlayers={setPlayers} candidates={who.players}
    shape={shape} onTarget={setTarget} locked={locked} />
  const open = (player: Candidate) => setTarget({ kind: 'player', id: player.id })
  const opened = (player: Candidate) => target?.kind === 'player' && target.id === player.id
  const detail = (player: Candidate) => `${player.shirt != null ? `#${player.shirt} · ` : ''}${positionsShown(player.position, roles.of(player.id).also)}`
  const faces = (players: Candidate[], words: 'bench' | 'not selected' | 'not attending') =>
    <ul role="group" aria-label={words === 'bench' ? t('coachSquad:fmBench') : words === 'not selected' ? t('coachMatches:notSelected') : t('coachMatches:notAttending')} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 p-0">
      {players.map(player => <li key={player.id}>
        <ListFace player={player} plan={plan(player)} list={words} detail={detail(player)} on={opened(player)} onOpen={() => open(player)} swap={drag} />
      </li>)}
    </ul>
  // While a drag is over a tab or its panel, it lights up; each is a drop target until kick-off.
  const dropOn = (spot: LineUpSpot) => (drag ? { 'data-spot': spot } : {})
  const lit = (spot: LineUpSpot) => (drag?.drag?.over === spot ? 'ring-2 ring-brand' : '')

  return (
    <div className="grid gap-4">
      {copy && <div className="arc"><Alert tone="info" title={copy.byDefault ? t('coachMatches:copyLoaded', { name: copy.name, count: copy.format ?? form.format }) : t('coachMatches:copiedFrom', { name: copy.name })}>
        {[copy.notComing > 0 && t('coachMatches:copyNotComing', { count: copy.notComing }),
          copy.skipped > 0 && t('coachMatches:copySkipped', { count: copy.skipped }),
          t('coachMatches:copyChange')].filter(Boolean).join(' ')}</Alert></div>}
      {/* TRAK-323 (Imad, 30 Oct): on a laptop the pitch, the tabs and the selected player's sheet sit side by side, the
          pitch and the sheet staying in view; on a tablet the tabs go under them. TRAK-358: only a laptop pins them, as
          on a tablet the tabs below would scroll under the pinned pitch (and a drop there would land on the tabs). The
          pitch card holds only the picker and the pitch, capped to the screen's height, so pinned under the match
          header's tabs (Imad, 6 Nov) it still fits above the bottom bar; the hint and the key sit over the tabs. The
          20rem is the gap under the header, the card's padding and picker row, the Back and Next bar below, and slack:
          a sticky card rides up with the bottom of its row, so a shorter card stays pinned for longer (CI's fonts run
          a few pixels shorter than a Mac's). */}
      <div className="grid gap-4 tablet:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] tablet:items-start laptop:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <section aria-labelledby="plan-pitch" className={`${card} laptop:sticky laptop:top-[calc(var(--ph-pinned,0px)+1rem)]`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plan-pitch" className={locked ? 'text-lg font-medium text-ink' : 'sr-only'}>{shape}</h2>
            {!locked && <span className="arc"><MorphSelect label={t('coachHome:formation')} hideLabel items={shapeItems()} value={shape} onValueChange={setShape}
              searchable={false} panelWidth={200} /></span>}
            <span className="text-sm text-ink-3">{t('coachMatches:attackingUp')}</span>
          </div>
          <Pitch shape={shape} format={form.format} starters={starters} swap={drag} className="laptop:max-w-[min(460px,calc((100dvh_-_var(--ph-pinned,0px)_-_20rem)*0.8))]"
            selected={target?.kind === 'slot' ? target.slot : target ? playerPlan(form.players, target.id).slot : null}
            onSelect={slot => setTarget(starters.has(slot) ? { kind: 'player', id: starters.get(slot)!.id } : { kind: 'slot', slot })} />
          <DragGhost drag={drag?.drag ?? null} />
        </section>
        {phone
          ? <BottomSheet className="arc" open={!!target} onOpenChange={next => { if (!next) setTarget(null) }} title={title} detents={[0.6, 0.92]}>{panel}</BottomSheet>
          : <aside aria-label={target ? title : t('coachMatches:selectedPlayer')} className={`${card} laptop:sticky laptop:top-[calc(var(--ph-pinned,0px)+1rem)] laptop:order-3`}>
              {target ? <><h2 className="text-lg font-medium text-ink">{title}</h2>{panel}</>
                : <p className="text-sm text-ink-2">{t('coachMatches:pickSlotHint')}</p>}
            </aside>}
        <div className="grid min-w-0 gap-4 tablet:col-span-2 laptop:order-2 laptop:col-span-1">
          <section aria-label={t('coachMatches:offThePitch')} className={`arc ${card}`}>
            <div className="grid gap-3">
              <p className="text-sm text-ink-3">{locked ? t('coachMatches:tapToSeeJob')
                : t('coachMatches:dragHint')}</p>
              <MarkersKey />
            </div>
            {/* min-w-0: three tabs are wider than a phone's card, and the tab list scrolls within it rather than the page. */}
            <Tabs className="min-w-0" value={list} onValueChange={value => setList(value as List)}>
              <TabsList aria-label={t('coachMatches:offThePitch')}>
                <TabsTrigger value="bench" {...dropOn('list:bench')} className={`!min-w-0 !px-2 laptop:!px-1 laptop:!text-[13px] ${lit('list:bench')}`}><TabLabel name={t('coachSquad:fmBench')} count={bench.length} /></TabsTrigger>
                <TabsTrigger value="not_selected" {...dropOn('list:not_selected')} className={`!min-w-0 !px-2 laptop:!px-1 laptop:!text-[13px] ${lit('list:not_selected')}`}><TabLabel name={t('coachMatches:notSelected')} count={leftOut.length} /></TabsTrigger>
                <TabsTrigger value="not_attending" {...dropOn('list:not_attending')} className={`!min-w-0 !px-2 laptop:!px-1 laptop:!text-[13px] ${lit('list:not_attending')}`}><TabLabel name={t('coachMatches:notAttending')} count={notComing.length} /></TabsTrigger>
              </TabsList>
              {/* Both panels stay mounted, so a tab is never mid-animation when a drag lands; the other is hidden. The grid
                  is inside each panel: a display class on the panel itself would override `hidden` and show both. */}
              <TabsContent value="bench" forceMount hidden={list !== 'bench'} {...dropOn('list:bench')} className={`rounded-xl ${lit('list:bench')}`}>
                <div className="grid gap-3">
                {!locked && <p className="text-sm text-ink-3">{t('coachMatches:benchHint')}</p>}
                {bench.length === 0
                  ? <p className="text-sm text-ink-2">{starters.size + leftOut.length + notComing.length > 0 ? t('coachMatches:nobodyBench')
                    : seasonPlan.on ? t('coachMatches:nobodySquad') : t('coachMatches:nobodyCanCome')}</p>
                  : faces(bench, 'bench')}
                </div>
              </TabsContent>
              <TabsContent value="not_selected" forceMount hidden={list !== 'not_selected'} {...dropOn('list:not_selected')} className={`rounded-xl ${lit('list:not_selected')}`}>
                <div className="grid gap-3">
                <p className="text-sm text-ink-3">{t('coachMatches:notSelectedNote')}</p>
                {leftOut.length === 0
                  ? <p className="text-sm text-ink-2">{locked ? t('coachMatches:nobodyLeftOutLocked') : t('coachMatches:nobodyLeftOut')}</p>
                  : faces(leftOut, 'not selected')}
                </div>
              </TabsContent>
              <TabsContent value="not_attending" forceMount hidden={list !== 'not_attending'} {...dropOn('list:not_attending')} className={`rounded-xl ${lit('list:not_attending')}`}>
                <div className="grid gap-3">
                <p className="text-sm text-ink-3">{t('coachMatches:notAttendingNote')}</p>
                {notComing.length === 0
                  ? <p className="text-sm text-ink-2">{locked ? t('coachMatches:nobodyMarked') : t('coachMatches:everyoneComing')}</p>
                  : faces(notComing, 'not attending')}
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </div>
  )
}
