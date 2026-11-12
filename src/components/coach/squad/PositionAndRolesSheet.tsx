import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/arc/alert/alert'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import type { WatchAction } from '@/components/coach/season-plan/WatchFirst'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { POSITIONS, ROLES, isPosition, ownRoles, pickMain, roleGroups, toggleAlso, type Position } from '@/lib/positions'
import { usePlayerRoles, usePositionHistory, useSavePositionAndRoles, type PlayerRoles } from './usePlayerRoles'
import { currentLanguage, useTranslation } from '@/lib/i18n'
import { POSITION_WORD } from '@/lib/position-words'
import { ROLE_HEADING_WORD, ROLE_WORD, shown } from '@/lib/squad/trait-words'

/* TRAK-353 (Season plan 5/18, spec TRAK-348): one panel for a player's main position, roles and Can also play, opened
   from a name in the Positions step and from the player's page (Tarek, 5 Nov: a bottom sheet, like Edit profile).
   Roles group under the positions the player plays, then Yours: the coach's own, which show for all their players.
   Can also play is up to two; a third is refused with the reason. One Save writes it all. A role the coach writes is
   free text, so it stays theirs: never shown to families. */

const ROLE_LENGTH = 60
const ROLE_COUNT = 30
const PRESETS = Object.values(ROLES).flat()
const pill = (on: boolean) =>
  `min-h-10 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`
const same = (a: string[], b: string[]) => [...a].sort().join('|') === [...b].sort().join('|')
const when = (at: string) => new Date(at).toLocaleDateString(currentLanguage() === 'en' ? 'en-GB' : currentLanguage(), { day: 'numeric', month: 'short', year: 'numeric' })

export type SheetPlayer = { id: string; name: string; position: string | null }

export function PositionAndRolesSheet({ coachId, player, open, onOpenChange, saveLabel, saveNeedsChange = false, quiet = false, onSaved, watch }: {
  coachId: string
  player: SheetPlayer
  open: boolean
  onOpenChange: (open: boolean) => void
  saveLabel?: string
  /** The player's page: Save waits for a change. In Positions, Save · next moves on either way. */
  saveNeedsChange?: boolean
  /** In Positions the next player opening says it saved; elsewhere a toast does. */
  quiet?: boolean
  onSaved: () => void
  /** TRAK-355: in a set-up step, Watch first (or Keep watching) instead of setting them up now. */
  watch?: WatchAction
}) {
  const roles = usePlayerRoles(coachId, open)
  const { t } = useTranslation()
  const first = player.name.split(' ')[0]
  return <BottomSheet className="arc" open={open} onOpenChange={onOpenChange} title={t('coachSquad:sheetTitle', { name: first })} description={t('coachSquad:onlyYou')} initialDetent={1}>
    {roles.isError ? <LoadError what={t('coachSquad:rolesWhat', { name: first })} onRetry={() => { void roles.refetch() }} />
      : !roles.data ? <LoadingSkeleton label={t('coachSquad:loadingRoles', { name: first })} lines={3} />
      // Keyed by player, so Save · next starts the next one fresh.
      : <Panel key={player.id} coachId={coachId} player={player} first={first} saved={roles.of(player.id)} own={ownRoles(roles.held)}
        saveLabel={saveLabel ?? t('common:save')} saveNeedsChange={saveNeedsChange} quiet={quiet} onSaved={onSaved} watch={watch} onCancel={() => onOpenChange(false)} />}
  </BottomSheet>
}

function Panel({ coachId, player, first, saved, own, saveLabel, saveNeedsChange, quiet, onSaved, watch, onCancel }: {
  coachId: string; player: SheetPlayer; first: string; saved: PlayerRoles; own: string[]
  saveLabel: string; saveNeedsChange: boolean; quiet: boolean; onSaved: () => void; watch?: WatchAction; onCancel: () => void
}) {
  const { t } = useTranslation()
  const placed = isPosition(player.position) ? player.position : null
  const [main, setMain] = useState<Position | null>(placed)
  const [also, setAlso] = useState<Position[]>(saved.also)
  const [chosen, setChosen] = useState<string[]>(saved.roles)
  const [refused, setRefused] = useState(false)
  const [writing, setWriting] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const save = useSavePositionAndRoles(coachId)
  const history = usePositionHistory(coachId, player.id, true)
  const groups = roleGroups(main, also, chosen, own)
  const changed = main !== placed || !same(also, saved.also) || !same(chosen, saved.roles)
  const tooMany = chosen.length > ROLE_COUNT

  const toggleRole = (role: string) => setChosen(list => (list.includes(role) ? list.filter(r => r !== role) : [...list, role]))
  // A role written the way an existing one is spelt picks that one, so nobody holds "winger" beside "Winger".
  const addOwn = () => {
    const text = (writing ?? '').trim().replace(/\s+/g, ' ')
    setWriting(null)
    if (!text) return
    const role = [...PRESETS, ...own, ...chosen].find(r => r.toLowerCase() === text.toLowerCase()) ?? text
    setChosen(list => (list.includes(role) ? list : [...list, role]))
  }
  const onOwnKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); addOwn() } }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!main || tooMany) return
    if (!changed) { onSaved(); return }
    setFailed(false)
    save.mutate({ id: player.id, position: main, also, roles: chosen }, {
      onSuccess: () => { if (!quiet) toast.success(t('coachSquad:savedPositionRoles', { name: first })); onSaved() },
      onError: () => setFailed(true),
    })
  }

  const createOwn = writing === null
    ? <button type="button" onClick={() => setWriting('')} className={`${pill(false)} border-dashed text-brand`}>{t('coachSquad:createOwn')}</button>
    : <span className="flex items-center gap-2">
      {/* It opens on the coach's own tap, to be typed in. */}
      <input autoFocus aria-label={t('coachSquad:yourOwnRole')} maxLength={ROLE_LENGTH} value={writing} onChange={e => setWriting(e.target.value)} onKeyDown={onOwnKey}
        placeholder={t('coachSquad:yourOwnRole')} className="min-h-10 w-48 rounded-full border border-line bg-surface px-3.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      <button type="button" onClick={addOwn} className={pill(false)}>{t('coachSquad:add')}</button>
    </span>

  return <form onSubmit={submit} className="grid gap-6 pb-4">
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{t('coachSquad:mainPosition')}</legend>
      <div className="flex flex-wrap gap-2">
        {POSITIONS.map(p => <button key={p.value} type="button" aria-pressed={main === p.value} className={pill(main === p.value)}
          onClick={() => { setMain(p.value); setAlso(list => pickMain(p.value, list)); setRefused(false) }}>{t(POSITION_WORD[p.value])}</button>)}
      </div>
    </fieldset>

    {!main ? <p className="text-sm text-ink-2">{t('coachSquad:pickMainFirst', { name: first })}</p> : <>
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-medium text-ink">{t('coachSquad:playerRoles')} <span className="font-normal text-ink-3">{t('coachSquad:pickedCount', { count: chosen.length })}</span></legend>
        <p className="-mt-2 text-sm text-ink-3">{t('coachSquad:howTheyPlay')}</p>
        {groups.map((group, index) => <div key={group.heading} role="group" aria-label={shown(ROLE_HEADING_WORD, group.heading)} className="grid gap-2">
          <p className="text-sm text-ink-3">{shown(ROLE_HEADING_WORD, group.heading)}</p>
          <div className="flex flex-wrap gap-2">
            {group.roles.map(role => <button key={role} type="button" aria-pressed={chosen.includes(role)} className={pill(chosen.includes(role))}
              onClick={() => toggleRole(role)}>{shown(ROLE_WORD, role)}</button>)}
            {index === groups.length - 1 && createOwn}
          </div>
        </div>)}
        {tooMany && <p className="text-sm text-danger">{t('coachSquad:upToRoles', { count: ROLE_COUNT })}</p>}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t('coachSquad:canAlsoPlay')} <span className="font-normal text-ink-3">{t('coachSquad:upTo2')}</span></legend>
        <p className="-mt-1 text-sm text-ink-3">{t('coachSquad:coverNote')}</p>
        <div className="flex flex-wrap gap-2">
          {POSITIONS.filter(p => p.value !== main).map(p => {
            const on = also.includes(p.value), full = !on && also.length >= 2
            return <button key={p.value} type="button" aria-pressed={on} aria-disabled={full || undefined} className={`${pill(on)} ${full ? 'opacity-60' : ''}`}
              onClick={() => { const next = toggleAlso(also, p.value, main); setAlso(next.also); setRefused(next.refused) }}>{t(POSITION_WORD[p.value])}</button>
          })}
        </div>
        <p role="status" className="min-h-5 text-sm text-ink-2">{refused ? t('coachSquad:upToTwoRefused') : ''}</p>
      </fieldset>
    </>}

    <section aria-labelledby={`history-${player.id}`} className="grid gap-2 rounded-xl bg-raised p-4">
      <h3 id={`history-${player.id}`} className="text-sm font-medium text-ink">{t('coachSquad:positionOverTime')}</h3>
      {history.isError ? <LoadError what={t('coachSquad:historyWhat', { name: first })} onRetry={() => { void history.refetch() }} />
        : !history.data ? <LoadingSkeleton label={t('coachSquad:loadingHistory', { name: first })} lines={1} />
        : history.data.length === 0 ? <p className="text-sm text-ink-3">{t('coachSquad:noChangeYet')}</p>
        : <ol className="m-0 grid list-none gap-2 p-0">
          {history.data.map((change, index) => <li key={`${change.at}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm font-medium text-ink">{isPosition(change.to) ? t(POSITION_WORD[change.to]) : change.to}</span>
            <span className="text-sm text-ink-3">{change.from ? t('coachSquad:fromPosition', { position: isPosition(change.from) ? t(POSITION_WORD[change.from]) : change.from }) : t('coachSquad:firstPlaced')} · {when(change.at)}</span>
          </li>)}
        </ol>}
    </section>

    {failed && <Alert tone="danger" title={t('coachSquad:couldntSave')} />}
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Button type="button" variant="ghost" onClick={onCancel}>{t('coachSchedule:cancel')}</Button>
      {watch && <Button type="button" variant="secondary" loading={watch.pending} onClick={watch.onWatch}>{watch.label === 'Watch first' ? t('coachSquad:watchFirst') : t('coachSquad:keepWatching')}</Button>}
      <Button type="submit" disabled={!main || tooMany || (saveNeedsChange && !changed)} loading={save.isPending}>{saveLabel}</Button>
    </div>
  </form>
}
