#!/usr/bin/env node
import { appendFile, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const revisionPattern = /^[a-f0-9]{40}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const assertionStatuses = ['pass', 'fail', 'error', 'skipped'];

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid audit contract: ${message}`);
}

function object(value, required, optional, path) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} must be an object`);
  requireValue(required.every(key => Object.hasOwn(value, key)), `${path} is missing required fields`);
  requireValue(Object.keys(value).every(key => [...required, ...optional].includes(key)), `${path} has unknown fields`);
}

function revision(value, path) {
  requireValue(typeof value === 'string' && revisionPattern.test(value), `${path} must be an exact lowercase 40-character Git revision`);
}

function inventory(values, path) {
  requireValue(Array.isArray(values) && values.length > 0, `${path} must be a nonempty array`);
  const ids = new Set();
  for (const value of values) {
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} contains a non-object`);
    requireValue(typeof value.id === 'string' && idPattern.test(value.id), `${path} contains an invalid ID`);
    requireValue(!ids.has(value.id), `${path} contains duplicate ID ${value.id}`);
    ids.add(value.id);
  }
}

function detail(value, path) {
  if (Object.hasOwn(value, 'detail')) requireValue(typeof value.detail === 'string' && value.detail.length <= 4000,
    `${path}.detail must be a string of at most 4000 characters`);
}

function validateBaseline(baseline) {
  object(baseline, ['version', 'suites'], [], 'baseline');
  requireValue(baseline.version === 1, 'baseline.version must be 1');
  inventory(baseline.suites, 'baseline.suites');
  for (const suite of baseline.suites) {
    const path = `baseline.${suite.id}`;
    object(suite, ['id', 'sourceRevision', 'runnerRevision', 'inventoryRevision', 'assertions'], [], path);
    for (const field of ['sourceRevision', 'runnerRevision', 'inventoryRevision']) revision(suite[field], `${path}.${field}`);
    inventory(suite.assertions, `${path}.assertions`);
    for (const assertion of suite.assertions) {
      object(assertion, ['id', 'kind', 'expected'], [], `${path}.${assertion.id}`);
      requireValue(['check', 'control'].includes(assertion.kind), `${path}.${assertion.id}.kind is invalid`);
      requireValue(['pass', 'fail'].includes(assertion.expected), `${path}.${assertion.id}.expected is invalid`);
      requireValue(assertion.kind !== 'control' || assertion.expected === 'pass', `${path}.${assertion.id} cannot waive a control`);
    }
    requireValue(suite.assertions.some(assertion => assertion.kind === 'control'), `${path} needs at least one positive control`);
    requireValue(suite.assertions.some(assertion => assertion.kind === 'check'), `${path} needs at least one behavior check`);
  }
}

function validateReport(report) {
  object(report, ['version', 'candidateRevision', 'suites'], [], 'report');
  requireValue(report.version === 1, 'report.version must be 1');
  revision(report.candidateRevision, 'report.candidateRevision');
  inventory(report.suites, 'report.suites');
  for (const suite of report.suites) {
    const path = `report.${suite.id}`;
    object(suite, ['id', 'sourceRevision', 'runnerRevision', 'inventoryRevision', 'status', 'assertions'], ['detail'], path);
    for (const field of ['sourceRevision', 'runnerRevision', 'inventoryRevision']) revision(suite[field], `${path}.${field}`);
    requireValue(['complete', 'error', 'skipped'].includes(suite.status), `${path}.status is invalid`);
    detail(suite, path);
    // Error/skipped suites may lack results; evaluation still rejects both
    // the execution failure and every missing assertion from the inventory.
    requireValue(Array.isArray(suite.assertions), `${path}.assertions must be an array`);
    if (suite.assertions.length) inventory(suite.assertions, `${path}.assertions`);
    for (const assertion of suite.assertions) {
      object(assertion, ['id', 'kind', 'status'], ['detail'], `${path}.${assertion.id}`);
      requireValue(['check', 'control'].includes(assertion.kind), `${path}.${assertion.id}.kind is invalid`);
      requireValue(assertionStatuses.includes(assertion.status), `${path}.${assertion.id}.status is invalid`);
      detail(assertion, `${path}.${assertion.id}`);
    }
  }
}

/** Evaluate data only: this does not execute suites or authenticate their origin. */
export function evaluateAuditReport(baseline, report, candidateRevision) {
  validateBaseline(baseline);
  validateReport(report);
  revision(candidateRevision, 'expected candidate revision');
  const violations = [];
  const add = (code, message, suiteId, assertionId) => violations.push({ code, message,
    ...(suiteId ? { suiteId } : {}), ...(assertionId ? { assertionId } : {}) });
  if (report.candidateRevision !== candidateRevision) add('candidate-revision', 'Report candidate does not match the independently supplied candidate revision');
  const expectedSuites = new Map(baseline.suites.map(suite => [suite.id, suite]));
  const actualSuites = new Map(report.suites.map(suite => [suite.id, suite]));
  const suites = [];
  for (const expected of baseline.suites) {
    const actual = actualSuites.get(expected.id);
    if (!actual) add('missing-suite', 'Required suite is absent', expected.id);
    if (actual) {
      if (actual.sourceRevision !== candidateRevision) add('source-revision', 'Suite did not report the exact candidate source revision', expected.id);
      for (const field of ['runnerRevision', 'inventoryRevision']) {
        if (actual[field] !== expected[field]) add(field === 'runnerRevision' ? 'runner-revision' : 'inventory-revision',
          `${field} differs from the trusted baseline`, expected.id);
      }
      if (actual.status !== 'complete') add('suite-execution', `Suite execution status is ${actual.status}`, expected.id);
    }
    const actualAssertions = new Map((actual?.assertions ?? []).map(assertion => [assertion.id, assertion]));
    const expectedAssertions = new Set(expected.assertions.map(assertion => assertion.id));
    const assertions = expected.assertions.map(assertion => {
      const observed = actualAssertions.get(assertion.id);
      if (!observed) add('missing-assertion', 'Required assertion is absent', expected.id, assertion.id);
      else {
        if (observed.kind !== assertion.kind) add('assertion-kind', 'Assertion kind differs from the trusted inventory', expected.id, assertion.id);
        if (observed.status === 'error' || observed.status === 'skipped') add('assertion-execution',
          `Assertion execution status is ${observed.status}`, expected.id, assertion.id);
        else if (assertion.kind === 'control' && observed.status !== 'pass') add('failed-control', 'A positive control failed', expected.id, assertion.id);
        else if (assertion.expected === 'pass' && observed.status === 'fail') add('new-failure', 'An assertion outside the accepted debt failed', expected.id, assertion.id);
        else if (assertion.expected === 'fail' && observed.status === 'pass') add('baseline-reduction-required',
          'Previously failing assertion now passes; remove its accepted debt before this gate can pass', expected.id, assertion.id);
      }
      return { id: assertion.id, kind: assertion.kind, expected: assertion.expected, status: observed?.status ?? 'missing',
        ...(observed?.detail ? { detail: observed.detail } : {}) };
    });
    for (const observed of actual?.assertions ?? []) {
      if (!expectedAssertions.has(observed.id)) {
        add('unexpected-assertion', 'Assertion is absent from the trusted inventory', expected.id, observed.id);
        assertions.push({ ...observed, expected: 'unlisted' });
      }
    }
    suites.push({ id: expected.id, baselineSourceRevision: expected.sourceRevision,
      sourceRevision: actual?.sourceRevision ?? null,
      runnerRevision: actual?.runnerRevision ?? null, inventoryRevision: actual?.inventoryRevision ?? null,
      status: actual?.status ?? 'missing', assertions, ...(actual?.detail ? { detail: actual.detail } : {}) });
  }
  for (const actual of report.suites) {
    if (!expectedSuites.has(actual.id)) {
      add('unexpected-suite', 'Suite is absent from the trusted inventory', actual.id);
      suites.push({ ...actual, baselineSourceRevision: null,
        assertions: actual.assertions.map(assertion => ({ ...assertion, expected: 'unlisted' })) });
    }
  }
  const acceptedDebt = suites.flatMap(suite => suite.assertions
    .filter(assertion => assertion.expected === 'fail' && assertion.status === 'fail')
    .map(assertion => `${suite.id}/${assertion.id}`));
  return { ok: violations.length === 0, candidateRevision, reportedCandidateRevision: report.candidateRevision,
    acceptedDebt, suites, violations };
}

const cell = value => String(value ?? 'missing').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;')
  .replace(/[\[\]!*_\\]/g, character => `&#${character.charCodeAt(0)};`).replace(/[\r\n]+/g, ' ');

export function formatAuditSummary(result) {
  const lines = ['## Explicit audit debt gate', '', `Candidate: \`${cell(result.candidateRevision)}\`.`, '',
    result.ok ? `Gate accepted; ${result.acceptedDebt.length} named failures remain accepted debt.` : 'Gate rejected.',
    'This gate is not a security pass or pilot-readiness approval.', ''];
  for (const suite of result.suites) {
    lines.push(`### ${cell(suite.id)} — ${cell(suite.status)}`, '',
      `Baseline source: \`${cell(suite.baselineSourceRevision)}\`; tested source: \`${cell(suite.sourceRevision)}\`.`,
      `Runner: \`${cell(suite.runnerRevision)}\`; inventory: \`${cell(suite.inventoryRevision)}\`.`, '',
      '| Assertion | Kind | Expected | Observed | Detail |', '| --- | --- | --- | --- | --- |');
    for (const assertion of suite.assertions) lines.push(`| ${cell(assertion.id)} | ${cell(assertion.kind)} | ${cell(assertion.expected)} | ${cell(assertion.status)} | ${cell(assertion.detail ?? '')} |`);
    if (suite.detail) lines.push('', `Execution detail: ${cell(suite.detail)}`);
    lines.push('');
  }
  if (result.violations.length) {
    lines.push('### Violations', '');
    for (const issue of result.violations) lines.push(`- ${cell(issue.code)}: ${cell([issue.suiteId, issue.assertionId].filter(Boolean).join('/'))} ${cell(issue.message)}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function options(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    requireValue(['--baseline', '--report', '--candidate-revision', '--summary'].includes(flag), `unknown argument ${flag}`);
    requireValue(!Object.hasOwn(values, flag), `duplicate argument ${flag}`);
    requireValue(typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'), `missing value for ${flag}`);
    values[flag] = argv[index + 1];
  }
  for (const flag of ['--baseline', '--report', '--candidate-revision']) requireValue(values[flag], `required argument ${flag}`);
  return values;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let summaryPath = env.GITHUB_STEP_SUMMARY;
  let summary;
  let exitCode = 1;
  try {
    const args = options(argv);
    summaryPath = args['--summary'] ?? summaryPath;
    if (summaryPath) {
      for (const path of [args['--baseline'], args['--report']]) {
        requireValue(resolve(summaryPath) !== resolve(path), 'summary must not overwrite a baseline or report');
      }
      const summaryIdentity = await realpath(summaryPath).catch(() => resolve(summaryPath));
      for (const path of [args['--baseline'], args['--report']]) {
        requireValue(summaryIdentity !== await realpath(path), 'summary must not overwrite a baseline or report');
      }
    }
    const baseline = JSON.parse(await readFile(args['--baseline'], 'utf8'));
    const report = JSON.parse(await readFile(args['--report'], 'utf8'));
    const result = evaluateAuditReport(baseline, report, args['--candidate-revision']);
    summary = formatAuditSummary(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Audit gate rejected: ${message}\n`);
    summary = `## Explicit audit debt gate\n\nGate rejected: ${cell(message)}\n\nNo valid audit evaluation was produced.\n`;
    // A bad output destination must never corrupt either trusted input.
    if (message.includes('summary must not overwrite')) summaryPath = undefined;
  }
  if (summaryPath) {
    try { await appendFile(summaryPath, summary); }
    catch (error) { process.stderr.write(`Could not write audit summary: ${error.message}\n`); exitCode = 1; }
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
