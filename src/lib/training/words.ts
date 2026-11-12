/* TRAK-408 (Languages 3/8): Training's fixed labels are kept in English in lib/training (their tests are unchanged);
   these give the word shown for each, shown(TRAINING_WORD, label). A label with no entry ("14 here") is already in
   the language showing. */
export const TRAINING_WORD: Readonly<Record<string, string>> = {
  'Logistics': 'coachTraining:loopLogistics',
  'Plan': 'coachTraining:loopPlan',
  'Who’s here': 'coachTraining:loopHere',
  'Notes': 'coachTraining:loopNotes',
  'From the schedule': 'coachTraining:fromSchedule',
  'Optional': 'coachTraining:optionalCap',
  'No plan written': 'coachTraining:noPlanWritten',
  'No register taken': 'coachTraining:noRegister',
  'Finished': 'coachTraining:finished',
  'Today': 'coachHome:today',
  'Plan ready': 'coachTraining:planReady',
  'Draft': 'coachHome:stateDraft',
  'Plan not written': 'coachMatches:statePlan',
  'Yes': 'coachTraining:againYes',
  'Yes, with changes': 'coachTraining:againChanges',
  'No': 'coachTraining:againNo',
  'optional': 'coachTraining:noteOptional',
  'now': 'coachTraining:noteNow',
  'next': 'coachTraining:noteNext',
}
