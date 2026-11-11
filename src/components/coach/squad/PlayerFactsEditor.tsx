import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import { NATIONALITIES } from '@/lib/constants'
import { PLAYER_TRAIT_GROUPS, toggleTrait, type PreferredFoot } from '@/lib/player-traits'
import { useSavePlayerFacts, type PlayerFacts } from './usePlayerFacts'
import { useTranslation } from '@/lib/i18n'
import { TRAIT_GROUP_WORD, TRAIT_WORD, shown } from '@/lib/squad/trait-words'

const FEET = [
  { value: null, label: 'coachSchedule:notSet' }, { value: 'left', label: 'coachSquad:footLeft' }, { value: 'right', label: 'coachSquad:footRight' }, { value: 'both', label: 'coachSquad:footBoth' },
] as const satisfies readonly { value: PreferredFoot | null; label: string }[]
const pill = (on: boolean) =>
  `min-h-10 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`

/** TRAK-263 (Imad, 22 Oct): the coach sets a player's foot, nationality and traits, from fixed lists only, so nothing
 *  free-text is written about a player. Picking one of an opposite pair unpicks the other. Only the coach sees it. */
export function PlayerFactsEditor({ playerId, name, coachId, facts }: { playerId: string; name: string; coachId: string; facts: PlayerFacts }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const [draft, setDraft] = useState(facts)
  const save = useSavePlayerFacts(coachId)
  const first = name.split(' ')[0]

  const onOpenChange = (next: boolean) => { if (next) setDraft(facts); setOpen(next) }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ id: playerId, foot: draft.foot, nationality: draft.nationality, traits: draft.traits }, {
      onSuccess: () => { toast.success(t('coachSquad:savedProfile', { name: first })); setOpen(false) },
      onError: () => toast.error(t('coachSquad:couldntSave')),
    })
  }

  return <BottomSheet className="arc" open={open} onOpenChange={onOpenChange} title={t('coachSquad:profileTitle', { name: first })} description={t('coachSquad:onlyYou')}
    trigger={<button type="button" className="min-h-11 text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">{t('coachSquad:editProfile')}</button>}>
    <form onSubmit={submit} className="grid gap-6 pb-4">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t('coachSquad:preferredFoot')}</legend>
        <div className="flex flex-wrap gap-2">
          {FEET.map(foot => <button key={foot.label} type="button" aria-pressed={draft.foot === foot.value} className={pill(draft.foot === foot.value)}
            onClick={() => setDraft(d => ({ ...d, foot: foot.value }))}>{t(foot.label)}</button>)}
        </div>
      </fieldset>

      <label className="grid gap-2">
        <span className="text-sm font-medium text-ink">{t('coachSquad:nationality')}</span>
        <select value={draft.nationality ?? ''} onChange={e => setDraft(d => ({ ...d, nationality: e.target.value || null }))}
          className="min-h-11 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <option value="">{t('coachSchedule:notSet')}</option>
          {NATIONALITIES.map(nation => <option key={nation} value={nation}>{nation}</option>)}
        </select>
      </label>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-medium text-ink">{t('coachSquad:traits')} <span className="font-normal text-ink-3">{t('coachSquad:pickedCount', { count: draft.traits.length })}</span></legend>
        {PLAYER_TRAIT_GROUPS.map(({ group, traits }) => <div key={group} role="group" aria-label={shown(TRAIT_GROUP_WORD, group)} className="grid gap-2">
          <p className="text-sm text-ink-3">{shown(TRAIT_GROUP_WORD, group)}</p>
          <div className="flex flex-wrap gap-2">
            {traits.map(trait => <button key={trait} type="button" aria-pressed={draft.traits.includes(trait)} className={pill(draft.traits.includes(trait))}
              onClick={() => setDraft(d => ({ ...d, traits: toggleTrait(d.traits, trait) }))}>{shown(TRAIT_WORD, trait)}</button>)}
          </div>
        </div>)}
      </fieldset>

      <Button type="submit" disabled={save.isPending}>{save.isPending ? t('coachSchedule:savingDots') : t('common:save')}</Button>
    </form>
  </BottomSheet>
}
