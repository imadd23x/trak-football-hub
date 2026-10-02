// Types for the runtime module. It stays .mjs so an operator can run it with
// plain Node, no build step.
export interface RosterRow {
  line: number
  child_name: string
  date_of_birth: string
  age_group: string
  /** null when the academy gave none (TRAK-84) */
  child_email: string | null
  guardian_emails: string[]
  coach_email: string
}
export declare const COLUMNS: readonly string[]
export declare function parseCsv(text: string): string[][]
export declare function validateRoster(
  text: string,
  options?: { today?: string },
): { rows: RosterRow[]; errors: string[] }
export declare function planLoad(
  rows: RosterRow[],
  admitted: { child_email: string; organization_id: string }[],
  org: string,
): { toLoad: RosterRow[]; skipped: number[]; conflicts: number[] }
export declare function loadRows(
  toLoad: RosterRow[],
  deps: {
    admit(row: RosterRow): Promise<{ data: string | null; error: { code?: string; message: string } | null }>
    invite: ((rosterChildId: string) => Promise<boolean>) | null
  },
  log: (message: string) => void,
): Promise<{ loaded: number; invited: number; inviteFailed: number[]; alreadyOnRoster: number[]; stoppedAt?: number }>
/** Lines holding a reserved test address (child or guardian); --send-invites and --reinvite refuse such a file. */
export declare function syntheticInviteLines(rows: RosterRow[]): number[]
export declare function planReinvite(
  rows: RosterRow[],
  onRoster: {
    id: string
    child_email: string | null
    date_of_birth: string
    player_name: string
    guardians: { email?: string; invited_at: string | null; parent_user_id: string | null }[]
  }[],
): { toInvite: { line: number; rosterChildId: string }[]; upToDate: number[]; notOnRoster: number[]; unmailable: number[] }
export declare function reinviteRows(
  toInvite: { line: number; rosterChildId: string }[],
  invite: (rosterChildId: string) => Promise<boolean>,
  log: (message: string) => void,
): Promise<{ invited: number; failed: number[] }>
export declare function operatorKey(env: Record<string, string | undefined>): string
export declare function inviteRequest(url: string, key: string, rosterChildId: string, options?: { onlyUninvited?: boolean }): {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}
export declare function reinviteExitCode(
  plan: { toInvite: unknown[]; upToDate: number[]; notOnRoster: number[]; unmailable: number[] }, failedCount: number,
): 0 | 1
export declare function pendingGuardianNote(body: unknown): string | null
export declare function describeInviteFailure(status: number, body: unknown): string
export declare function parseArgs(argv: string[]): {
  apply: boolean
  'send-invites': boolean
  reinvite: boolean
  file?: string
  org?: string
  'loaded-by'?: string
}
