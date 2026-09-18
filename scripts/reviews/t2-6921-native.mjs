#!/usr/bin/env node
// Reuse the prior committed concurrency/cleanup harness; only its replay input
// and the unrelated rating-suite selection change. No application SQL changes.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { candidate, priorReview, candidateMigrations, readCandidate, readPriorReview } from './t2-6921-source.mjs';

if (process.argv.length !== 2) throw new Error('Usage: node scripts/reviews/t2-6921-native.mjs');
const migrations = candidateMigrations();
let harness = readPriorReview('scripts/test-feedback-review.mjs');
const nativeLibrary = readPriorReview('scripts/test-native-db.mjs');
const auditSql = readPriorReview('supabase/tests/feedback_storage_review.sql');
function replaceOnce(before, after) {
  if (harness.split(before).length !== 2) throw new Error('Pinned native harness adapter target is not unique');
  harness = harness.replace(before, after);
}

// The prior harness's general replay includes unrelated unmerged fixtures.
// Supply just the exact candidate bootstrap/migrations; keep all FS7/FS8,
// first-publication and restricted-default assertions unchanged.
replaceOnce('buildReplayPlan, childEnvironment', 'childEnvironment');
replaceOnce("const root = fileURLToPath(new URL('../', import.meta.url));", `const root = fileURLToPath(new URL('../', import.meta.url));
async function buildReplayPlan() {
  return { sql: await readFile(join(root, 'candidate-replay.sql'), 'utf8'), migrationCount: ${migrations.length} };
}`);
replaceOnce("['coach_rating_contract.sql', 'feedback_storage_review.sql']", "['feedback_storage_review.sql']");
replaceOnce('real migrations and sequential suites.', 'exact candidate migrations; independent feedback storage and native concurrency checks follow.');
const replay = "\\set ON_ERROR_STOP on\nSET client_min_messages = warning;\n"
  + readCandidate('supabase/tests/bootstrap.sql')
  + migrations.map(file => `\n\\echo [stage] ${file.name}\n${file.sql}\n`).join('');

const directory = await mkdtemp(join(tmpdir(), 'trak-t2-6921-input-'));
try {
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'supabase/tests'), { recursive: true });
  await writeFile(join(directory, 'scripts/test-feedback-review.mjs'), harness);
  await writeFile(join(directory, 'scripts/test-native-db.mjs'), nativeLibrary);
  await writeFile(join(directory, 'supabase/tests/feedback_storage_review.sql'), auditSql);
  await writeFile(join(directory, 'candidate-replay.sql'), replay);
  console.log(`[t2-review] Candidate ${candidate}; native harness/SQL ${priorReview}.`);
  // The reused harness isolates libpq environment, uses its own short private
  // Unix socket with TCP disabled, bounds subprocesses and verifies shutdown.
  execFileSync(process.execPath, [join(directory, 'scripts/test-feedback-review.mjs')], {
    stdio: 'inherit', env: process.env,
  });
} catch (error) {
  console.error(`[t2-review] Native review did not pass: ${error.message}`);
  process.exitCode = 1;
} finally {
  // This directory contains scripts/SQL only. The reused runner independently
  // owns cluster cleanup and preserves diagnostics if cluster shutdown fails.
  await rm(directory, { recursive: true, force: true });
}
