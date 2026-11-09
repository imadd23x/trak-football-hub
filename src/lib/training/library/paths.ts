/* TRAK-387 (Drill Library 3/11): where the Library's pages live, under Training › Drills. */

export const DRILLS_PATH = '/coach/training/drills'
export const MY_DRILLS_PATH = `${DRILLS_PATH}/mine`
export const ALL_DRILLS_PATH = `${DRILLS_PATH}/all`
/** TRAK-394: Change any practice, Steve's five things that shape every practice. */
export const CHANGE_PRACTICE_PATH = `${DRILLS_PATH}/change`
/** A practice page: Technical, Skill or Game related. */
export const kindPath = (kind: 'technical' | 'skill' | 'game') => `${DRILLS_PATH}/kind/${kind}`
/** A drill's own page. */
export const drillPath = (id: string) => `${DRILLS_PATH}/d/${id}`
/** All drills, showing one kind of practice, Individual or Goalkeeping. */
export const allDrillsPath = (show?: string) => show ? `${ALL_DRILLS_PATH}?show=${encodeURIComponent(show)}` : ALL_DRILLS_PATH
