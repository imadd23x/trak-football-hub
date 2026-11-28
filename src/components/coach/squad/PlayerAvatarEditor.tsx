import { useContext, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import { FaceDrawing, PlayerFaces } from '@/components/trak/PlayerFace'
import { HAIR_COLOURS, HAIR_STYLE_COUNT, hairOf, type HairPick } from '@/lib/player-face'
import { useTranslation } from '@/lib/i18n'
import { useSavePlayerAvatar } from './usePlayerAvatars'

/** In HAIR_STYLE_COUNT's order (the drawing's crop, short and curls). */
const STYLE_WORD = ['coachSquad:hairCrop', 'coachSquad:hairShort', 'coachSquad:hairCurls'] as const
/** In HAIR_COLOURS' order. */
const COLOUR_WORD = ['coachSquad:hairBlack', 'coachSquad:hairDarkBrown', 'coachSquad:hairBrown', 'coachSquad:hairLightBrown', 'coachSquad:hairCharcoal'] as const
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** The hair a player has now, by its position in the lists: the coach's selection, or the one from the name. */
function current(name: string, pick: HairPick | null): HairPick {
  if (pick) return pick
  const hair = hairOf(name)
  return { style: hair.style, colour: HAIR_COLOURS.indexOf(hair.colour) }
}

/**
 * TRAK-617 (Dimos, 27 Nov): the coach selects the avatar a player of theirs has on the coach's screens. It is TRAK-349's
 * drawn face, never a photo (G7): the coach selects only its hair style and colour, from fixed lists; the skin tone is
 * the same for every child (Tarek, 3 Nov), so it is not offered. "Automatic" returns the face from the name. Only the
 * coach sees it; the player's own screens keep the face from their name.
 */
export function PlayerAvatarEditor({ playerId, name, coachId, children }: { playerId: string; name: string; coachId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const saved = useContext(PlayerFaces).get(playerId) ?? null
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<HairPick | null>(saved)
  const save = useSavePlayerAvatar(coachId)
  const first = name.split(' ')[0]
  const shown = current(name, draft)

  const onOpenChange = (next: boolean) => { if (next) setDraft(saved); setOpen(next) }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate({ id: playerId, pick: draft }, {
      onSuccess: () => { toast.success(t('coachSquad:savedAvatar', { name: first })); setOpen(false) },
      onError: () => toast.error(t('coachSquad:couldntSave')),
    })
  }
  const option = (on: boolean) => `rounded-full border-2 transition-colors ${RING} ${on ? 'border-brand' : 'border-line'}`

  return <BottomSheet className="arc" open={open} onOpenChange={onOpenChange} title={t('coachSquad:avatarTitle', { name: first })} description={t('coachSquad:avatarOnlyYou')}
    trigger={<button type="button" aria-label={t('coachSquad:editAvatarOf', { name: first })} title={t('coachSquad:editAvatarOf', { name: first })}
      className={`group relative block rounded-full ${RING}`}>
      {children}
      <span aria-hidden className="absolute -left-1 -top-1 inline-flex size-8 items-center justify-center rounded-full border-2 border-surface bg-ink text-surface shadow-sm group-hover:bg-brand group-hover:text-on-brand">
        <Pencil size={14} strokeWidth={2.25} />
      </span>
    </button>}>
    <form onSubmit={submit} className="grid gap-6 pb-4">
      <span className="relative mx-auto block size-24 rounded-full border-2 border-ink bg-surface" role="img" aria-label={t('coachSquad:avatarPreview', { name: first })}>
        <FaceDrawing name={name} hair={shown} />
      </span>

      <button type="button" aria-pressed={draft === null} onClick={() => setDraft(null)}
        className={`min-h-10 justify-self-center rounded-full border px-3.5 text-sm ${RING} ${draft === null ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`}>
        {t('coachSquad:avatarAutomatic')}
      </button>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t('coachSquad:hairStyle')}</legend>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: HAIR_STYLE_COUNT }, (_, style) => {
            const on = draft !== null && draft.style === style
            return <button key={style} type="button" aria-pressed={on} aria-label={t(STYLE_WORD[style])} title={t(STYLE_WORD[style])}
              onClick={() => setDraft({ style, colour: shown.colour })} className={`relative size-14 bg-surface ${option(on)}`}>
              <FaceDrawing name={name} hair={{ style, colour: shown.colour }} />
            </button>
          })}
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t('coachSquad:hairColour')}</legend>
        <div className="flex flex-wrap gap-3">
          {HAIR_COLOURS.map((colour, index) => {
            const on = draft !== null && draft.colour === index
            return <button key={colour} type="button" aria-pressed={on} aria-label={t(COLOUR_WORD[index])} title={t(COLOUR_WORD[index])}
              onClick={() => setDraft({ style: shown.style, colour: index })} className={`size-11 p-1 ${option(on)}`}>
              <span className="block size-full rounded-full" style={{ background: colour }} />
            </button>
          })}
        </div>
      </fieldset>

      <Button type="submit" disabled={save.isPending}>{save.isPending ? t('coachSchedule:savingDots') : t('common:save')}</Button>
    </form>
  </BottomSheet>
}
