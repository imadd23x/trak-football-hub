import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Explicit canonical-main schema snapshot, not a moving origin/main alias or
// independent proof of which versions are applied to the hosted database.
export const historyUpgradeBase = '00910940f596d9fe9a7cd416dc741943d1df2cc9';
export const historyMigration = '20260918112323_parent_match_history.sql';

export async function parentHistoryUpgradeOrder(root, candidateFiles) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const mainFiles = git(['ls-tree', '--name-only', `${historyUpgradeBase}:supabase/migrations`])
    .trim().split('\n').filter(file => file.endsWith('.sql')).sort();
  if (mainFiles.length !== 62 || mainFiles.at(-1) !== '20260918133800_ai_quota_known_functions.sql') {
    throw new Error('Unexpected migration inventory for pinned main 0091094');
  }
  const additions = candidateFiles.filter(file => !mainFiles.includes(file));
  if (additions.length !== 1 || additions[0] !== historyMigration) {
    throw new Error('History upgrade requires exactly the pending history migration beyond pinned main');
  }
  for (const file of mainFiles) {
    if (!candidateFiles.includes(file)) throw new Error(`Missing main migration: ${file}`);
    const expected = git(['show', `${historyUpgradeBase}:supabase/migrations/${file}`]);
    const actual = await readFile(resolve(root, 'supabase/migrations', file), 'utf8');
    if (actual !== expected) throw new Error(`Changed main migration: ${file}`);
  }
  // Preserve the known PR35-before-PR33 deployment inversion as well as the
  // complete pinned inventory. A separate parent-upgrade run that applies
  // history before newer main migrations does not cover this combined order.
  const parent = '20260917205027_secure_parent_invites.sql';
  const reports = '20260918070209_restrict_pilot_operational_views.sql';
  if (!mainFiles.includes(parent) || !mainFiles.includes(reports)) {
    throw new Error('Pinned main is missing the parent/report upgrade boundary');
  }
  const mainOrder = [...mainFiles];
  mainOrder.splice(mainOrder.indexOf(parent), 1);
  mainOrder.splice(mainOrder.indexOf(reports) + 1, 0, parent);
  return [...mainOrder, historyMigration];
}

export function requireHistoryUpgradeSuiteOutput(suite, result) {
  const rows = result.flatMap(query => query.rows ?? []);
  const expected = {
    'parent_match_history.sql': ['parent_match_history_assertions', 81],
    'pilot_view_security.sql': ['pilot_view_assertions', 282],
  }[suite];
  if (expected) {
    const [key, count] = expected;
    const reports = rows.filter(row => Object.hasOwn(row, key));
    if (reports.length !== 1 || Number(reports[0][key]) !== count) {
      throw new Error(`Missing or incomplete ${suite} output: expected ${count} assertions`);
    }
  } else if (suite === 'parent_invite_security.sql') {
    // The original P1 suite returns void per assertion, rather than a final count.
    const checks = rows.filter(row => Object.hasOwn(row, 'assert_true') || Object.hasOwn(row, 'expect_denied'));
    if (checks.length !== 55) throw new Error(`Missing or incomplete P1 output: expected 55 assertions, got ${checks.length}`);
  } else {
    throw new Error(`Unexpected history-upgrade suite: ${suite}`);
  }
}
