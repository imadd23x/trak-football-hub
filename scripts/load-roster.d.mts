// Types for the runtime module. It stays .mjs so an operator can run it with
// plain Node, no build step.
export interface RosterRow {
  line: number
  child_name: string
  date_of_birth: string
  age_group: string
  child_email: string
  guardian_emails: string[]
  coach_email: string
}
export declare const COLUMNS: readonly string[]
export declare function parseCsv(text: string): string[][]
export declare function validateRoster(
  text: string,
  options?: { today?: string },
): { rows: RosterRow[]; errors: string[] }
