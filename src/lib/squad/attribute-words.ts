import type { AttributeKey } from './attributes'

/* TRAK-407: an attribute's name in the language showing; the key is what is saved. */
export const ATTRIBUTE_WORD = {
  work_rate: 'coachHome:attributeWorkRate', technical: 'coachHome:attributeTechnical', physical: 'coachHome:attributePhysical',
  coachability: 'coachHome:attributeCoachability', attitude: 'coachHome:attributeAttitude', tactical: 'coachHome:attributeTactical',
} as const satisfies Record<AttributeKey, string>
