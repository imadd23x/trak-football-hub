#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { evaluateAuditReport, formatAuditSummary } from '../governance/audit-ratchet.mjs';

export const suiteId = 'consent-privacy';
const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const runnerFiles = [
  'scripts/audits/consent-runner.mjs', 'scripts/audits/consent-inventory.json',
  'scripts/governance/audit-ratchet.mjs', 'supabase/tests/consent_privacy_review.sql',
  'supabase/tests/bootstrap.sql', 'package.json', 'package-lock.json',
];
const baselinePath = 'docs/release/consent-audit-baseline.json';
const shaPattern = /^[a-f0-9]{40}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const fail = message => { throw new Error(message); };

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(`Invalid ${label} fields`);
}

export function validateInventory(inventory) {
  exactKeys(inventory, ['version', 'suite', 'assertions'], 'inventory');
  if (inventory.version !== 1 || inventory.suite !== suiteId || !Array.isArray(inventory.assertions) || !inventory.assertions.length) fail('Invalid consent inventory');
  const seen = new Set();
  for (const row of inventory.assertions) {
    exactKeys(row, ['id', 'kind', 'description'], 'inventory assertion');
    if (typeof row.id !== 'string' || !idPattern.test(row.id) || seen.has(row.id) || !['check', 'control'].includes(row.kind) ||
        typeof row.description !== 'string' || !row.description) fail('Invalid or duplicate inventory assertion');
    seen.add(row.id);
  }
  if (!inventory.assertions.some(row => row.kind === 'check') || !inventory.assertions.some(row => row.kind === 'control')) fail('Consent inventory needs checks and controls');
  return inventory;
}

/** Parse the full SQL envelope; an absent/partial/corrupt result is execution error. */
export function parseAuditResults(results, inventory) {
  validateInventory(inventory);
  if (!Array.isArray(results)) fail('SQL result list is missing');
  const envelopes = results.flatMap(result => result.rows ?? [])
    .filter(row => Object.hasOwn(row, 'consent_privacy_audit_result'));
  if (envelopes.length !== 1) fail('SQL must emit exactly one complete consent audit result');
  const envelope = envelopes[0].consent_privacy_audit_result;
  exactKeys(envelope, ['version', 'suite', 'assertions'], 'SQL result');
  if (envelope.version !== 1 || envelope.suite !== suiteId || !Array.isArray(envelope.assertions)) fail('Invalid SQL consent result');
  const expected = new Map(inventory.assertions.map(row => [row.id, row]));
  const seen = new Set();
  for (const row of envelope.assertions) {
    exactKeys(row, ['id', 'kind', 'status', 'detail'], 'SQL assertion');
    if (!expected.has(row.id) || seen.has(row.id) || row.kind !== expected.get(row.id).kind ||
        !['pass', 'fail'].includes(row.status) || typeof row.detail !== 'string' || row.detail.length > 4000) fail('Invalid, duplicate or unexpected SQL assertion');
    seen.add(row.id);
  }
  if (seen.size !== expected.size) fail('SQL result is missing required assertions');
  return envelope.assertions;
}

/** In-memory engine only. Injectable factory is for fault tests, never a URL option. */
export async function executeConsentAudit(bundle, { createDatabase = () => new PGlite() } = {}) {
  const suite = { id: suiteId, sourceRevision: bundle.candidateRevision,
    runnerRevision: bundle.runnerRevision, inventoryRevision: bundle.runnerRevision,
    status: 'error', assertions: [] };
  let db;
  let phase = 'initialization';
  const errors = [];
  try {
    validateInventory(bundle.inventory);
    db = await createDatabase();
    phase = 'bootstrap';
    await db.exec(bundle.bootstrap);
    await db.exec("SET statement_timeout = '30s'; SET TIME ZONE 'UTC';");
    for (const migration of bundle.migrations) {
      phase = `migration ${migration.name}`;
      await db.exec(migration.sql);
    }
    phase = 'consent fixtures and assertions';
    const results = await db.exec(bundle.auditSql);
    phase = 'complete result validation';
    suite.assertions = parseAuditResults(results, bundle.inventory);
    phase = 'fixture rollback verification';
    const { rows } = await db.query(`SELECT
      current_setting('role') = 'none' AS role_reset,
      to_regclass('pg_temp.consent_privacy_results') IS NULL AS result_removed,
      NOT EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE '95000000-%') AS fixtures_removed`);
    if (rows.length !== 1 || rows[0].role_reset !== true || rows[0].result_removed !== true || rows[0].fixtures_removed !== true) fail('Audit transaction did not roll back completely');
    suite.status = 'complete';
  } catch (error) {
    errors.push(`${phase}: ${error.message}${error.code ? ` [${error.code}]` : ''}`);
  } finally {
    if (db) {
      // A failed statement can leave a transaction aborted. Neither rollback
      // nor close errors may be swallowed by an otherwise matching debt set.
      try { await db.exec('ROLLBACK'); } catch (error) { errors.push(`rollback cleanup: ${error.message}`); }
      try { await db.close(); } catch (error) { errors.push(`database close: ${error.message}`); }
    }
  }
  if (errors.length) { suite.status = 'error'; suite.detail = errors.join('\n').slice(0, 4000); }
  return { version: 1, candidateRevision: bundle.candidateRevision, suites: [suite] };
}

function git(cwd, ...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_SYSTEM = '/dev/null';
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}
function revision(value) {
  if (typeof value !== 'string' || !shaPattern.test(value)) fail('Expected an exact lowercase 40-character Git revision');
  return value;
}
const blob = (cwd, sha, path) => git(cwd, 'show', `${revision(sha)}:${path}`);

export function loadGitBundle({ candidateRoot, candidateRevision, runnerRevision, trustedRoot = runnerRoot }) {
  revision(candidateRevision); revision(runnerRevision);
  for (const [cwd, sha] of [[candidateRoot, candidateRevision], [trustedRoot, runnerRevision]]) git(cwd, 'cat-file', '-e', `${sha}^{commit}`);
  if (git(candidateRoot, 'rev-parse', 'HEAD').trim() !== candidateRevision) fail('Candidate revision does not match checked-out HEAD');
  if (git(candidateRoot, 'status', '--porcelain=v1', '--untracked-files=all', '--', 'supabase/migrations').trim()) fail('Candidate migration files are dirty or untracked');
  // Execute reviewed code and SQL, not a candidate-provided JSON assertion or
  // edited local runner. CI installs this same reviewed dependency lock.
  for (const path of runnerFiles) {
    if (readFileSync(resolve(trustedRoot, path), 'utf8') !== blob(trustedRoot, runnerRevision, path)) fail(`Runner input differs from pinned Git object: ${path}`);
  }
  const entries = git(candidateRoot, 'ls-tree', '-r', '-z', candidateRevision, '--', 'supabase/migrations').split('\0').filter(Boolean);
  const migrations = [];
  for (const entry of entries) {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(supabase\/migrations\/\d{14}_[A-Za-z0-9_.-]+\.sql)$/.exec(entry);
    if (!match) fail('Unexpected candidate migration tree entry');
    migrations.push({ name: match[2].split('/').at(-1), sql: blob(candidateRoot, candidateRevision, match[2]) });
  }
  if (!migrations.length || new Set(migrations.map(row => row.name.slice(0, 14))).size !== migrations.length) fail('Missing or duplicate candidate migration versions');
  migrations.sort((a, b) => a.name.localeCompare(b.name));
  return { candidateRevision, runnerRevision, migrations,
    bootstrap: blob(trustedRoot, runnerRevision, 'supabase/tests/bootstrap.sql'),
    auditSql: blob(trustedRoot, runnerRevision, 'supabase/tests/consent_privacy_review.sql'),
    inventory: validateInventory(JSON.parse(blob(trustedRoot, runnerRevision, 'scripts/audits/consent-inventory.json'))) };
}

function optionsFrom(argv) {
  const result = {};
  const names = new Map([['--candidate-root', 'candidateRoot'], ['--candidate-revision', 'candidateRevision'],
    ['--runner-revision', 'runnerRevision'], ['--policy-revision', 'policyRevision'], ['--report', 'reportPath']]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    if (!key || result[key] || !argv[index + 1]) fail('Invalid consent audit arguments');
    result[key] = argv[index + 1];
  }
  if (!result.candidateRoot || !result.reportPath) fail('Required: --candidate-root, --candidate-revision, --runner-revision, --report; optional --policy-revision');
  revision(result.candidateRevision); revision(result.runnerRevision);
  if (result.policyRevision) revision(result.policyRevision);
  return result;
}

export async function main(argv, env = process.env) {
  let options;
  let report;
  try {
    options = optionsFrom(argv);
    const bundle = loadGitBundle(options);
    const baseline = options.policyRevision ? JSON.parse(blob(runnerRoot, options.policyRevision, baselinePath)) : null;
    if (baseline && (baseline.suites.length !== 1 || baseline.suites[0].id !== suiteId ||
        baseline.suites[0].runnerRevision !== options.runnerRevision || baseline.suites[0].inventoryRevision !== options.runnerRevision)) fail('Policy does not pin this consent runner and inventory');
    report = await executeConsentAudit(bundle);
    writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    if (baseline) {
      const evaluation = evaluateAuditReport(baseline, report, options.candidateRevision);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, formatAuditSummary(evaluation));
      console.log(JSON.stringify({ migrations: bundle.migrations.length, ...evaluation }, null, 2));
      return evaluation.ok ? 0 : 1;
    }
    // Capture mode records fresh evidence before a baseline exists; observed
    // behavior failures still exit nonzero. It never creates debt allowances.
    console.log(JSON.stringify({ migrations: bundle.migrations.length, ...report }, null, 2));
    return report.suites.every(suite => suite.status === 'complete' && suite.assertions.every(row => row.status === 'pass')) ? 0 : 1;
  } catch (error) {
    console.error(`Consent audit failed: ${error.message}`);
    if (env.GITHUB_STEP_SUMMARY) {
      const escaped = String(error.message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      try { appendFileSync(env.GITHUB_STEP_SUMMARY, `## Consent audit: ERROR\n\n<pre>${escaped}</pre>\n`); } catch { /* Nonzero exit already mandatory. */ }
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
