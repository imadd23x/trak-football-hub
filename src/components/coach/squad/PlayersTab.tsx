import { useMemo } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { SquadDirectory, type PositionGroup, type SquadPlayer } from '@/components/arc/blocks/team-directory/squad-directory'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { needsYou } from '@/lib/coach-needs-you'
import { BANDS } from '@/lib/types'
import { bandMoves } from '@/lib/squad/snapshot'
import { seasonAverages } from '@/lib/squad/season-profile'
import { seasonWindow } from '@/lib/squad/season'
import { seasonStartLabel, useSeasonPlan } from '@/lib/season-plan'
import { isPosition } from '@/lib/positions'
import { POSITION_WORD } from '@/lib/position-words'
import { useTranslation } from '@/lib/i18n'
import { localParts, localTodayISO } from '@/lib/event-time'
import { PlayerProfile } from './PlayerProfile'
import { WatchBadge } from '@/components/coach/season-plan/WatchFirst'
import { useWatchList } from '@/components/coach/season-plan/useWatching'
import { useSharedPlans } from '@/components/coach/season-plan/useEvaluation'
import { usePlayerFacts } from './usePlayerFacts'
import type { SquadRoster } from './useSquadRoster'

const GROUP: Record<string, PositionGroup> = { Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Attacker: 'ATT', Forward: 'ATT' }
const dateOf = (iso: string) => localParts(iso).date
const TREND = 6

/**
 * TRAK-263 (Imad, 22 Oct): Squad's Players view, replacing Snapshot. Every roster player in Arc's team directory
 * (position filters, search by name or shirt number). Imad, 23 Oct: each row ends with a sparkline of the player's
 * ratings, and there's no band bar above. TRAK-351 (Tarek, 3 Nov): a player opens as their own full page, with no list
 * beside it and a Back button; the list stays mounted behind it, so Back finds its filter and search as left.
 */
export function PlayersTab({ roster, openId = null, onOpen = () => {}, onBack = () => {} }: {
  roster: SquadRoster
  /** The player whose page is open (their address, /coach/squad/player/:id), or null for the list. */
  openId?: string | null
  onOpen?: (id: string) => void
  onBack?: () => void
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const ids = useMemo(() => roster.players.map(p => p.id), [roster.players])
  const facts = usePlayerFacts(user?.id, ids)
  const moves = useMemo(() => bandMoves(roster.assessments), [roster.assessments])
  // Imad, 23 Oct: each row's sparkline, the last six overall ratings, oldest first.
  const trends = useMemo(() => {
    const byPlayer = new Map<string, number[]>()
    for (const row of [...roster.assessments].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (row.coach_rating == null) continue
      byPlayer.set(row.squad_player_id, [...(byPlayer.get(row.squad_player_id) ?? []), row.coach_rating].slice(-TREND))
    }
    return byPlayer
  }, [roster.assessments])
  // TRAK-350: the season starts when the squad's season plan says, where there is one; otherwise on 1 July.
  const squadLabel = roster.squad ?? (roster.squads.length === 1 ? roster.squads[0] : null)
  const seasonPlan = useSeasonPlan(user?.id, squadLabel)
  // TRAK-355: a watched player shows Watching, or Ready once their reminder is due, where the season plan is on.
  const watching = useWatchList(user?.id, roster, seasonPlan.on)
  const watchOf = new Map(watching.list.map(w => [w.playerId, w]))
  const seasonFrom = seasonPlan.plan?.starts_on ?? seasonWindow(localTodayISO()).from
  const season = useMemo(() => seasonAverages(roster.assessments, seasonFrom, dateOf), [roster.assessments, seasonFrom])
  // TRAK-266 (Imad, 22 Oct): the colour key only where the coach is needed: amber for a player to assess or a draft
  // families can't see yet, by Home's Needs you rule. Everyone else gets no badge. TRAK-364: as on Home, a squad that's
  // evaluated (its season plan shared) has no per-player Assess; its evaluation is due on Home instead.
  const evaluated = useSharedPlans(user?.id, roster.squads).shared
  const owed = useMemo(() => {
    const kinds = new Map<string, 'assess' | 'draft'>()
    for (const item of needsYou({ players: roster.players, waitingForParent: roster.consentPending, assessments: roster.assessments, now: Date.now(),
      evaluatedSquads: evaluated })) {
      if (!kinds.has(item.playerId)) kinds.set(item.playerId, item.kind)
    }
    return kinds
  }, [roster.players, roster.consentPending, roster.assessments, evaluated])

  // TRAK-352: where the season plan is on, a consented player the coach hasn't placed says so. Elsewhere Squad is as it was.
  const positionOf = (p: (typeof roster.players)[number]) =>
    isPosition(p.position) ? t(POSITION_WORD[p.position])
      : !seasonPlan.on || roster.consentPending.has(p.id) ? p.position ?? '' : t('coachSquad:noPositionYet')
  const players: SquadPlayer[] = roster.players.map(p => {
    const move = moves.get(p.id)
    return {
      id: p.id, name: p.player_name, position: positionOf(p), group: GROUP[p.position ?? ''] ?? null, shirt: p.shirt_number,
      band: move ? BANDS.find(b => b.word.toLowerCase() === move.band)?.word ?? null : null, move: move?.move ?? 0,
      waiting: roster.consentPending.has(p.id),
      trend: trends.get(p.id),
      flag: watchOf.has(p.id) ? <WatchBadge watch={watchOf.get(p.id)} />
        : owed.get(p.id) === 'assess' ? <Badge tone="warning" size="sm">{t('coachHome:assess')}</Badge>
        : owed.get(p.id) === 'draft' ? <Badge tone="warning" size="sm">{t('coachHome:stateDraft')}</Badge> : undefined,
    }
  })
  const squadOf = new Map(roster.players.map(p => [p.id, p.age_group?.trim() || null]))

  const open = openId == null ? undefined : players.find(player => player.id === openId)
  return <>
    <div hidden={openId != null}>
      <SquadDirectory title={squadLabel ? t('coachSquad:squadPlayers', { squad: squadLabel }) : t('coachSquad:tabPlayers')} players={players} onOpen={player => onOpen(player.id)} />
    </div>
    {openId != null && <div className="grid gap-4 pt-4">
      <span className="arc"><Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />{t('common:back')}</Button></span>
      {open && <CoachTrail current={open.name} />}
      {/* TRAK-368: the page's title, as the older player page had it; the card's name is the visible one. */}
      {open && <h1 className="sr-only">{open.name}</h1>}
      {open && user ? <article aria-label={`${open.name}, ${open.position || t('coachSquad:noPositionYetLower')}`} className="rounded-2xl border border-line bg-surface p-6">
        <PlayerProfile player={open} squad={squadOf.get(open.id) ?? squadLabel} coachId={user.id}
          facts={facts.data?.get(open.id)} factsFailed={facts.isError} onRetryFacts={() => { void facts.refetch() }}
          season={season.players.get(open.id)} squadSeason={season.squad} since={seasonStartLabel(seasonFrom)}
          seasonFailed={roster.assessmentsFailed} onRetrySeason={roster.retry}
          placement={seasonPlan.on ? { position: roster.players.find(p => p.id === open.id)?.position ?? null } : undefined} />
      </article> : !open && <p className="text-sm text-ink-2">{roster.squad == null || roster.squads.length <= 1
        // Every squad is in view, so the player isn't the coach's at all (TRAK-368: the older page's answer).
        ? t('coachSquad:playerNotFound')
        : t('coachSquad:playerOtherSquad')}</p>}
    </div>}
  </>
}
