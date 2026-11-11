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
