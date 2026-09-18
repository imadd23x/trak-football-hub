import { execFileSync, spawnSync } from 'node:child_process';
import { validateNumber, validateRepository, validateSha } from './github.mjs';

const MIGRATION = /^(\d{14})_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;
const ASSOCIATIONS = new Set(['COLLABORATOR', 'MEMBER', 'OWNER']);

export function createGitRepository(cwd) {
  function git(args) {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { throw new Error(`Local Git could not read ${args[0]}; fetch the exact base/head objects and full history`); }
  }
  function verifyCommit(sha) { validateSha(sha); git(['cat-file', '-e', `${sha}^{commit}`]); }
  return {
    verifyCommit,
    isAncestor(ancestor, descendant) {
      verifyCommit(ancestor); verifyCommit(descendant);
      const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, encoding: 'utf8' });
      if (result.error || ![0, 1].includes(result.status)) throw new Error('Local Git ancestry check failed; evidence is incomplete');
      return result.status === 0;
    },
    migrations(sha) {
      verifyCommit(sha);
      const rows = git(['ls-tree', '-r', '-z', '--full-tree', sha, '--', 'supabase/migrations']).split('\0').filter(Boolean);
      const files = new Map();
      for (const row of rows) {
        const match = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(row);
        if (!match) throw new Error('Unrecognized Git migration tree entry');
        const [, mode, kind, blob, path] = match;
        if (!path.endsWith('.sql')) continue;
        const name = path.slice('supabase/migrations/'.length);
        if (!MIGRATION.test(name) || kind !== 'blob' || !['100644', '100755'].includes(mode)) {
          throw new Error(`Unsupported migration entry ${JSON.stringify(path)}; expected a regular timestamped SQL file`);
        }
        files.set(name, { blob, mode, timestamp: name.slice(0, 14) });
      }
      return files;
    },
  };
}

function marker(body, label) {
  const lines = (body ?? '').split(/\r?\n/).filter(line => line.trimStart().startsWith(`${label}:`));
  if (lines.length !== 1) throw new Error(`Exactly one ${label}: JSON line is required`);
  let value;
  try { value = JSON.parse(lines[0].trim().slice(label.length + 1).trim()); }
  catch { throw new Error(`${label} must contain valid one-line JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'base_sha,evidence_url,migrations' ||
      !Array.isArray(value.migrations) || value.migrations.some(name => typeof name !== 'string' || !MIGRATION.test(name)) ||
      new Set(value.migrations).size !== value.migrations.length || typeof value.evidence_url !== 'string') {
    throw new Error(`${label} requires exactly base_sha, migrations (unique filenames), and evidence_url`);
  }
  validateSha(value.base_sha);
  return { base_sha: value.base_sha, migrations: [...value.migrations].sort(), evidence_url: value.evidence_url };
}

function evidenceLocation(url, repositories) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Migration evidence must be a GitHub Actions run URL'); }
  const match = /^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9]\d*)\/?$/.exec(parsed.pathname);
  if (parsed.origin !== 'https://github.com' || parsed.username || parsed.password || parsed.search || parsed.hash || !match ||
      !repositories.some(repository => repository.toLowerCase() === match[1].toLowerCase())) {
    throw new Error('Migration evidence must be a GitHub Actions run in the canonical repository or candidate fork');
  }
  return { repository: validateRepository(match[1]), runId: validateNumber(match[2]) };
}

function hasApproval(reviews, acknowledgement, headSha, author) {
  const latest = new Map();
  for (const review of reviews) {
    if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review?.state)) continue;
    const login = review.user?.login;
    if (typeof login !== 'string' || !Number.isSafeInteger(review.id) || !Number.isFinite(Date.parse(review.submitted_at))) {
      throw new Error('GitHub review metadata is incomplete');
    }
    const key = login.toLowerCase();
    const previous = latest.get(key);
    if (!previous || Date.parse(review.submitted_at) > Date.parse(previous.submitted_at) ||
        (review.submitted_at === previous.submitted_at && review.id > previous.id)) latest.set(key, review);
  }
  for (const [login, review] of latest) {
    if (review.state !== 'APPROVED' || review.commit_id !== headSha || login === author.toLowerCase() ||
        review.user.type !== 'User' || login.endsWith('[bot]') || !ASSOCIATIONS.has(review.author_association)) continue;
    try {
      if (JSON.stringify(marker(review.body, 'migration-order-approved')) === JSON.stringify(acknowledgement)) return true;
    } catch { /* An approval without the exact migration contract cannot authorize the inversion. */ }
  }
  return false;
}

function dependencyNumbers(body) {
  const result = new Set();
  for (const line of (body ?? '').split(/\r?\n/)) {
    if (!/^\s*Depends-on:/i.test(line)) continue;
    const value = line.replace(/^\s*Depends-on:\s*/i, '');
    if (!/^#[1-9]\d*(?:(?:\s*,\s*|\s+)#[1-9]\d*)*\s*$/.test(value)) throw new Error('Depends-on must list PR numbers, for example Depends-on: #34, #36');
    for (const match of value.matchAll(/#([1-9]\d*)/g)) result.add(validateNumber(match[1]));
  }
  return [...result];
}

export async function evaluatePullRequest({ repository, prNumber, baseSha, headSha, pullRequest, openPullRequests, reviews,
  git, isAncestor, getPullRequest, getActionsRun }) {
  validateRepository(repository); validateNumber(prNumber); validateSha(baseSha); validateSha(headSha);
  const reasons = [];
  const result = { repository, prNumber, baseSha, headSha, passed: false, reasons, backdatedMigrations: [] };
  if (pullRequest?.number !== prNumber || pullRequest?.state !== 'open' || pullRequest?.head?.sha !== headSha ||
      pullRequest?.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() || !pullRequest?.user?.login) {
    throw new Error('PR metadata does not match the requested open PR/head/repository');
  }
  if (!Array.isArray(openPullRequests) || !Array.isArray(reviews)) throw new Error('Open PR/review inventory is unavailable');
  if (pullRequest.base.ref !== 'main') {
    reasons.push(`PR targets ${pullRequest.base.ref}; retarget to main`);
    return result;
  }
  git.verifyCommit(baseSha); git.verifyCommit(headSha);
  if (!await isAncestor(baseSha, headSha)) {
    reasons.push('Candidate does not contain current main; merge current main and rerun checks');
    return result;
  }

  const byNumber = new Map();
  for (const other of openPullRequests) {
    validateNumber(other?.number); validateSha(other?.head?.sha);
    if (other.state !== 'open') throw new Error('Open PR inventory contains invalid state');
    byNumber.set(other.number, other);
    if (other.number === prNumber || await isAncestor(other.head.sha, baseSha)) continue;
    if (await isAncestor(other.head.sha, headSha)) reasons.push(`Candidate contains unmerged head of open PR #${other.number} (${other.head.sha}); deliver that dependency first`);
  }
  if (byNumber.get(prNumber)?.head?.sha !== headSha) throw new Error('Current PR/head is missing from the open PR inventory; rerun the snapshot');
  for (const number of dependencyNumbers(pullRequest.body)) {
    if (number === prNumber) { reasons.push('A PR cannot Depends-on itself'); continue; }
    const dependency = byNumber.get(number) ?? await getPullRequest(number);
    if (dependency?.number !== number || !['open', 'closed'].includes(dependency?.state)) throw new Error(`Dependency #${number} metadata is unavailable`);
    validateSha(dependency?.head?.sha);
    let delivered = await isAncestor(dependency.head.sha, baseSha);
    if (!delivered && dependency.merged === true) {
      validateSha(dependency.merge_commit_sha);
      delivered = await isAncestor(dependency.merge_commit_sha, baseSha);
    }
    if (!delivered) reasons.push(`Declared dependency #${number} has not reached current main; a merged badge or closed PR is insufficient`);
  }

  const baseFiles = git.migrations(baseSha);
  const headFiles = git.migrations(headSha);
  const highwater = [...baseFiles.values()].map(file => file.timestamp).sort().at(-1);
  const timestamps = new Map();
  for (const [name, file] of headFiles) {
    if (timestamps.has(file.timestamp)) reasons.push(`Migration version ${file.timestamp} is duplicated by ${timestamps.get(file.timestamp)} and ${name}`);
    timestamps.set(file.timestamp, name);
  }
  for (const [name, file] of baseFiles) {
    const candidate = headFiles.get(name);
    if (!candidate) reasons.push(`Historical migration deleted: ${name}; restore it and use a new forward migration`);
    else if (candidate.blob !== file.blob || candidate.mode !== file.mode) reasons.push(`Historical migration changed: ${name}; restore its original bytes/mode`);
  }
  result.backdatedMigrations = [...headFiles].filter(([name, file]) => !baseFiles.has(name) && highwater && file.timestamp <= highwater).map(([name]) => name).sort();
  if (result.backdatedMigrations.length) {
    try {
      const ack = marker(pullRequest.body, 'migration-order-ack');
      if (ack.base_sha !== baseSha || JSON.stringify(ack.migrations) !== JSON.stringify(result.backdatedMigrations)) {
        throw new Error(`Acknowledgement must name current main ${baseSha} and exactly: ${result.backdatedMigrations.join(', ')}`);
      }
      const fork = validateRepository(pullRequest.head.repo?.full_name);
      const evidence = evidenceLocation(ack.evidence_url, [repository, fork]);
      const run = await getActionsRun(evidence.repository, evidence.runId);
      if (run?.head_sha !== headSha || run?.status !== 'completed' || run?.conclusion !== 'success' || run?.repository?.full_name?.toLowerCase() !== evidence.repository.toLowerCase()) {
        throw new Error('Migration evidence must be a successful completed Actions run on the exact candidate head');
      }
      if (!hasApproval(reviews, ack, headSha, pullRequest.user.login)) {
        throw new Error('Backdated migrations need an independent collaborator/member/owner APPROVED review on this exact head, with matching migration-order-approved JSON');
      }
    } catch (error) { reasons.push(`Migration order: ${error.message}`); }
  }
  result.passed = reasons.length === 0;
  return result;
}
