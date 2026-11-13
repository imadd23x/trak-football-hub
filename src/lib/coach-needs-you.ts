import { format } from 'date-fns'
import { playerAttention } from '@/lib/player-attention'
import { dateLocale, i18n } from '@/lib/i18n'

export interface NeedsYouItem {
  /** The squad row. */
  playerId: string
  name: string
  /** "Midfielder · #8", or empty. */
  detail: string
  kind: 'assess' | 'draft'
  /** "Never assessed, 3 weeks in the squad" */
  reason: string
  urgent: boolean
  /** TRAK-444: when the last assessment (or draft) was, for the date sort; 0 when never. */
  at?: number
}

/**
 * TRAK-262 (Imad, 22 Oct): Home's Needs you. Every admitted player TRAK-197's rule flags for assessment (none for 2+
 * weeks, or never after 2 weeks in the squad), most urgent first; then a card per player with a draft assessment
 * families can't see yet. Trainings aren't counted here: the cards are about assessing. A player waiting for a
 * parent is left out, as nothing can be recorded about them.
 * TRAK-364: in a squad that is evaluated (the season plan is on and the squad's plan is shared), the per-player
 * Assess cards give way to the squad's one Evaluation due card. Drafts still show: they wait for the coach either way.
 */
export function needsYou({ players, waitingForParent, assessments, now, evaluatedSquads }: {
  players: { id: string; player_name: string; created_at: string | null; position?: string | null; shirt_number?: number | null; age_group?: string | null }[]
  waitingForParent: Set<string>
  assessments: { squad_player_id: string; created_at: string; published_at?: string | null }[]
  now: number
  /** Squads whose evaluation replaces the per-player Assess cards. */
  evaluatedSquads?: Set<string>
}): NeedsYouItem[] {
  const detail = (p: (typeof players)[number]) => [p.position, p.shirt_number != null ? `#${p.shirt_number}` : null].filter(Boolean).join(' · ')
  const byId = new Map(players.map(p => [p.id, p]))
  const evaluated = (p: (typeof players)[number]) => !!evaluatedSquads?.has(p.age_group?.trim() ?? '')
  const lastAssessed = new Map<string, number>()
  for (const a of assessments) {
    const at = Date.parse(a.created_at)
    if (Number.isFinite(at) && at > (lastAssessed.get(a.squad_player_id) ?? 0)) lastAssessed.set(a.squad_player_id, at)
  }
  const assess: NeedsYouItem[] = playerAttention({
    roster: players.filter(p => !evaluated(p)), waitingForParent, assessments, trainings: [], present: new Map(), absenceReasons: new Map(), now,
  }).filter(row => row.level !== 'on-track').map(row => ({
    playerId: row.playerId, name: row.name, detail: detail(byId.get(row.playerId)!), kind: 'assess', reason: row.reasons[0], urgent: row.level === 'urgent', at: lastAssessed.get(row.playerId) ?? 0,
  }))

  const drafts = new Map<string, string[]>()
  for (const a of assessments) {
    if (a.published_at !== null || !a.created_at || !byId.has(a.squad_player_id) || waitingForParent.has(a.squad_player_id)) continue
    drafts.set(a.squad_player_id, [...(drafts.get(a.squad_player_id) ?? []), a.created_at])
  }
  const draft = [...drafts].map(([id, dates]): NeedsYouItem => {
    const latest = format(new Date(dates.sort().at(-1)!), 'd MMM', { locale: dateLocale() })
    return {
      playerId: id, name: byId.get(id)!.player_name, detail: detail(byId.get(id)!), kind: 'draft', urgent: false, at: Date.parse(dates.at(-1)!),
      reason: dates.length === 1 ? i18n.t('coachHome:draftFrom', { day: latest }) : i18n.t('coachHome:draftsFrom', { count: dates.length, day: latest }),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return [...assess, ...draft]
}
