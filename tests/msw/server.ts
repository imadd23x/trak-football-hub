import { setupServer } from 'msw/node'
import { authHandlers, consentBatchFromSingle, rpc, table } from './supabase'

// TRAK-312: the roster-wide consent check is answered from each test's single-child answers.
// TRAK-528: a player's page lists his sent reports; none unless a test says so. TRAK-529: so do the family's Homes.
// TRAK-579: the player's Home asks for My tasks; none unless a test says so. TRAK-601: and for training plans; none either.
export const server = setupServer(...authHandlers(), consentBatchFromSingle(), table('report_for_player', []), table('report_for_family', []),
  rpc('my_tasks', () => []), rpc('my_training_plans', () => []),
  // TRAK-603: and the bell for announcements; none either.
  rpc('my_announcements', () => []))
