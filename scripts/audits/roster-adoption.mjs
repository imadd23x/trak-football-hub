#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { evaluateAuditReport, formatAuditSummary } from '../governance/audit-ratchet.mjs';

export const suiteId = 'roster-adoption';
export const runnerRoot = fileURLToPath(new URL('../../', import.meta.url));
export const inventoryPath = 'scripts/audits/roster-adoption.inventory.json';
export const baselinePath = 'scripts/audits/roster-adoption.baseline.json';
export const suitePath = 'supabase/tests/roster_adoption.sql';
const bootstrapPath = 'supabase/tests/bootstrap.sql';
const pinnedRunnerPaths = ['scripts/audits/roster-adoption.mjs', suitePath, bootstrapPath,
  'scripts/governance/audit-ratchet.mjs', 'package.json', 'package-lock.json'];
const revisionPattern = /^[a-f0-9]{40}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}

export function requireCommit(root, revision) {
  requireValue(typeof revision === 'string' && revisionPattern.test(revision), 'Expected an exact lowercase 40-character Git revision');
  requireValue(git(root, ['rev-parse', '--verify', `${revision}^{commit}`]).trim() === revision, 'Revision must identify a commit');
}

export function blob(root, revision, path) {
  return git(root, ['show', `${revision}:${path}`]);
}

export async function verifyPinnedFiles(root, revision, paths) {
  requireCommit(root, revision);
  for (const path of paths) {
    requireValue(await readFile(resolve(root, path), 'utf8') === blob(root, revision, path),
      `Executing runner input differs from pinned revision: ${path}`);
  }
}

export function validateInventory(value) {
  requireValue(value?.version === 1 && value.id === suiteId && Array.isArray(value.assertions) && value.assertions.length > 0,
    'Invalid roster inventory');
  requireValue(Object.keys(value).sort().join(',') === 'assertions,id,version', 'Unknown inventory fields');
  const ids = new Set();
  for (const item of value.assertions) {
    requireValue(Object.keys(item).sort().join(',') === 'id,kind', 'Unknown assertion inventory fields');
    requireValue(/^RA-[A-Za-z0-9-]+$/.test(item.id) && !ids.has(item.id), 'Invalid or duplicate roster assertion ID');
    requireValue(['check', 'control'].includes(item.kind), 'Invalid roster assertion kind');
    ids.add(item.id);
  }
  for (const kind of ['check', 'control']) requireValue(value.assertions.some(item => item.kind === kind), `Inventory needs a ${kind}`);
  return value;
}

/** Trust comes from separately reviewed revision arguments, never candidate JSON. */
export async function readPinnedInputs(runnerRevision, inventoryRevision) {
  requireCommit(runnerRoot, runnerRevision);
  requireCommit(runnerRoot, inventoryRevision);
  await verifyPinnedFiles(runnerRoot, runnerRevision, pinnedRunnerPaths);
  const inventoryText = blob(runnerRoot, inventoryRevision, inventoryPath);
  requireValue(await readFile(resolve(runnerRoot, inventoryPath), 'utf8') === inventoryText, 'Inventory bytes differ from pinned revision');
  return {
    inventory: validateInventory(JSON.parse(inventoryText)),
    bootstrap: blob(runnerRoot, runnerRevision, bootstrapPath),
    sql: blob(runnerRoot, runnerRevision, suitePath),
  };
}

/** Candidate migrations are Git blobs, not mutable checkout files. No HTTP/DB URL. */
export async function replayCandidate(db, candidateRoot, candidateRevision, bootstrap) {
  requireCommit(candidateRoot, candidateRevision);
  const paths = git(candidateRoot, ['ls-tree', '-r', '--name-only', '-z', candidateRevision, '--', 'supabase/migrations'])
    .split('\0').filter(Boolean).sort();
  requireValue(paths.length > 0, 'Candidate has no migrations');
  const versions = new Set();
  for (const path of paths) {
    const match = /^supabase\/migrations\/(\d{14})_[A-Za-z0-9_-]+\.sql$/.exec(path);
    requireValue(match && !versions.has(match[1]), `Unsupported or duplicate migration: ${path}`);
    versions.add(match[1]);
  }
  await db.exec(bootstrap);
  for (const path of paths) {
    try { await db.exec(blob(candidateRoot, candidateRevision, path)); }
    catch (error) { throw new Error(`Migration ${path}: ${error.message}`, { cause: error }); }
  }
  return paths.length;
}

/** Exported for disposable mutation tests; production CLI always uses pinned SQL. */
export async function executeRosterSuite(db, sql, inventory) {
  let result;
  try { result = await db.exec(sql); }
  finally {
    // Required even after fixture/SQL failure. Cleanup failures propagate.
    await db.exec('ROLLBACK; RESET ROLE;');
  }
  const resultSets = result.filter(item => item.fields?.some(field => field.name === 'roster_assertion_id'));
  requireValue(resultSets.length === 1, 'Missing or duplicate roster result set');
  const rows = resultSets[0].rows;
  const expected = new Map(validateInventory(inventory).assertions.map(item => [item.id, item.kind]));
  const seen = new Set();
  for (const row of rows) {
    requireValue(expected.get(row.roster_assertion_id) === row.kind && !seen.has(row.roster_assertion_id), 'Unexpected, duplicate, or misclassified assertion');
    requireValue(['pass', 'fail'].includes(row.status), 'Invalid assertion status');
    requireValue(typeof row.detail === 'string' && row.detail.length <= 4000, 'Invalid assertion detail');
    seen.add(row.roster_assertion_id);
  }
  requireValue(seen.size === expected.size, 'Incomplete roster assertion output');
  const cleanup = await db.query("SELECT count(*)::int AS n FROM auth.users WHERE id::text LIKE '95000000-%'");
  requireValue(cleanup.rows[0]?.n === 0, 'Roster fixture rollback failed');
  return rows.map(({ roster_assertion_id: id, kind, status, detail }) => ({ id, kind, status, detail }));
}

export async function runRosterAudit({ candidateRoot, candidateRevision, runnerRevision, inventoryRevision }) {
  // Validate before starting an engine or accepting any reported revision.
  requireCommit(candidateRoot, candidateRevision);
  const inputs = await readPinnedInputs(runnerRevision, inventoryRevision);
  const suite = { id: suiteId, sourceRevision: candidateRevision, runnerRevision, inventoryRevision,
    status: 'error', assertions: [] };
  const report = { version: 1, candidateRevision, suites: [suite] };
  const db = new PGlite(); // Memory only; never accepts credentials, paths or database targets.
  try {
    const migrationCount = await replayCandidate(db, candidateRoot, candidateRevision, inputs.bootstrap);
    suite.assertions = await executeRosterSuite(db, inputs.sql, inputs.inventory);
    suite.status = 'complete';
    suite.detail = `Replayed ${migrationCount} candidate migrations in memory; synthetic fixture transaction rolled back. Sequential identity safety only; no reconciliation UX or native concurrency claim.`;
  } catch (error) {
    suite.detail = String(error.message).slice(0, 4000);
  } finally {
    try { await db.close(); }
    catch (error) { suite.status = 'error'; suite.detail = `Engine cleanup failed: ${String(error.message).slice(0, 3900)}`; }
  }
  return report;
}

function options(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    requireValue(['--candidate-root', '--candidate-revision', '--baseline-revision'].includes(argv[i]), `Unknown argument: ${argv[i]}`);
    requireValue(!Object.hasOwn(args, argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), `Duplicate/missing argument: ${argv[i]}`);
    args[argv[i]] = argv[i + 1];
  }
  for (const name of ['--candidate-root', '--candidate-revision', '--baseline-revision']) requireValue(args[name], `Required argument: ${name}`);
  return args;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let summary;
  let exitCode = 1;
  try {
    const args = options(argv);
    requireCommit(runnerRoot, args['--baseline-revision']);
    const baseline = JSON.parse(blob(runnerRoot, args['--baseline-revision'], baselinePath));
    requireValue(baseline.suites?.length === 1 && baseline.suites[0].id === suiteId, 'Expected only the reviewed roster baseline');
    const { runnerRevision, inventoryRevision } = baseline.suites[0];
    const report = await runRosterAudit({ candidateRoot: resolve(args['--candidate-root']), candidateRevision: args['--candidate-revision'], runnerRevision, inventoryRevision });
    const evaluation = evaluateAuditReport(baseline, report, args['--candidate-revision']);
    process.stdout.write(`${JSON.stringify({ report, evaluation }, null, 2)}\n`);
    summary = formatAuditSummary(evaluation);
    exitCode = evaluation.ok ? 0 : 1;
  } catch (error) {
    const message = String(error.message);
    process.stderr.write(`Roster audit unverified: ${message}\n`);
    const escaped = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    summary = `## Roster audit rejected\n\nExecution/provenance is unverified. No passing audit result was produced.\n\n<pre>${escaped}</pre>\n`;
  }
  if (env.GITHUB_STEP_SUMMARY) {
    try { await appendFile(env.GITHUB_STEP_SUMMARY, summary); }
    catch (error) { process.stderr.write(`Roster summary failed: ${error.message}\n`); exitCode = 1; }
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
