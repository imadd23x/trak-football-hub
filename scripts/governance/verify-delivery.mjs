#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGitHubClient } from './github.mjs';

const shaPattern = /^[0-9a-f]{40}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function sha(value) {
  if (!shaPattern.test(value ?? '')) throw new Error('Expected a full Git commit SHA');
  return value;
}
function repositoryName(value) {
  if (!repositoryPattern.test(value ?? '')) throw new Error('Expected OWNER/REPO');
  return value;
}
function filePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.split('/').includes('..') || value.includes('\0')) {
    throw new Error('Invalid changed-file path');
  }
  return value;
}

export function localGit(cwd = process.cwd()) {
  const run = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (run(['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
    throw new Error('Delivery verification requires complete Git history; use checkout fetch-depth: 0');
  }
  return {
    ensureCommit(value) {
      const ref = sha(value);
      try { run(['cat-file', '-e', `${ref}^{commit}`]); }
      catch {
        // Only a validated object ID is fetched; never a URL or command from a PR.
        run(['fetch', '--no-tags', 'origin', ref]);
        run(['cat-file', '-e', `${ref}^{commit}`]);
      }
    },
    isAncestor(ancestor, descendant) {
      try { run(['merge-base', '--is-ancestor', sha(ancestor), sha(descendant)]); return true; }
      catch (error) { if (error.status === 1) return false; throw error; }
    },
    hasPath(commit, path) {
      const output = run(['ls-tree', '-r', '-z', sha(commit), '--', filePath(path)]);
      return output.split('\0').some(entry => entry.slice(entry.indexOf('\t') + 1) === path);
    },
  };
}

// GitHub supplies merge_commit_sha for merge, squash and rebase results.
// File inventory is a completeness check, NOT proof of every intended behavior;
// source/journey tests must separately run on the delivered revision.
export async function verifyDelivery({ api, git, repository, commit, prNumber, forced = false, previousSha }) {
  const repo = repositoryName(repository);
  if ((commit === undefined) === (prNumber === undefined)) throw new Error('Specify exactly one commit or PR');
  if (typeof forced !== 'boolean') throw new Error('Forced-push metadata must be boolean');
  if (commit !== undefined && forced) throw new Error('Forced main pushes cannot authorize a production release');
  if (prNumber !== undefined && (!Number.isSafeInteger(prNumber) || prNumber < 1)) throw new Error('Invalid PR number');
  const main = await api.get(`/repos/${repo}/branches/main`);
  const mainSha = sha(main?.commit?.sha);
  git.ensureCommit(mainSha);
  if (commit !== undefined && sha(commit) !== mainSha) {
    throw new Error(`Refusing stale release ${commit}; current main is ${mainSha}. Re-run the current revision.`);
  }
  if (previousSha !== undefined) {
    if (commit === undefined) throw new Error('Previous push SHA is only valid for release verification');
    git.ensureCommit(sha(previousSha));
    if (!git.isAncestor(previousSha, commit)) throw new Error('Main push does not advance from its previous revision');
  }
  const associated = prNumber === undefined
    ? await api.paginate(`/repos/${repo}/commits/${sha(commit)}/pulls`)
    : [{ number: prNumber }];
  if (!Array.isArray(associated) || associated.length === 0) throw new Error('No merged PR associated with this main commit; direct pushes are not releases');
  const results = [];
  for (const item of associated) {
    if (!Number.isSafeInteger(item.number) || item.number < 1) throw new Error('Malformed associated PR');
    const pr = await api.get(`/repos/${repo}/pulls/${item.number}`);
    if (commit !== undefined && (!pr.merged || pr.merge_commit_sha !== commit)) continue;
    if (!pr.merged || pr.base?.ref !== 'main' || pr.base?.repo?.full_name?.toLowerCase() !== repo.toLowerCase()) {
      throw new Error(`PR #${item.number} has not merged into ${repo}:main`);
    }
    const resultSha = sha(pr.merge_commit_sha);
    git.ensureCommit(resultSha);
    if (!git.isAncestor(resultSha, mainSha)) throw new Error(`PR #${item.number} merge result ${resultSha} is absent from main`);
    const files = await api.paginate(`/repos/${repo}/pulls/${item.number}/files`);
    if (!Array.isArray(files) || !Number.isSafeInteger(pr.changed_files) || files.length !== pr.changed_files || files.length === 0) {
      throw new Error(`PR #${item.number} changed-file inventory is missing or incomplete`);
    }
    const seen = new Set();
    for (const file of files) {
      const path = filePath(file.filename);
      if (seen.has(path)) throw new Error(`Duplicate changed file: ${path}`);
      seen.add(path);
      if (!['added', 'modified', 'removed', 'renamed', 'copied', 'changed'].includes(file.status)) throw new Error(`Unknown changed-file status for ${path}`);
      const present = git.hasPath(resultSha, path);
      if (file.status === 'removed' ? present : !present) throw new Error(`Merge result has the wrong file inventory for ${path}`);
      if (file.status === 'renamed' && file.previous_filename !== file.filename) {
        const oldPath = filePath(file.previous_filename);
        // A rename's old path can legitimately be recreated by another change.
        const recreated = files.some(other => other.filename === oldPath && other.status !== 'removed');
        if (!recreated && git.hasPath(resultSha, oldPath)) throw new Error(`Renamed path remains in merge result: ${oldPath}`);
      }
    }
    results.push({ number: item.number, resultSha, files: files.map(file => file.filename) });
  }
  if (results.length === 0) throw new Error('The release commit is not the recorded result of a merged main-targeting PR');
  const finalMain = await api.get(`/repos/${repo}/branches/main`);
  if (sha(finalMain?.commit?.sha) !== mainSha) throw new Error('Main changed during delivery verification; rerun on the current revision');
  return { repository: repo, mainSha, results };
}

export async function main(argv = process.argv.slice(2)) {
  const allowed = new Set(['--repository', '--commit', '--pr', '--forced', '--previous-sha']);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index]) || !argv[index + 1] || options[argv[index]] !== undefined) throw new Error('Usage: verify-delivery.mjs --repository OWNER/REPO (--commit SHA | --pr N)');
    options[argv[index]] = argv[index + 1];
  }
  if (options['--forced'] !== undefined && !['true', 'false'].includes(options['--forced'])) throw new Error('--forced must be true or false');
  if (options['--commit'] && (!options['--previous-sha'] || options['--forced'] === undefined)) throw new Error('Release verification requires --previous-sha and --forced from the push event');
  const result = await verifyDelivery({
    api: createGitHubClient({ token: process.env.GITHUB_TOKEN }), git: localGit(),
    repository: options['--repository'], commit: options['--commit'],
    prNumber: options['--pr'] === undefined ? undefined : Number(options['--pr']),
    forced: options['--forced'] === 'true', previousSha: options['--previous-sha'],
  });
  const summary = [
    '### Merge delivery verified', '', `Main revision: \`${result.mainSha}\``,
    ...result.results.map(pr => `- PR #${pr.number}: result \`${pr.resultSha}\`; ${pr.files.length} changed paths accounted for.`),
    '', 'This verifies merge-result ancestry and file inventory. Application behavior, migration effects and live deployment require their separate checks.', '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Merge delivery failed: ${error.message}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### Merge delivery failed\n\nSee the job log. No delivery verification was established.\n');
    process.exitCode = 1;
  });
}
