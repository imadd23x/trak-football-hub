/**
 * When may a quick-assess screen record what is on the sliders?
 *
 * The six sliders in CoachQuickAssess initialise to 5, and coach_assessments'
 * six score columns are NOT NULL DEFAULT 5. So a coach who taps Next without
 * touching anything writes "average on every metric" into a child's record,
 * stored and displayed exactly like a judgement someone made. Nothing
 * downstream can tell the difference afterwards — which is the whole problem.
 *
 * The distinction this turns on is the reason the rule is narrow rather than
 * "always make the coach touch something":
 *
 *   RETURNING player — the sliders are seeded with their PREVIOUS scores, so
 *                      leaving them alone is a real judgement: "nothing
 *                      changed". That is the design, and it is what makes the
 *                      per-session loop fast enough for the 3-minute gate.
 *                      Untouched Next must keep working.
 *
 *   FIRST assessment — there is nothing to carry, so a 5 on screen is the
 *                      control's default and not anyone's opinion. Recording it
 *                      invents a judgement about a child.
 *
 * Kept as a pure function rather than inline in the component so the rule can
 * be tested as a truth table, and so the button's `disabled` and the save path
 * cannot drift apart — both ask this.
 */
export type AssessmentEntryState = {
  /** Does this player have a previous assessment seeding the sliders? */
  hasPreviousScores: boolean
  /** Has the coach moved any slider for this player on this screen? */
  touched: boolean
}

/**
 * True when the values on screen are the control's defaults rather than
 * anything the coach expressed, and so must not be recorded.
 */
export function needsCoachInput({ hasPreviousScores, touched }: AssessmentEntryState): boolean {
  if (touched) return false           // the coach expressed something
  return !hasPreviousScores           // nothing to carry, so 5s are defaults
}

/** Inverse, for read order at the call site. */
export function canRecordAssessment(state: AssessmentEntryState): boolean {
  return !needsCoachInput(state)
}
