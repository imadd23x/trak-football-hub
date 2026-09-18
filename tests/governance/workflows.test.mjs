import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { runInNewContext } from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const ci = parse(read('.github/workflows/ci.yml'));
const governance = parse(read('.github/workflows/merge-base.yml'));
const protection = JSON.parse(read('docs/release/main-branch-protection.json'));

async function resolveCandidate(eventHead, apiHead) {
  const outputs = {};
  const script = governance.jobs['base-reaches-main'].steps.find(step => step.id === 'candidate').with.script;
  const context = { repo: { owner: 'example', repo: 'trak' }, payload: { pull_request: { number: 10, head: { sha: eventHead } } } };
  const github = { rest: {
    pulls: { get: async () => ({ data: { head: { sha: apiHead } } }) },
    repos: { getBranch: async () => ({ data: { commit: { sha: 'c'.repeat(40) } } }) },
  } };
  await runInNewContext(`(async () => { ${script} })()`, { context, github, core: { setOutput: (key, value) => { outputs[key] = value; } }, process: { env: {} } }, { timeout: 1000 });
  return outputs;
}
test('actual Actions metadata script refuses to certify a different head than its event', async () => {
  await assert.rejects(resolveCandidate('a'.repeat(40), 'b'.repeat(40)), /head changed since this event/);
  assert.equal((await resolveCandidate('a'.repeat(40), 'a'.repeat(40))).head, 'a'.repeat(40));
});

test('the protection proposal requires jobs that actually exist, independent review and current main', () => {
  const jobs = new Set([...Object.entries(ci.jobs), ...Object.entries(governance.jobs)].map(([id, job]) => job.name ?? id));
  for (const name of protection.required_status_checks.contexts) assert.ok(jobs.has(name), `Missing required job ${name}`);
  assert.deepEqual(protection.required_status_checks.contexts, ['test', 'Merge policy', 'Roster adoption audit']);
  assert.equal(protection.required_status_checks.strict, true);
  assert.equal(protection.enforce_admins, true);
  assert.equal(protection.required_pull_request_reviews.required_approving_review_count, 1);
  assert.equal(protection.required_pull_request_reviews.require_last_push_approval, true);
  assert.equal(protection.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(protection.required_pull_request_reviews.require_code_owner_reviews, true);
});
test('author edits and review changes rerun policy without a privileged PR execution event', () => {
  assert.deepEqual(governance.on.pull_request.branches, ['**']);
  assert.equal(governance.on.pull_request_target, undefined);
  for (const type of ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review', 'closed']) assert.ok(governance.on.pull_request.types.includes(type));
  for (const type of ['submitted', 'dismissed', 'edited']) assert.ok(governance.on.pull_request_review.types.includes(type));
  assert.deepEqual(governance.permissions, { contents: 'read', 'pull-requests': 'read', actions: 'read' });
  assert.equal(read('.github/workflows/merge-base.yml').includes('secrets.'), false);
  for (const job of Object.values(governance.jobs)) {
    for (const step of job.steps.filter(item => item.uses?.startsWith('actions/checkout@'))) assert.equal(step.with['persist-credentials'], false);
  }
});
test('main release verification runs before any production job through the test dependency', () => {
  assert.equal(ci.jobs.test.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  const preflight = ci.jobs.test.steps.find(step => step.run?.includes('verify-delivery.mjs'));
  assert.ok(preflight);
  for (const fragment of ["github.event_name == 'push'", "github.ref == 'refs/heads/main'", "github.repository == 'kostasanastasioubusiness-lang/trak-football-hub'"]) assert.ok(preflight.if.includes(fragment));
  assert.ok(ci.jobs.supabase.needs.includes('test'));
  assert.ok(ci.jobs.deploy.needs.includes('test'));
  assert.ok(ci.jobs.deploy.needs.includes('supabase'));
  assert.ok(ci.jobs.deploy.if.includes("needs.supabase.result == 'success'"));
});
test('existing source, database, upgrade, browser, harness and build checks remain wired', () => {
  const commands = ci.jobs.test.steps.map(step => step.run);
  for (const command of ['npm run lint', 'npm run typecheck', 'npm test', 'npm run test:db', 'npm run test:db -- --parent-upgrade-review', 'npm run test:harness', 'npm run uc:check', 'npm run build', 'npx playwright test --config playwright.pilot.config.ts', 'node --test tests/governance/*.test.mjs']) assert.ok(commands.includes(command), `Lost required command ${command}`);
  assert.ok(commands.indexOf('npm ci --legacy-peer-deps') < commands.indexOf('node --test tests/governance/*.test.mjs'));
});
test('roster audit uses pinned trusted inputs, a separate exact candidate and explicit production gates', () => {
  const job = ci.jobs['roster-audit'];
  assert.equal(job.name, 'Roster adoption audit');
  assert.equal(job['timeout-minutes'], 10);
  assert.deepEqual(job.permissions, { contents: 'read' });
  const checkouts = job.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 2);
  const [candidate, trusted] = checkouts.map(step => step.with);
  assert.equal(candidate.ref, '${{ github.sha }}');
  assert.equal(job.env.CANDIDATE_REVISION, '${{ github.sha }}');
  assert.notEqual(candidate.path, trusted.path);
  assert.equal(trusted.repository, 'imadd23x/trak-football-hub');
  assert.match(trusted.ref, /^[a-f0-9]{40}$/);
  assert.equal(trusted.ref, job.env.ROSTER_BASELINE_REVISION);
  for (const checkout of [candidate, trusted]) {
    assert.equal(checkout['persist-credentials'], false);
    assert.equal(checkout['fetch-depth'], 0);
  }
  const commands = job.steps.filter(step => step.run);
  for (const step of commands) assert.equal(step['working-directory'], trusted.path);
  assert.ok(commands.some(step => step.run === 'npm ci --legacy-peer-deps --ignore-scripts'));
  assert.ok(commands.some(step => step.run === 'node --test tests/audits/roster-adoption.test.mjs'));
  const audit = commands.find(step => step.run.includes('--candidate-root'));
  assert.ok(audit.run.includes(`"$GITHUB_WORKSPACE/${candidate.path}"`));
  assert.ok(audit.run.includes('--candidate-revision "$CANDIDATE_REVISION"'));
  assert.ok(audit.run.includes('--baseline-revision "$ROSTER_BASELINE_REVISION"'));
  assert.equal(JSON.stringify(job).includes('secrets.'), false);
  assert.equal(job['continue-on-error'], undefined);
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  for (const name of ['supabase', 'deploy']) {
    assert.ok(ci.jobs[name].needs.includes('roster-audit'));
    assert.ok(ci.jobs[name].if.includes("needs.roster-audit.result == 'success'"));
  }
});
test('closed PR verification uses main policy and is separate from required PR checks', () => {
  const delivery = governance.jobs.delivery;
  assert.ok(delivery.if.includes("github.event.action == 'closed'"));
  assert.ok(delivery.if.includes('github.event.pull_request.merged == true'));
  assert.equal(delivery.steps.find(step => step.uses?.startsWith('actions/checkout')).with.ref, 'main');
  assert.equal(protection.required_status_checks.contexts.includes(delivery.name), false);
});
test('ownership and agent pointers cover governance itself without discarding technical guidance', () => {
  const owners = read('.github/CODEOWNERS');
  for (const path of ['/src/pages/parent/', '/src/pages/player/', '/src/pages/coach/', '/supabase/migrations/', '/.github/', '/scripts/', '/docs/release/']) assert.ok(owners.includes(path));
  for (const line of owners.split('\n').filter(line => line && !line.startsWith('#'))) assert.ok(line.split(/\s+/).filter(word => word.startsWith('@')).length >= 2);
  assert.ok(read('AGENTS.md').includes('docs/release/merge-gate.md'));
  const claude = read('CLAUDE.md');
  for (const pattern of ['docs/release/merge-gate.md', 'squad_player_id', 'log_match_for_player', 'CoachQuickMatchLog', '## Tech Stack']) assert.ok(claude.includes(pattern));
  assert.ok(fileURLToPath(root).endsWith('/'));
});
