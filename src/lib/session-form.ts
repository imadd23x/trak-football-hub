// J4 (TRAK-102): how a training's form fields are stored on coach_sessions, and
// how they are read back for editing. CoachAddSession writes with these and
// CoachSessionEdit reads and rewrites with them, so the two can't drift.
import { parseTrainingType, trainingTypeFrom, type TrainingFocus } from '@/lib/training-focus'

export const TRAINING_DURATIONS = [45, 60, 75, 90] as const
export const TRAINING_INTENSITIES = ['Light', 'Medium', 'High'] as const

/** "Technical / Set Pieces — theme", or "Technical Training" without a theme. */
export function trainingTitle(focus: Iterable<string>, theme: string): string {
  const focusLabel = [...focus].join(' / ')
  return theme.trim() ? `${focusLabel} — ${theme.trim()}` : `${focusLabel} Training`
}

/** First line "60 min · High intensity", then the coach's notes. Null when empty. */
export function trainingNotes(duration: number | null, intensity: string, notes: string): string | null {
  const meta = [
    duration ? `${duration} min` : null,
    intensity ? `${intensity} intensity` : null,
  ].filter(Boolean).join(' · ')
  return [meta, notes].filter(Boolean).join('\n') || null
}

const META_LINE = /^(?:(\d+) min)?(?: · )?(?:(Light|Medium|High) intensity)?$/

/** trainingNotes() read back. A first line that isn't the meta line is notes. */
export function parseTrainingNotes(stored: string | null | undefined): {
  duration: number | null; intensity: string; notes: string
} {
  const text = stored ?? ''
  const [first, ...rest] = text.split('\n')
  const m = first ? META_LINE.exec(first) : null
  if (!m || (!m[1] && !m[2])) return { duration: null, intensity: '', notes: text }
  return { duration: m[1] ? Number(m[1]) : null, intensity: m[2] ?? '', notes: rest.join('\n') }
}

/**
 * A saved training's focus and theme. The focus comes from training_type; a
 * session saved before TRAK-75 has none, so its focus is read from the title.
 */
export function parseTrainingTitle(title: string, trainingType: string | null): {
  focus: TrainingFocus[]; theme: string
} {
  const dash = title.indexOf(' — ')
  const head = dash >= 0 ? title.slice(0, dash) : title.replace(/ Training$/, '')
  const theme = dash >= 0 ? title.slice(dash + 3) : ''
  const fromType = parseTrainingType(trainingType)
  const focus = fromType.length ? fromType : parseTrainingType(trainingTypeFrom(head.split(' / ')))
  // A title that isn't ours at all keeps its words as the theme, so nothing is lost.
  if (!focus.length && !theme) return { focus, theme: title }
  return { focus, theme }
}
