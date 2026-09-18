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
  assert.deepEqual(protection.required_status_checks.contexts, ['test', 'Merge policy', 'Consent privacy audit']);
  assert.equal(protection.required_status_checks.strict, true);
  assert.equal(protection.enforce_admins, true);
  assert.equal(protection.required_pull_request_reviews.required_approving_review_count, 1);
  assert.equal(protection.required_pull_request_reviews.require_last_push_approval, true);
  assert.equal(protection.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(protection.required_pull_request_reviews.require_code_owner_reviews, true);
});
test('consent gate executes independently pinned policy with no hosted credentials and blocks every deployment', () => {
  const audit = ci.jobs['consent-audit'];
  assert.ok(audit, 'Missing dedicated consent audit job');
  assert.equal(audit.name, 'Consent privacy audit');
  assert.deepEqual(audit.permissions, { contents: 'read' });
  assert.equal(audit.env, undefined);
  assert.equal(audit.if, undefined, 'Forks also run the audit');
  const checkouts = audit.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  const candidate = checkouts.find(step => step.with.path === 'candidate');
  const trusted = checkouts.find(step => step.with.path === 'trusted-consent-audit');
  assert.equal(candidate.with.ref, '${{ github.sha }}');
  assert.match(trusted.with.ref, /^[a-f0-9]{40}$/);
  for (const step of checkouts) { assert.equal(step.with['persist-credentials'], false); assert.equal(step.with['fetch-depth'], 0); }
  const install = audit.steps.find(step => step.name === 'Install trusted audit dependencies');
  assert.equal(install['working-directory'], 'trusted-consent-audit');
  assert.equal(install.run, 'npm ci --legacy-peer-deps --ignore-scripts');
  const run = audit.steps.find(step => step.name === 'Run named consent privacy gate');
  assert.equal(run['working-directory'], 'trusted-consent-audit');
  assert.equal(run.env.CANDIDATE_SHA, '${{ github.sha }}');
  assert.equal(run.env.POLICY_REVISION, trusted.with.ref);
  assert.match(run.env.RUNNER_REVISION, /^[a-f0-9]{40}$/);
  assert.ok(run.run.includes('--policy-revision "$POLICY_REVISION"'));
  assert.ok(run.run.includes('--candidate-revision "$CANDIDATE_SHA"'));
  assert.ok(run.run.includes('--candidate-root "$GITHUB_WORKSPACE/candidate"'));
  assert.equal(JSON.stringify(audit).includes('secrets.'), false);
  assert.equal(JSON.stringify(audit).includes('continue-on-error'), false);
  assert.ok(audit['timeout-minutes'] <= 10);
  for (const job of [ci.jobs.supabase, ci.jobs.deploy]) {
    assert.ok(job.needs.includes('consent-audit'));
    assert.ok(job.if.includes("needs.consent-audit.result == 'success'"));
  }
  const context = { always: () => true, github: {
    repository: 'kostasanastasioubusiness-lang/trak-football-hub', event_name: 'push', ref: 'refs/heads/main',
  }, needs: { test: { result: 'success' }, supabase: { result: 'success' },
    'vercel-credentials': { outputs: { configured: 'true' } } } };
  for (const status of ['success', 'failure', 'cancelled', 'skipped', '']) {
    context.needs['consent-audit'] = { result: status };
    for (const job of [ci.jobs.supabase, ci.jobs.deploy]) {
      const condition = job.if.replaceAll('needs.consent-audit', "needs['consent-audit']")
        .replaceAll('needs.vercel-credentials', "needs['vercel-credentials']");
      assert.equal(runInNewContext(condition, context), status === 'success', `${job.name}: ${status}`);
    }
  }
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
