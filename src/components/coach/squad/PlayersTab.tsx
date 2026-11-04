import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { SquadDirectory, type PositionGroup, type SquadPlayer } from '@/components/arc/blocks/team-directory/squad-directory'
import { Badge } from '@/components/arc/badge/badge'
import { needsYou } from '@/lib/coach-needs-you'
import { BANDS } from '@/lib/types'
import { bandMoves } from '@/lib/squad/snapshot'
import { seasonAverages } from '@/lib/squad/season-profile'
import { seasonWindow } from '@/lib/squad/season'
import { seasonStartLabel, useSeasonPlan } from '@/lib/season-plan'
import { isPosition } from '@/lib/positions'
import { localParts, localTodayISO } from '@/lib/event-time'
import { PlayerProfile } from './PlayerProfile'
import { usePlayerFacts } from './usePlayerFacts'
import type { SquadRoster } from './useSquadRoster'

const GROUP: Record<string, PositionGroup> = { Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Attacker: 'ATT', Forward: 'ATT' }
const dateOf = (iso: string) => localParts(iso).date
const TREND = 6

/**
 * TRAK-263 (Imad, 22 Oct): Squad's Players view, replacing Snapshot. Every roster player in Arc's team directory
 * (position filters, search by name or shirt number); a player's profile beside the list, or in its place on a phone.
 * Imad, 23 Oct: each row ends with a sparkline of the player's ratings, and there's no band bar above.
 */
export function PlayersTab({ roster }: { roster: SquadRoster }) {
  const { user } = useAuth()
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
  const seasonFrom = seasonPlan.plan?.starts_on ?? seasonWindow(localTodayISO()).from
  const season = useMemo(() => seasonAverages(roster.assessments, seasonFrom, dateOf), [roster.assessments, seasonFrom])
  // TRAK-266 (Imad, 22 Oct): the colour key only where the coach is needed: amber for a player to assess or a draft
  // families can't see yet, by Home's Needs you rule. Everyone else gets no badge.
  const owed = useMemo(() => {
    const kinds = new Map<string, 'assess' | 'draft'>()
    for (const item of needsYou({ players: roster.players, waitingForParent: roster.consentPending, assessments: roster.assessments, now: Date.now() })) {
      if (!kinds.has(item.playerId)) kinds.set(item.playerId, item.kind)
    }
    return kinds
  }, [roster.players, roster.consentPending, roster.assessments])

  // TRAK-352: where the season plan is on, a consented player the coach hasn't placed says so. Elsewhere Squad is as it was.
  const positionOf = (p: (typeof roster.players)[number]) =>
    isPosition(p.position) || !seasonPlan.on || roster.consentPending.has(p.id) ? p.position ?? '' : 'No position yet'
  const players: SquadPlayer[] = roster.players.map(p => {
    const move = moves.get(p.id)
    return {
      id: p.id, name: p.player_name, position: positionOf(p), group: GROUP[p.position ?? ''] ?? null, shirt: p.shirt_number,
      band: move ? BANDS.find(b => b.word.toLowerCase() === move.band)?.word ?? null : null, move: move?.move ?? 0,
      waiting: roster.consentPending.has(p.id),
      trend: trends.get(p.id),
      flag: owed.get(p.id) === 'assess' ? <Badge tone="warning" size="sm">Assess</Badge>
        : owed.get(p.id) === 'draft' ? <Badge tone="warning" size="sm">Draft</Badge> : undefined,
    }
  })
  const squadOf = new Map(roster.players.map(p => [p.id, p.age_group?.trim() || null]))

  return <SquadDirectory title={squadLabel ? `${squadLabel} players` : 'Players'} players={players}
    renderProfile={player => user && <PlayerProfile player={player} squad={squadOf.get(player.id) ?? squadLabel} coachId={user.id}
      facts={facts.data?.get(player.id)} factsFailed={facts.isError} onRetryFacts={() => { void facts.refetch() }}
      season={season.players.get(player.id)} squadSeason={season.squad} since={seasonStartLabel(seasonFrom)} />} />
}
