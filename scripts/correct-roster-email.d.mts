// Types for the runtime module. It stays .mjs so an operator can run it with
// plain Node, no build step.
export interface CorrectionArgs {
  rosterChild: string
  kind: 'guardian' | 'child'
  old: string
  new: string
  by: string
  reason: string
  apply: boolean
}
export type TargetStatus = 'ready' | 'not_on_roster' | 'already_claimed' | 'no_child_email'
export interface RosterRowForCorrection {
  child_email: string | null
  player_user_id: string | null
  invited_at: string | null
  roster_guardians?: { email: string; parent_user_id: string | null; invited_at: string | null }[]
}
export declare function parseArgs(argv: string[]): CorrectionArgs
export declare function describeTarget(
  row: RosterRowForCorrection | null,
  kind: 'guardian' | 'child',
  oldEmail: string,
): { status: TargetStatus; wasInvited: boolean }
export declare function report(input: {
  apply: boolean
  rosterChild: string
  kind: 'guardian' | 'child'
  status: TargetStatus
  wasInvited: boolean
  auditId?: string
}): string[]
