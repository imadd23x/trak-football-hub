import { i18n } from '@/lib/i18n'

/* TRAK-407: a match's state and next action are kept in English in lib/games/loop (STATE); these give the word shown
   for each, shown(MATCH_WORD, label). A label with no entry ("Shares Thu 19:30") is already in the language showing. */
export const MATCH_WORD: Readonly<Record<string, string>> = {
  'Logistics not shared': 'coachMatches:stateLogistics',
  'Share logistics': 'coachMatches:actShareLogistics',
  'Plan not written': 'coachMatches:statePlan',
  'Write plan': 'coachMatches:actWritePlan',
  'Draft': 'coachHome:stateDraft',
  'Share plan': 'coachMatches:actSharePlan',
  'Plan scheduled': 'coachMatches:statePlanScheduled',
  'Plan shared': 'coachMatches:statePlanShared',
  'Changes not shared': 'coachMatches:stateChanges',
  'Share changes': 'coachMatches:actShareChanges',
  'Locked at kick-off': 'coachMatches:stateLocked',
  'Full time': 'coachMatches:stateFullTime',
  'Evaluate': 'coachHome:evaluate',
  'Evaluation draft': 'coachHome:noteEvaluationDraft',
  'Publish': 'coachHome:publish',
  'Published': 'coachHome:notePublished',
  'View plan': 'coachMatches:actViewPlan',
  'Logistics': 'coachMatches:actLogistics',
}

/** A competition's word, by its saved value. */
export const COMPETITION_WORD = {
  league: 'coachSchedule:competitionLeague', tournament: 'coachSchedule:competitionTournament', friendly: 'coachSchedule:competitionFriendly',
} as const

type Option = { value: string; label: string; description?: string; summary?: string }

/** A fixed list's options (how strong they are, a player's context, the expectation) with their words in the language
 *  showing; the value is what is saved. Call it from a component that uses useTranslation(). */
export function optionWords<T extends Option>(kind: 'strength' | 'context' | 'expectation' | 'didJob' | 'against' | 'planWorked', options: readonly T[]): T[] {
  return options.map(option => ({
    ...option,
    label: i18n.t(`coachMatches:${kind}_${option.value}` as 'coachMatches:saved'),
    ...(option.description ? { description: i18n.t(`coachMatches:${kind}_${option.value}_desc` as 'coachMatches:saved') } : {}),
    ...(option.summary ? { summary: i18n.t(`coachMatches:${kind}_${option.value}_sum` as 'coachMatches:saved') } : {}),
  }))
}
