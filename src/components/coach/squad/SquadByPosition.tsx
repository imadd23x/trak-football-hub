import { useState, type ReactNode } from 'react'
import { FaceDrawing } from '@/components/trak/PlayerFace'
import { CARD, FOCUS, PILL, SectionHeading } from '@/components/coach/pitch-ready'
import { squadByPosition, type ClusterKey } from '@/lib/squad/by-position'
import { useTranslation } from '@/lib/i18n'

type Player = { id: string; player_name: string; position: string | null; shirt_number: number | null }

const CLUSTER = {
  GK: { word: 'coachSquad:groupGK', bar: 'bg-attention' },
  DEF: { word: 'coachSquad:groupDEF', bar: 'bg-info' },
  MID: { word: 'coachSquad:groupMID', bar: 'bg-pitch' },
  ATT: { word: 'coachSquad:groupATT', bar: 'bg-brand' },
  NONE: { word: 'coachSquad:noPositionYet', bar: 'bg-warning' },
  WAITING: { word: 'coachSquad:waitingForConsent', bar: 'bg-line' },
} as const satisfies Record<ClusterKey, { word: string; bar: string }>
const FILTERS = [
  { key: 'GK', short: 'coachSquad:filterGK' }, { key: 'DEF', short: 'coachSquad:filterDEF' },
  { key: 'MID', short: 'coachSquad:filterMID' }, { key: 'ATT', short: 'coachSquad:filterATT' },
] as const satisfies readonly { key: ClusterKey; short: string }[]

/**
 * The Squad page in the season plan's pitch-ready look (/coach/season-plan, PR #781): the players clustered by
 * position, GK to ATT, each cluster under the season plan's barred heading in its own card, with the season plan's
 * position pills on top. A player shows only their face and shirt number (the face is Trak's drawing, never a photo:
 * G7); their name is the tile's accessible name and its tooltip, and a state tag, where they have one, sits on the face.
 * Tapping a player opens their page.
 */
export function SquadByPosition({ players, waiting, flags, onOpen }: {
  players: Player[]
  waiting: Set<string>
  /** A player's state tag (Watching, Due, Draft: TRAK-266, TRAK-355, UC-C03), on their face; most players have none. */
  flags?: Map<string, ReactNode>
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const [unit, setUnit] = useState<'ALL' | ClusterKey>('ALL')
  const groups = squadByPosition(players, waiting)
  const countOf = (key: ClusterKey) => groups.find(g => g.key === key)?.players.length ?? 0
  const shown = groups.filter(g => unit === 'ALL' || g.key === unit)

  return <div className="grid gap-6 pt-2 sm:gap-7">
    <div role="group" aria-label={t('coachSquad:filterByPosition')} className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={unit === 'ALL'} className={PILL(unit === 'ALL')} onClick={() => setUnit('ALL')}>
        {t('coachSquad:filterAll').toUpperCase()}: {players.length}
      </button>
      {FILTERS.map(({ key, short }) => <button key={key} type="button" aria-pressed={unit === key} className={PILL(unit === key)} onClick={() => setUnit(key)}
        aria-label={`${t(CLUSTER[key].word)}: ${countOf(key)}`}>
        {t(short)}: {countOf(key)}
      </button>)}
    </div>

    {/* As the season plan's Squad readiness: two cards side by side on a wide screen. */}
    {shown.length === 0 ? <p className={`${CARD} p-5 text-base font-semibold text-ink-2`}>{t('coachSquad:noOneMatches')}</p>
      : <div className="grid grid-cols-1 items-start gap-6 sm:gap-7 xl:grid-cols-2">{shown.map(group => {
        const id = `squad-cluster-${group.key}`
        return <section key={group.key} aria-labelledby={id} className="grid gap-3.5">
          <SectionHeading id={id} bar={CLUSTER[group.key].bar}>
            {t(CLUSTER[group.key].word)} <span className="text-ink-3">· {group.players.length}</span>
          </SectionHeading>
          <ul aria-label={t(CLUSTER[group.key].word)}
            className={`${CARD} m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-x-3 gap-y-5 p-4 sm:p-6`}>
            {group.players.map(p => <li key={p.id} className="flex justify-center">
              <button type="button" title={p.player_name} onClick={() => onOpen(p.id)}
                aria-label={p.shirt_number != null ? t('coachSquad:playerTile', { name: p.player_name, shirt: p.shirt_number })
                  : t('coachSquad:playerTileNoShirt', { name: p.player_name })}
                className={`group grid justify-items-center gap-2 rounded-xl p-1 transition-transform hover:scale-105 ${FOCUS} ${group.key === 'WAITING' ? 'opacity-60' : ''}`}>
                <span className="relative block size-16 rounded-full border-2 border-line bg-surface shadow-sm transition-colors group-hover:border-ink sm:size-[72px]">
                  <FaceDrawing name={p.player_name} playerId={p.id} />
                  {flags?.get(p.id) && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap [&>*]:shadow-sm">{flags.get(p.id)}</span>}
                </span>
                <span aria-hidden="true"
                  className="min-w-9 rounded-lg border-2 border-ink bg-brand px-2 py-0.5 text-center text-sm font-black tabular-nums text-on-brand">
                  {p.shirt_number ?? '–'}
                </span>
              </button>
            </li>)}
          </ul>
        </section>
      })}</div>}
  </div>
}
