import { i18n } from '@/lib/i18n'
import { PART_TYPES, type PartType } from './shelf'

/* TRAK-408 (Languages 3/8): Training's fixed labels are kept in English in lib/training (their tests are unchanged);
   these give the word shown for each, shown(TRAINING_WORD, label). A label with no entry ("14 here") is already in
   the language showing. */
export const TRAINING_WORD: Readonly<Record<string, string>> = {
  'Logistics': 'coachTraining:loopLogistics',
  'Plan': 'coachTraining:loopPlan',
  'Who’s here': 'coachTraining:loopHere',
  'Notes': 'coachTraining:loopNotes',
  'From Events': 'coachTraining:fromSchedule',
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

/* A part's name and note. A part keeps the name it was saved with ('Dry warm-up'); a name that is one of Trak's parts is
   shown in the language showing, and a name the coach wrote is shown as written. Call from a component that uses
   useTranslation(). */
const PART_BY_NAME = new Map<string, string>([...PART_TYPES.map(p => [p.name, p.key] as const), ['Your own part', 'own']])

export const partName = (name: string) => {
  const key = PART_BY_NAME.get(name)
  return key ? i18n.t(`coachTraining:part_${key}` as 'coachTraining:part_own') : name
}

export const partNote = (type: PartType) => i18n.t(`coachTraining:part_${type}_note` as 'coachTraining:part_own_note')

/** registerProblem's reason (kept in English, it is compared) in the language showing. */
const WHY: Record<string, string> = {
  'Only a published event has a register': 'coachTraining:why_published',
  'This event was cancelled, so it has no register': 'coachTraining:why_cancelled',
  'A match is recorded in the match log, with its score and minutes': 'coachTraining:why_match',
}
export const whyWord = (why: string) => (WHY[why] ? i18n.t(WHY[why] as 'coachTraining:why_match') : why.toLowerCase())

