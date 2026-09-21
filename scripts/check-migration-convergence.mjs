#!/usr/bin/env node
// ============================================================
// Do a fresh replay and an already-applied database end in the same state?
//
// A migration that is edited after it has been applied splits the world in
// two. Databases that already ran the old bytes keep their effects; new
// replays run the new bytes. Nothing in CI notices, because CI only ever
// builds the fresh one — so the branch stays green while the two drift.
//
// That is not hypothetical here. PR #44 withdrew 20260919170000 to a no-op
// tombstone after it had been applied to the PR's own Supabase preview
// branch. The tombstone silenced the preview's complaint and left the drift
// in place:
//
//   preview (dghdhmskyzrkjtivkubi, read-only)   policy ABSENT
//   fresh replay of the tombstone               policy PRESENT
//
// and supabase/tests/coach_notes_privacy.sql asserts the policy is PRESENT —
// green on the replay it runs against, red against the real database. This
// script exists so that argument is settled by running it.
//
// It is deliberately not a general migration linter. It replays the two
// histories that actually exist and compares the object at issue.
//
//   A  fresh    every migration in order — production, and every new database
//   B  applied  stop at the cutoff, which is where the preview stands, then
//               apply only what that database has left to run
//
// Usage:  node scripts/check-migration-convergence.mjs
// ============================================================
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateMigrationFiles } from './migration-input.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const migDir = resolve(root, 'supabase/migrations');

// The database that is already past this point is the one at risk. Everything
// at or below it is history that database will never re-run.
const CUTOFF = '20260919193112_deny_policies_grant_nothing.sql';
const TABLE = 'public.coach_shared_feedback';
const POLICY = 'No shared feedback deletion';
const SUITE = 'coach_notes_privacy.sql';

const files = validateMigrationFiles(await readdir(migDir)).sort();
const read = f => readFile(resolve(migDir, f), 'utf8');
const readTest = f => readFile(resolve(root, 'supabase/tests', f), 'utf8');

if (!files.includes(CUTOFF)) {
  throw new Error(`Cutoff ${CUTOFF} is not in supabase/migrations — this check would compare two identical replays and pass for the wrong reason`);
}

async function replay(list) {
  const db = new PGlite();
  await db.exec(await readTest('bootstrap.sql'));
  for (const f of list) await db.exec(await read(f));
  return db;
}

async function observe(db) {
  const one = async sql => (await db.query(sql)).rows[0];
  const p = await one(`SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname = split_part('${TABLE}', '.', 1)
      AND tablename  = split_part('${TABLE}', '.', 2)
      AND policyname = '${POLICY}' AND cmd = 'DELETE'`);
  const g = await one(`SELECT
      has_table_privilege('authenticated','${TABLE}','DELETE') AS d,
      has_table_privilege('authenticated','${TABLE}','SELECT') AS s,
      has_table_privilege('authenticated','${TABLE}','INSERT') AS i,
      has_table_privilege('authenticated','${TABLE}','UPDATE') AS u`);
  const c = await one(`SELECT obj_description('${TABLE}'::regclass,'pg_class') AS body`);
  return {
    policy: p.n === 1,
    delete_grant: g.d,
    grants: [g.s && 'SELECT', g.i && 'INSERT', g.u && 'UPDATE'].filter(Boolean).join(','),
    comment: c.body ?? '',
  };
}

const line = (label, s) => console.log(
  `  ${label.padEnd(28)} policy=${String(s.policy).padEnd(5)} DELETE=${String(s.delete_grant).padEnd(5)} grants=${s.grants || '(none)'}`);

console.log(`\nConvergence of ${TABLE} across two migration histories\n`);

console.log('A — fresh replay (production, and every new database)');
const fresh = await observe(await replay(files));
line(`${files.length} migrations`, fresh);

console.log('\nB — a database already past the cutoff (this PR\'s Supabase preview)');
const applied = await replay(files.filter(f => f <= CUTOFF));
const before = await observe(applied);
line(`stopped at ${CUTOFF.slice(0, 14)}`, before);
const remaining = files.filter(f => f > CUTOFF);
for (const f of remaining) await applied.exec(await read(f));
const after = await observe(applied);
line(`+ ${remaining.length} remaining`, after);

const problems = [];

// 1. The comparison must be capable of showing a difference. If the two
//    histories were already identical before the repair, this check would
//    pass without testing anything — the failure mode of every convergence
//    claim that is asserted rather than run.
console.log('\nIs there a drift for this to close?');
const drifted = ['policy', 'delete_grant', 'grants', 'comment']
  .filter(k => String(before[k]) !== String(fresh[k]));
if (drifted.length === 0) {
  problems.push('the two histories were already identical before the remaining migrations ran, '
    + 'so this check proves nothing — move the cutoff to a version that predates the divergence');
  console.log('  NONE — see failure below');
} else {
  console.log(`  yes: ${drifted.join(', ')} differed before the remaining migrations ran`);
}

// 2. They must end in the same state.
console.log('\nDo they converge?');
for (const k of ['policy', 'delete_grant', 'grants', 'comment']) {
  const a = String(fresh[k]), b = String(after[k]);
  const ok = a === b;
  if (!ok) problems.push(`${k} differs: fresh=${a.slice(0, 40)} applied=${b.slice(0, 40)}`);
  const show = k === 'comment' ? `${a.length} chars` : a;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${k.padEnd(13)} ${ok ? show : 'fresh=' + a.slice(0, 30) + ' applied=' + b.slice(0, 30)}`);
}

// 3. Converging is not enough — they must converge on the RIGHT state, or two
//    databases agreeing that the barrier is gone would pass.
console.log('\nIs the converged state the intended one?');
const checks = [
  [after.policy, `${TABLE} carries its "${POLICY}" policy`],
  [after.delete_grant === false, `authenticated holds no DELETE on ${TABLE}`],
  [after.grants === 'SELECT,INSERT,UPDATE', 'publishing and retraction still work (SELECT,INSERT,UPDATE)'],
  // The comment converging says nothing about whether it is TRUE. A stale
  // comment claiming there is no DELETE policy, next to a DELETE policy, is
  // the next reader's wrong answer.
  [!(after.policy && /deliberately no DELETE policy/i.test(after.comment)),
    'the table comment does not contradict the policy that is actually there'],
];
for (const [ok, what] of checks) {
  if (!ok) problems.push(what);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${what}`);
}

// 4. And the suite that asserts all this must pass against the applied
//    history, not only the fresh one it is normally run against.
let suiteErr = null;
try { await applied.exec(await readTest(SUITE)); } catch (e) { suiteErr = e.message.split('\n')[0]; }
if (suiteErr) problems.push(`${SUITE} fails on the already-applied history: ${suiteErr}`);
console.log(`  ${suiteErr ? 'FAIL' : 'OK  '} ${SUITE} passes on the already-applied history${suiteErr ? ' — ' + suiteErr : ''}`);

if (problems.length) {
  console.error(`\nNOT CONVERGED:\n${problems.map(p => '  - ' + p).join('\n')}\n`);
  process.exit(1);
}
console.log('\nCONVERGED — both histories end identical, and in the intended state.\n');
