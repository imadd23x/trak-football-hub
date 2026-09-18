import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { evaluateAuditReport, formatAuditSummary } from '../../scripts/governance/audit-ratchet.mjs';

// Deliberately synthetic contract records, never a Trak security baseline.
const SOURCE = 'a'.repeat(40), RUNNER = 'b'.repeat(40), INVENTORY = 'c'.repeat(40), CANDIDATE = 'd'.repeat(40);
const cli = fileURLToPath(new URL('../../scripts/governance/audit-ratchet.mjs', import.meta.url));
function fixture() {
  const baseline = { version: 1, suites: [{
    id: 'synthetic-security', sourceRevision: SOURCE, runnerRevision: RUNNER, inventoryRevision: INVENTORY,
    assertions: [
      { id: 'actor-own-record', kind: 'control', expected: 'pass' },
      { id: 'known-private-read', kind: 'check', expected: 'fail' },
      { id: 'foreign-write', kind: 'check', expected: 'pass' },
    ],
  }] };
  const report = { version: 1, candidateRevision: CANDIDATE, suites: [{
    id: 'synthetic-security', sourceRevision: CANDIDATE, runnerRevision: RUNNER, inventoryRevision: INVENTORY,
    status: 'complete', assertions: baseline.suites[0].assertions.map(({ id, kind, expected }) => ({ id, kind, status: expected })),
  }] };
  return { baseline, report, evaluate: () => evaluateAuditReport(baseline, report, CANDIDATE) };
}
const codes = result => result.violations.map(issue => issue.code);

test('accepts only the exact named historical debt with passing positive controls', () => {
  const result = fixture().evaluate();
  assert.equal(result.ok, true);
  assert.deepEqual(result.acceptedDebt, ['synthetic-security/known-private-read']);
  assert.equal(result.suites[0].baselineSourceRevision, SOURCE);
  assert.equal(result.suites[0].sourceRevision, CANDIDATE);
});

test('one fixed old failure plus one new failure cannot pass with the same count', () => {
  const data = fixture();
  data.report.suites[0].assertions[1].status = 'pass';
  data.report.suites[0].assertions[2].status = 'fail';
  assert.equal(data.report.suites[0].assertions.filter(item => item.status === 'fail').length, 1);
  const result = data.evaluate();
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['baseline-reduction-required', 'new-failure']);
});

test('a repaired failure requires baseline reduction, then recurrence is a new failure', () => {
  const data = fixture();
  data.report.suites[0].assertions[1].status = 'pass';
  assert.deepEqual(codes(data.evaluate()), ['baseline-reduction-required']);
  data.baseline.suites[0].assertions[1].expected = 'pass';
  data.baseline.suites[0].sourceRevision = CANDIDATE;
  assert.equal(data.evaluate().ok, true);
  data.report.suites[0].assertions[1].status = 'fail';
  assert.deepEqual(codes(data.evaluate()), ['new-failure']);
});

test('a positive control failure cannot be absorbed by the accepted debt count', () => {
  const data = fixture();
  data.report.suites[0].assertions[1].status = 'pass';
  data.report.suites[0].assertions[0].status = 'fail';
  assert.equal(data.evaluate().ok, false);
  assert.ok(codes(data.evaluate()).includes('failed-control'));
});

test('rejects a baseline waiver for a control', () => {
  const data = fixture();
  data.baseline.suites[0].assertions[0].expected = 'fail';
  assert.throws(data.evaluate, /cannot waive a control/);
});

for (const status of ['skipped', 'error']) {
  test(`rejects ${status} even for a known failing assertion`, () => {
    const data = fixture();
    data.report.suites[0].assertions[1].status = status;
    assert.deepEqual(codes(data.evaluate()), ['assertion-execution']);
  });
  test(`rejects ${status} suite status despite matching assertion outcomes`, () => {
    const data = fixture();
    data.report.suites[0].status = status;
    assert.deepEqual(codes(data.evaluate()), ['suite-execution']);
  });
}

test('runner error without any results fails execution and the entire required inventory', () => {
  const data = fixture();
  data.report.suites[0].status = 'error';
  data.report.suites[0].assertions = [];
  const result = data.evaluate();
  assert.equal(result.ok, false);
  assert.equal(codes(result).filter(code => code === 'missing-assertion').length, 3);
  assert.ok(codes(result).includes('suite-execution'));
});

test('missing expected failure is not a fix and missing suite is not a skip waiver', () => {
  const data = fixture();
  data.report.suites[0].assertions.splice(1, 1);
  assert.deepEqual(codes(data.evaluate()), ['missing-assertion']);
  data.report.suites[0].id = 'unregistered-suite';
  const result = data.evaluate();
  assert.ok(codes(result).includes('missing-suite'));
  assert.ok(codes(result).includes('unexpected-suite'));
  assert.equal(result.ok, false);
});

for (const input of ['baseline', 'report']) {
  test(`duplicate suite IDs in ${input} cannot overwrite each other`, () => {
    const data = fixture();
    data[input].suites.push(structuredClone(data[input].suites[0]));
    assert.throws(data.evaluate, /duplicate ID synthetic-security/);
  });
  test(`duplicate assertion IDs in ${input} cannot hide a failure`, () => {
    const data = fixture();
    data[input].suites[0].assertions.push(structuredClone(data[input].suites[0].assertions[1]));
    assert.throws(data.evaluate, /duplicate ID known-private-read/);
  });
}

test('wrong candidate revision is rejected independently of suite source declarations', () => {
  const data = fixture();
  data.report.candidateRevision = SOURCE;
  assert.deepEqual(codes(data.evaluate()), ['candidate-revision']);
});

for (const [field, code] of [['sourceRevision', 'source-revision'], ['runnerRevision', 'runner-revision'], ['inventoryRevision', 'inventory-revision']]) {
  test(`stale ${field} is rejected`, () => {
    const data = fixture();
    data.report.suites[0][field] = 'e'.repeat(40);
    assert.deepEqual(codes(data.evaluate()), [code]);
  });
}

test('an assertion rename or added test requires trusted inventory review', () => {
  const data = fixture();
  data.report.suites[0].assertions[2].id = 'new-test-name';
  assert.deepEqual(codes(data.evaluate()), ['missing-assertion', 'unexpected-assertion']);
});

test('changing a control into a normal check cannot evade its identity', () => {
  const data = fixture();
  data.report.suites[0].assertions[0].kind = 'check';
  assert.deepEqual(codes(data.evaluate()), ['assertion-kind']);
});

test('strict schemas reject unknown fields, missing status, coercion and empty inventories', () => {
  const modifications = [
    data => { data.report.allowFailure = true; },
    data => { delete data.report.suites[0].assertions[0].status; },
    data => { data.report.suites[0].assertions[0].status = true; },
    data => { data.report.suites = []; },
    data => { data.baseline.suites[0].assertions = []; },
    data => { data.baseline.suites[0].assertions = data.baseline.suites[0].assertions.filter(item => item.kind !== 'control'); },
    data => { data.report.version = '1'; },
    data => { data.report.candidateRevision = 'HEAD'; },
  ];
  for (const modify of modifications) {
    const data = fixture();
    modify(data);
    assert.throws(data.evaluate, /Invalid audit contract/);
  }
});

test('summary exposes each assertion and provenance without interpreting report markdown', () => {
  const data = fixture();
  data.report.suites[0].assertions[1].detail = '<script>oops</script> | hidden\n## fake pass `code` ![remote](https://example.invalid/image)';
  const summary = formatAuditSummary(data.evaluate());
  for (const revision of [SOURCE, RUNNER, INVENTORY, CANDIDATE]) assert.ok(summary.includes(revision));
  assert.ok(summary.includes('| known-private-read | check | fail | fail |'));
  assert.ok(summary.includes('not a security pass'));
  assert.ok(!summary.includes('<script>'));
  assert.ok(!summary.includes('\n## fake pass'));
  assert.ok(!summary.includes('![remote]'));
  assert.ok(summary.includes('&#124;'));
});

async function cliFixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'trak-audit-contract-'));
  const data = fixture();
  const baselinePath = join(directory, 'baseline.json'), reportPath = join(directory, 'report.json'), summaryPath = join(directory, 'summary.md');
  const run = async (extra = []) => {
    await writeFile(baselinePath, JSON.stringify(data.baseline));
    await writeFile(reportPath, JSON.stringify(data.report));
    return spawnSync(process.execPath, [cli, '--baseline', baselinePath, '--report', reportPath, '--candidate-revision', CANDIDATE, ...extra],
      { encoding: 'utf8', timeout: 10_000, env: { GITHUB_STEP_SUMMARY: summaryPath }, maxBuffer: 1_000_000 });
  };
  try { await callback({ ...data, directory, baselinePath, reportPath, summaryPath, run }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('CLI accepts named debt, emits structured results and appends a Step Summary', async () => {
  await cliFixture(async ({ run, summaryPath }) => {
    await writeFile(summaryPath, 'Earlier job summary\n');
    const result = await run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    const summary = await readFile(summaryPath, 'utf8');
    assert.ok(summary.startsWith('Earlier job summary\n'));
    assert.ok(summary.includes('1 named failures remain accepted debt'));
    assert.ok(summary.includes('known-private-read'));
  });
});

test('CLI exits nonzero and publishes the exact new failure, not just its count', async () => {
  await cliFixture(async ({ report, run, summaryPath }) => {
    report.suites[0].assertions[2].status = 'fail';
    const result = await run();
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).violations.some(issue => issue.assertionId === 'foreign-write'));
    assert.ok((await readFile(summaryPath, 'utf8')).includes('new-failure'));
  });
});

test('malformed report cannot produce a successful CLI result', async () => {
  await cliFixture(async ({ report, run, summaryPath }) => {
    report.suites[0].assertions[0].status = 'waived';
    const result = await run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid audit contract/);
    assert.ok((await readFile(summaryPath, 'utf8')).includes('No valid audit evaluation'));
  });
});

test('CLI cannot use its summary output to overwrite its trusted input', async () => {
  await cliFixture(async ({ baseline, baselinePath, run }) => {
    const result = await run(['--summary', baselinePath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /summary must not overwrite/);
    assert.deepEqual(JSON.parse(await readFile(baselinePath, 'utf8')), baseline);
  });
});

test('a summary write failure is nonzero even when the assertion debt matches', async () => {
  await cliFixture(async ({ directory, run }) => {
    const result = await run(['--summary', directory]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not write audit summary/);
  });
});
