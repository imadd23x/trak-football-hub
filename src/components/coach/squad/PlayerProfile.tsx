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

const FOOT = { left: 'Left', right: 'Right', both: 'Both' } as const
/** The assessments shown at first, newest first. TRAK-368: "All N" shows the rest here too. */
const SHOWN = 6

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3 border-b border-line py-2.5 last:border-b-0">
    <dt className="text-sm text-ink-3">{label}</dt>
    <dd className="m-0 min-w-0 text-[15px] text-ink">{children}</dd>
  </div>
}
const notSet = <span className="text-ink-3">Not set</span>

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
  if (player.waiting) return <>{header}<p className="text-sm text-ink-2">{first} is waiting for consent. Nothing can be recorded about them until it's in.</p></>

  return <>
    {header}

    {/* A laptop's pane has room for two columns: facts beside the radar, the latest card beside the earlier ones. */}
    <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] laptop:items-start">
      <div className="grid gap-5">
        {placement && <PositionAndRoles coachId={coachId} id={player.id} name={player.name} position={placement.position} />}
        <section aria-label={`About ${first}`} className="grid gap-2">
          {factsFailed ? <LoadError what={`${first}'s profile`} onRetry={onRetryFacts} />
            : !facts ? <LoadingSkeleton label={`Loading ${first}'s profile…`} />
            : <>
              <dl className="m-0 border-t border-line">
                <Fact label="Preferred foot">{facts.foot ? FOOT[facts.foot] : notSet}</Fact>
                <Fact label="Nationality">{facts.nationality ?? notSet}</Fact>
                <Fact label="Born">{facts.born ? bornLine(facts.born, new Date()) : notSet}</Fact>
                <Fact label="Traits">{facts.traits.length
                  ? <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`${first}'s traits`}>
                      {facts.traits.map(trait => <li key={trait} className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-sm text-ink">{trait}</li>)}
                    </ul>
                  : <span className="text-ink-3">None picked yet</span>}</Fact>
              </dl>
              <span className="justify-self-start"><PlayerFactsEditor playerId={player.id} name={player.name} coachId={coachId} facts={facts} /></span>
            </>}
        </section>
      </div>

      <section aria-labelledby={`season-${player.id}`}>
        <div className="grid gap-0.5">
          <h4 id={`season-${player.id}`} className="text-base font-medium text-ink">Season so far</h4>
          {seasonFailed ? <LoadError what={`${first}'s season`} onRetry={onRetrySeason} /> : <p className="text-sm text-ink-3">{season
            ? `Average of ${season.count} ${season.count === 1 ? 'assessment' : 'assessments'} since ${since}, out of 10, against the squad`
            : 'No assessment this season yet.'}</p>}
        </div>
        {season && !seasonFailed && <RadarChart label={`${player.name}'s season average against the squad`} size={240} rings={5} max={10}
          axes={ATTRIBUTES.map(([k, label]) => ({ key: k, label }))}
          series={[{ key: 'player', label: first, values: season.scores }, ...(squadSeason ? [{ key: 'squad', label: 'Squad average', values: squadSeason }] : [])]}
          formatValue={value => value.toFixed(1)} />}
      </section>
    </div>

    {placement && <PlayerObjectivesSection coachId={coachId} id={player.id} name={player.name} position={placement.position} squad={squad} />}

    {assessments.isError ? <LoadError what={`${first}'s assessments`} onRetry={() => { void assessments.refetch() }} />
      : !assessments.data ? <LoadingSkeleton label={`Loading ${first}'s assessments…`} lines={2} rows={2} />
      : <section aria-labelledby={`assessments-${player.id}`} className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h4 id={`assessments-${player.id}`} className="text-base font-medium text-ink">Assessments</h4>
          {list.length > SHOWN
            ? <button type="button" onClick={() => showAll(!all)} className="text-sm font-medium text-brand">{all ? `Show the latest ${SHOWN}` : `All ${list.length}`}</button>
            : list.length > 1 && <span className="text-sm text-ink-3 [@media(pointer:fine)]:hidden">Swipe for earlier</span>}
        </div>
        {list.length === 0 ? <p className="text-sm text-ink-2">No assessment yet.</p>
          : all && list.length > SHOWN ? <ol className="m-0 grid list-none gap-3 p-0 laptop:grid-cols-2" aria-label={`All of ${first}'s assessments`}>
            {list.map(assessment => <li key={assessment.id} className="min-w-0">{card(assessment)}</li>)}
          </ol>
          : <div className="arc">
            {/* As ParentAssessmentCarousel: the viewport is the row, so 88% is of what's visible and the next card peeks in. */}
            {/* Imad, 24 Oct: room above and below, so a card lifted on hover keeps its edge and shadow; firm snapping only
                under a finger: on a trackpad or wheel any snapping pulled the row back mid-swipe. */}
            <ScrollArea orientation="horizontal" snap="x mandatory" fade={0} label={`${first}'s assessments`} className="-mt-2 -mb-4" viewportClassName="flex gap-3 pt-2 pb-4">
              {list.slice(0, SHOWN).map((assessment, index) => <div key={assessment.id} role="group" aria-label={`Assessment ${index + 1} of ${Math.min(list.length, SHOWN)}`}
                className="min-w-0 basis-[88%] laptop:basis-[calc(50%-6px)] shrink-0 grow-0" style={{ scrollSnapAlign: 'start' }}>
                {card(assessment)}
              </div>)}
            </ScrollArea>
          </div>}
      </section>}

    <button type="button" onClick={() => navigate('/coach/assess', { state: { preselectedPlayerId: player.id } })}
      className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-brand">
      Assess {first} <ArrowRight size={16} aria-hidden />
    </button>
  </>
}

/** TRAK-353: the player's main position, roles and Can also play, with one Edit for all three (the mockup's profile). */
function PositionAndRoles({ coachId, id, name, position }: { coachId: string; id: string; name: string; position: string | null }) {
  const [editing, setEditing] = useState(false)
  const roles = usePlayerRoles(coachId)
  const first = name.split(' ')[0]
  const { also, roles: held } = roles.of(id)
  return <section aria-labelledby={`position-${id}`} className="grid gap-2">
    <div className="flex items-baseline justify-between gap-3">
      <h4 id={`position-${id}`} className="text-base font-medium text-ink">Position and roles</h4>
      <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${first}'s position and roles`} aria-haspopup="dialog"
        className="min-h-11 rounded-md text-[15px] font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Edit</button>
    </div>
    {roles.isError ? <LoadError what={`${first}'s roles`} onRetry={() => { void roles.refetch() }} />
      : !roles.data ? <LoadingSkeleton label={`Loading ${first}'s roles…`} lines={2} />
      : <dl className="m-0 border-t border-line">
        <Fact label="Main position">{isPosition(position) ? position : <span className="text-ink-3">No position yet</span>}</Fact>
        <Fact label="Roles">{held.length ? held.join(', ') : <span className="text-ink-3">No role yet</span>}</Fact>
        <Fact label="Can also play">{also.length ? also.join(', ') : <span className="text-ink-3">None yet</span>}</Fact>
      </dl>}
    <PositionAndRolesSheet coachId={coachId} player={{ id, name, position }} open={editing} onOpenChange={setEditing} saveNeedsChange
      onSaved={() => setEditing(false)} />
  </section>
}
