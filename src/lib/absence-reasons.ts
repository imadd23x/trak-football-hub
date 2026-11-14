import { i18n } from '@/lib/i18n'

/**
 * TRAK-249 (Imad, 21 Oct; list confirmed 13 Nov): Can't make it takes one of these or none, never free text, so no
 * health details can be entered. Stored as the key; the database refuses anything else (event_absences_reason_check).
 */
export const ABSENCE_REASONS = ['school', 'family', 'travel', 'other'] as const
export type AbsenceReason = typeof ABSENCE_REASONS[number]

const WORD = { school: 'common:reasonSchool', family: 'common:reasonFamily', travel: 'common:reasonTravel', other: 'common:reasonOther' } as const

/** A stored reason's word in the language showing; null for none, or anything that isn't on the list. */
export function absenceReasonWord(reason: string | null | undefined): string | null {
  return reason && reason in WORD ? i18n.t(WORD[reason as AbsenceReason]) : null
}
