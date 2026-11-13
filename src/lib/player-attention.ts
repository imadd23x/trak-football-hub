/**
 * TRAK-197 (Kostas, 17 Oct; agreed by Imad 18 Oct): coach Home's Player
 * overview. Every player in the squad gets one level, and Home lists at most
 * five, most urgent first.
 *
 * Trainings: the squad's last 4 logged trainings, counted as sessions, not days.
 *   Urgent:  missed 3 of the last 4 (only once the squad has 4 logged trainings,
 *            so the first pilot week flags nobody).
 *   Warning: missed the last one, or 2 of the last 4.
 * Assessments:
 *   Urgent:  never assessed after 3 weeks in the squad, or none for 4+ weeks.
 *   Warning: none for 2+ weeks (never assessed included).
 * On track: everything else.
 *
 * "Can't make it" still counts as missed, and its reason is shown. Coach-only:
 * nothing here reaches a player or a parent.
 *
 * Fairness, as missedLastSession: a training only counts for a child who was on
 * the roster by that day, whose register was taken (someone ticked present),
 * and who isn't waiting for a parent (they can't be ticked, so the absence isn't
 * theirs, and they can't be assessed either, so they're left out entirely).
 */

import { i18n } from '@/lib/i18n'
import { absenceReasonWord } from '@/lib/absence-reasons'

export type AttentionLevel = 'urgent' | 'warning' | 'on-track'

export interface AttentionRow {
  playerId: string
  name: string
  level: AttentionLevel
  /** What the coach reads under the name, most serious first. Never empty. */
  reasons: string[]
}

export interface AttentionInput {
  roster: { id: string; player_name: string; created_at: string | null }[]
  /** Children waiting for a parent: left out (nothing can be recorded about them). */
  waitingForParent: Set<string>
  assessments: { squad_player_id: string; created_at: string | null }[]
  /** The squad's logged trainings, any order; only the last 4 by date count. */
  trainings: { id: string; session_date: string; event_id: string | null }[]
  /** Who was ticked present, per session id. */
  present: Map<string, Set<string>>
  /** "Can't make it" reasons, per event id, then squad player id. */
  absenceReasons: Map<string, Map<string, string | null>>
  now: number
}

const DAY = 24 * 60 * 60 * 1000
export const TRAININGS_COUNTED = 4
const RANK: Record<AttentionLevel, number> = { urgent: 0, warning: 1, 'on-track': 2 }

const parse = (iso: string | null) => {
  const at = iso ? Date.parse(iso) : NaN
  return Number.isNaN(at) ? null : at
}
const days = (ms: number) => Math.floor(ms / DAY)
const weeks = (ms: number) => Math.floor(ms / (7 * DAY))
/* TRAK-407: the reasons are written in the language showing. */
const t = i18n.t.bind(i18n)

export function playerAttention(input: AttentionInput): AttentionRow[] {
  const { roster, waitingForParent, assessments, present, absenceReasons, now } = input
  // A register with nobody present wasn't taken; it says nothing about anyone.
  const last = [...input.trainings]
    .filter(t => (present.get(t.id)?.size ?? 0) > 0)
    .sort((a, b) => b.session_date.localeCompare(a.session_date))
    .slice(0, TRAININGS_COUNTED)
  const squadHasFour = last.length >= TRAININGS_COUNTED

  const lastAssessed = new Map<string, number>()
  for (const a of assessments) {
    const at = parse(a.created_at)
    if (at === null) continue
    if (at > (lastAssessed.get(a.squad_player_id) ?? -Infinity)) lastAssessed.set(a.squad_player_id, at)
  }

  const rows: (AttentionRow & { weight: number })[] = []
  for (const p of roster) {
    if (waitingForParent.has(p.id)) continue
    const joined = parse(p.created_at)
    const reasons: { level: AttentionLevel; text: string; weight: number }[] = []

    // ── Trainings ──
    // Joined by the session's day: created_at is UTC and the date is the
    // academy's day, so compare with the end of that day, as missedLastSession.
    const counted = joined === null ? [] : last.filter(t => joined < Date.parse(`${t.session_date}T00:00:00Z`) + DAY)
    const missed = counted.filter(t => !present.get(t.id)!.has(p.id))
    const lastMissed = counted.length > 0 && missed[0] === counted[0]
    const cantMakeIt = lastMissed && counted[0].event_id ? absenceReasons.get(counted[0].event_id)?.get(p.id) : undefined
    const word = absenceReasonWord(cantMakeIt)
    const why = cantMakeIt === undefined ? '' : word ? t('coachHome:cantMakeItReason', { reason: word }) : t('coachHome:cantMakeIt')
    if (squadHasFour && missed.length >= 3) {
      reasons.push({ level: 'urgent', text: t('coachHome:missedOf', { missed: missed.length, counted: counted.length, why }), weight: 100 + missed.length })
    } else if (missed.length >= 2) {
      reasons.push({ level: 'warning', text: t('coachHome:missedOf', { missed: missed.length, counted: counted.length, why }), weight: 50 + missed.length })
    } else if (lastMissed) {
      reasons.push({ level: 'warning', text: t('coachHome:missedLast', { why }), weight: 50 })
    }

    // ── Assessments ──
    const assessed = lastAssessed.get(p.id)
    if (assessed !== undefined) {
      const since = now - assessed
      if (since >= 28 * DAY) reasons.push({ level: 'urgent', text: t('coachHome:noAssessmentFor', { count: weeks(since) }), weight: 100 + days(since) / 100 })
      else if (since >= 14 * DAY) reasons.push({ level: 'warning', text: t('coachHome:noAssessmentFor', { count: weeks(since) }), weight: 50 + days(since) / 100 })
    } else if (joined !== null) {
      const inSquad = now - joined
      if (inSquad >= 21 * DAY) reasons.push({ level: 'urgent', text: t('coachHome:neverAssessed', { count: weeks(inSquad) }), weight: 100 + days(inSquad) / 100 })
      else if (inSquad >= 14 * DAY) reasons.push({ level: 'warning', text: t('coachHome:neverAssessed', { count: weeks(inSquad) }), weight: 50 + days(inSquad) / 100 })
    }

    reasons.sort((a, b) => RANK[a.level] - RANK[b.level] || b.weight - a.weight)
    const level = reasons[0]?.level ?? 'on-track'
    // The level's own word says "On track"; the line says what it rests on.
    const onTrack = assessed === undefined ? t('coachHome:notAssessedYet')
      : days(now - assessed) === 0 ? t('coachHome:assessedToday') : t('coachHome:assessedAgo', { count: days(now - assessed) })
    rows.push({
      playerId: p.id,
      name: p.player_name,
      level,
      reasons: reasons.length > 0 ? reasons.map(r => r.text) : [onTrack],
      // Two reasons outrank one at the same level; then the weightier one.
      weight: reasons.filter(r => r.level === level).length * 1000 + (reasons[0]?.weight ?? 0),
    })
  }

  return rows
    .sort((a, b) => RANK[a.level] - RANK[b.level] || b.weight - a.weight || a.name.localeCompare(b.name))
    .map(({ weight: _weight, ...row }) => row)
}
