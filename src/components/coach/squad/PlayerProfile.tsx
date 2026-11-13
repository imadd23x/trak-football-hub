import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { RadarChart } from '@/components/arc/radar-chart/radar-chart'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { BandChip, type SquadPlayer } from '@/components/arc/blocks/team-directory/squad-directory'
import { CoachAssessmentCard } from '@/components/coach/CoachAssessmentCard'
import { LoadError } from '@/components/trak/LoadError'
import { ATTRIBUTES } from '@/lib/squad/attributes'
import { bornLine } from '@/lib/squad/format'
import { loadPlayerAssessments } from '@/lib/coach-assessments'
import type { Scores } from '@/lib/squad/season-profile'
import { PlayerFactsEditor } from './PlayerFactsEditor'
import type { PlayerFacts } from './usePlayerFacts'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerObjectivesSection } from '@/components/coach/season-plan/PlayerObjectivesSection'
import { isPosition } from '@/lib/positions'
import { PositionAndRolesSheet } from './PositionAndRolesSheet'
import { usePlayerRoles } from './usePlayerRoles'
import { useTranslation } from '@/lib/i18n'
import { POSITION_WORD } from '@/lib/position-words'
import { ATTRIBUTE_WORD } from '@/lib/squad/attribute-words'
import { ROLE_WORD, TRAIT_WORD, shown } from '@/lib/squad/trait-words'
import { bandConfig } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'

const FOOT = { left: 'coachSquad:footLeft', right: 'coachSquad:footRight', both: 'coachSquad:footBoth' } as const
/** The assessments shown at first, newest first. TRAK-368: "All N" shows the rest here too. */
const SHOWN = 6

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3 border-b border-line py-2.5 last:border-b-0">
    <dt className="text-sm text-ink-3">{label}</dt>
    <dd className="m-0 min-w-0 text-[15px] text-ink">{children}</dd>
  </div>
}

/**
 * TRAK-263 (Imad, 22 Oct): one player's profile in Squad's Players view. Foot, nationality, born and traits (the
 * coach edits all but the date of birth, which is the academy roster's); the season radar against the squad; the
 * coach's assessment card exactly as it is elsewhere. Imad, 23 Oct: one row of cards, the latest first, swiping to
 * earlier ones, with no date line above them (the card's quick look has the date and session).
 */
export function PlayerProfile({ player, squad, coachId, facts, factsFailed, onRetryFacts, season, squadSeason, since = '1 July', seasonFailed = false, onRetrySeason, placement }: {
  player: SquadPlayer
  squad: string | null
  coachId: string
  facts: PlayerFacts | undefined
  factsFailed: boolean
  onRetryFacts: () => void
  season: { scores: Scores; count: number } | undefined
  squadSeason: Scores | null
  /** TRAK-350: when the season started, from the squad's season plan when there is one. */
  since?: string
  /** TRAK-368: the squad's assessments didn't load, so the season can't be told; never "No assessment this season yet". */
  seasonFailed?: boolean
  onRetrySeason?: () => void
  /** TRAK-353, TRAK-354: where the season plan is on, the roster's position; the player's position and roles, and their objectives, show here. */
  placement?: { position: string | null }
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const notSet = <span className="text-ink-3">{t('coachSchedule:notSet')}</span>
  const client = useQueryClient()
  const first = player.name.split(' ')[0]
  const key = ['coach', coachId, 'player-assessments', player.id]
  const assessments = useQuery({ queryKey: key, queryFn: () => loadPlayerAssessments(player.id, coachId), enabled: !player.waiting })
  const list = assessments.data?.list ?? []
  // TRAK-368: the whole history, in place. The address keeps it open, so coming back from an assessment (or a reload)
  // finds the list as it was left.
  const [params, setParams] = useSearchParams()
  const all = params.get('history') === 'all'
  const showAll = (on: boolean) => setParams(current => {
    const next = new URLSearchParams(current)
    if (on) next.set('history', 'all')
    else next.delete('history')
    return next
  }, { replace: true })
  const card = (assessment: (typeof list)[number]) => <CoachAssessmentCard assessment={assessment} playerName={player.name}
    message={assessments.data?.messages[assessment.id]} messageFailed={assessments.data?.sent === undefined} note={assessments.data?.notes[assessment.id]}
    onChanged={() => { void client.invalidateQueries({ queryKey: key }) }} />

  const header = <div className="flex items-center gap-4">
    <PlayerFace name={player.name} size="lg" />
    <div className="grid min-w-0 gap-0.5">
      <h3 className="truncate text-xl font-medium text-ink">{player.name}</h3>
      <p className="text-sm text-ink-2">{[player.shirt != null && `#${player.shirt}`, player.position, squad].filter(Boolean).join(' · ')}</p>
    </div>
    <span className="ml-auto"><BandChip band={player.band} move={player.move} waiting={player.waiting} /></span>
  </div>

  // As everywhere in the coach's app: nothing is recorded about a player still waiting for consent.
  if (player.waiting) return <>{header}<p className="text-sm text-ink-2">{t('coachSquad:waitingConsentBody', { name: first })}</p></>

  return <>
    {header}

    {/* A laptop's pane has room for two columns: facts beside the radar, the latest card beside the earlier ones. */}
    <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] laptop:items-start">
      <div className="grid gap-5">
        {placement && <PositionAndRoles coachId={coachId} id={player.id} name={player.name} position={placement.position} />}
        <section aria-label={t('coachSquad:aboutName', { name: first })} className="grid gap-2">
          {factsFailed ? <LoadError what={t('coachSquad:profileWhat', { name: first })} onRetry={onRetryFacts} />
            : !facts ? <LoadingSkeleton label={t('coachSquad:loadingProfile', { name: first })} />
            : <>
              <dl className="m-0 border-t border-line">
                <Fact label={t('coachSquad:preferredFoot')}>{facts.foot ? t(FOOT[facts.foot]) : notSet}</Fact>
                <Fact label={t('coachSquad:nationality')}>{facts.nationality ?? notSet}</Fact>
                <Fact label={t('coachSquad:born')}>{facts.born ? bornLine(facts.born, new Date()) : notSet}</Fact>
                <Fact label={t('coachSquad:traits')}>{facts.traits.length
                  ? <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t('coachSquad:traitsOf', { name: first })}>
                      {facts.traits.map(trait => <li key={trait} className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-sm text-ink">{shown(TRAIT_WORD, trait)}</li>)}
                    </ul>
                  : <span className="text-ink-3">{t('coachSquad:nonePicked')}</span>}</Fact>
              </dl>
              <span className="justify-self-start"><PlayerFactsEditor playerId={player.id} name={player.name} coachId={coachId} facts={facts} /></span>
            </>}
        </section>
      </div>

      <section aria-labelledby={`season-${player.id}`}>
        <div className="grid gap-0.5">
          <h4 id={`season-${player.id}`} className="text-base font-medium text-ink">{t('coachSquad:seasonSoFar')}</h4>
          {seasonFailed ? <LoadError what={t('coachSquad:seasonWhat', { name: first })} onRetry={onRetrySeason} /> : <p className="text-sm text-ink-3">{season
            ? t('coachSquad:seasonAverage', { count: season.count, since })
            : t('coachSquad:noSeasonAssessment')}</p>}
        </div>
        {season && !seasonFailed && <RadarChart label={t('coachSquad:radarLabel', { name: player.name })} size={240} rings={5} max={10}
          axes={ATTRIBUTES.map(([k]) => ({ key: k, label: t(ATTRIBUTE_WORD[k]) }))}
          series={[{ key: 'player', label: first, values: season.scores }, ...(squadSeason ? [{ key: 'squad', label: t('coachSquad:squadAverage'), values: squadSeason }] : [])]}
          formatValue={value => value.toFixed(1)}
          // TRAK-458: each of the player's points in its band's colour (the band's word is in the cards below).
          pointColor={value => bandConfig(scoreToBand(value)).color} />}
      </section>
    </div>

    {placement && <PlayerObjectivesSection coachId={coachId} id={player.id} name={player.name} position={placement.position} squad={squad} />}

    {assessments.isError ? <LoadError what={t('coachSquad:assessmentsWhat', { name: first })} onRetry={() => { void assessments.refetch() }} />
      : !assessments.data ? <LoadingSkeleton label={t('coachSquad:loadingAssessments', { name: first })} lines={2} rows={2} />
      : <section aria-labelledby={`assessments-${player.id}`} className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h4 id={`assessments-${player.id}`} className="text-base font-medium text-ink">{t('coachSquad:assessments')}</h4>
          {list.length > SHOWN
            ? <button type="button" onClick={() => showAll(!all)} className="text-sm font-medium text-brand">{all ? t('coachSquad:showLatest', { count: SHOWN }) : t('coachSquad:allCount', { count: list.length })}</button>
            : list.length > 1 && <span className="text-sm text-ink-3 [@media(pointer:fine)]:hidden">{t('coachSquad:swipeEarlier')}</span>}
        </div>
        {list.length === 0 ? <p className="text-sm text-ink-2">{t('coachSquad:noAssessmentYet')}</p>
          : all && list.length > SHOWN ? <ol className="m-0 grid list-none gap-3 p-0 laptop:grid-cols-2" aria-label={t('coachSquad:allAssessmentsOf', { name: first })}>
            {list.map(assessment => <li key={assessment.id} className="min-w-0">{card(assessment)}</li>)}
          </ol>
          : <div className="arc">
            {/* As ParentAssessmentCarousel: the viewport is the row, so 88% is of what's visible and the next card peeks in. */}
            {/* Imad, 24 Oct: room above and below, so a card lifted on hover keeps its edge and shadow; firm snapping only
                under a finger: on a trackpad or wheel any snapping pulled the row back mid-swipe. */}
            <ScrollArea orientation="horizontal" snap="x mandatory" fade={0} label={t('coachSquad:assessmentsOf', { name: first })} className="-mt-2 -mb-4" viewportClassName="flex gap-3 pt-2 pb-4">
              {list.slice(0, SHOWN).map((assessment, index) => <div key={assessment.id} role="group" aria-label={t('coachSquad:assessmentNofM', { n: index + 1, total: Math.min(list.length, SHOWN) })}
                className="min-w-0 basis-[88%] laptop:basis-[calc(50%-6px)] shrink-0 grow-0" style={{ scrollSnapAlign: 'start' }}>
                {card(assessment)}
              </div>)}
            </ScrollArea>
          </div>}
      </section>}

    <button type="button" onClick={() => navigate('/coach/assess', { state: { preselectedPlayerId: player.id } })}
      className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-brand">
      {t('coachSquad:assessName', { name: first })} <ArrowRight size={16} aria-hidden />
    </button>
  </>
}

/** TRAK-353: the player's main position, roles and Can also play, with one Edit for all three (the mockup's profile). */
function PositionAndRoles({ coachId, id, name, position }: { coachId: string; id: string; name: string; position: string | null }) {
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()
  const roles = usePlayerRoles(coachId)
  const first = name.split(' ')[0]
  const { also, roles: held } = roles.of(id)
  return <section aria-labelledby={`position-${id}`} className="grid gap-2">
    <div className="flex items-baseline justify-between gap-3">
      <h4 id={`position-${id}`} className="text-base font-medium text-ink">{t('coachSquad:positionAndRoles')}</h4>
      <button type="button" onClick={() => setEditing(true)} aria-label={t('coachSquad:editPositionRoles', { name: first })} aria-haspopup="dialog"
        className="min-h-11 rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('coachSchedule:edit')}</button>
    </div>
    {roles.isError ? <LoadError what={t('coachSquad:rolesWhat', { name: first })} onRetry={() => { void roles.refetch() }} />
      : !roles.data ? <LoadingSkeleton label={t('coachSquad:loadingRoles', { name: first })} lines={2} />
      : <dl className="m-0 border-t border-line">
        <Fact label={t('coachSquad:mainPosition')}>{isPosition(position) ? t(POSITION_WORD[position]) : <span className="text-ink-3">{t('coachSquad:noPositionYet')}</span>}</Fact>
        <Fact label={t('coachSquad:roles')}>{held.length ? held.map(role => shown(ROLE_WORD, role)).join(', ') : <span className="text-ink-3">{t('coachSquad:noRoleYet')}</span>}</Fact>
        <Fact label={t('coachSquad:canAlsoPlay')}>{also.length ? also.map(p => t(POSITION_WORD[p])).join(', ') : <span className="text-ink-3">{t('coachSquad:noneYet')}</span>}</Fact>
      </dl>}
    <PositionAndRolesSheet coachId={coachId} player={{ id, name, position }} open={editing} onOpenChange={setEditing} saveNeedsChange
      onSaved={() => setEditing(false)} />
  </section>
}
