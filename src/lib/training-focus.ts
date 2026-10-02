// J4/J6 (TRAK-75): the fixed "Session focus" choices on a training.
//
// coach_sessions.training_type stores the chosen keys, comma-separated, in this
// order. It is the one part of a training that families may read (TRAK-6,
// 25 Sep): date, that it was training, and these labels. The coach's own theme
// words stay in `title` and `notes`, which families never see, so nothing typed
// may ever reach training_type. The database enforces the same vocabulary
// (coach_sessions_training_type_vocabulary); change both together.
export const TRAINING_FOCUS = [
  { key: 'Technical',  sub: 'Passing, control, dribbling' },
  { key: 'Tactical',   sub: 'Shape, pressing, transitions' },
  { key: 'Finishing',  sub: 'Shooting & scoring' },
  { key: 'Set Pieces', sub: 'Corners, free kicks, penalties' },
  { key: 'Physical',   sub: 'Fitness & conditioning' },
  { key: 'Possession', sub: 'Rondos, keep-ball' },
  { key: 'Goalkeeper', sub: 'GK-specific work' },
  { key: 'Game Based', sub: 'SSGs & match scenarios' },
] as const

export type TrainingFocus = (typeof TRAINING_FOCUS)[number]['key']

const KEYS: readonly string[] = TRAINING_FOCUS.map(f => f.key)

/** The value to store: known keys only, in the fixed order, or null for none. */
export function trainingTypeFrom(selected: Iterable<string>): string | null {
  const chosen = new Set(selected)
  const keys = KEYS.filter(k => chosen.has(k))
  return keys.length ? keys.join(',') : null
}

/** A stored value back as labels. Anything outside the vocabulary is dropped. */
export function parseTrainingType(value: string | null | undefined): TrainingFocus[] {
  if (!value) return []
  return value.split(',').filter((k): k is TrainingFocus => KEYS.includes(k))
}
