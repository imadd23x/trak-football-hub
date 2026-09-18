#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { createGitHubClient, validateNumber, validateRepository, validateSha } from './github.mjs';
import { createGitRepository, evaluatePullRequest } from './pr-policy.mjs';

export function writeStepSummary(report, path = process.env.GITHUB_STEP_SUMMARY) {
  if (!path) return;
  const state = report.unverified ? 'UNVERIFIED' : report.passed ? 'PASS' : 'FAIL';
  const escaped = JSON.stringify(report, null, 2).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  appendFileSync(path, `## PR policy: ${state}\n\n<pre>${escaped}</pre>\n\n`, 'utf8');
}

export async function checkPullRequest({ repository, prNumber, baseSha, headSha, cwd = process.cwd(), client }) {
  validateRepository(repository); validateNumber(prNumber); validateSha(baseSha); validateSha(headSha);
  const [main, pullRequest, openPullRequests, reviews] = await Promise.all([
    client.getMain(repository), client.getPullRequest(repository, prNumber),
    client.listOpenPullRequests(repository), client.listReviews(repository, prNumber),
  ]);
  if (main !== baseSha) throw new Error(`Current main is ${main}, not checked base ${baseSha}; update the branch/check inputs`);
  const result = await evaluatePullRequest({
    repository, prNumber, baseSha, headSha, pullRequest, openPullRequests, reviews,
    git: createGitRepository(cwd),
    isAncestor: (ancestor, descendant) => client.isAncestor(repository, ancestor, descendant),
    getPullRequest: number => client.getPullRequest(repository, number),
    getActionsRun: (repo, id) => client.getActionsRun(repo, id),
  });
  const [finalMain, finalPr, finalReviews] = await Promise.all([
    client.getMain(repository), client.getPullRequest(repository, prNumber), client.listReviews(repository, prNumber),
  ]);
  if (finalMain !== baseSha || finalPr?.head?.sha !== headSha || finalPr?.base?.ref !== pullRequest.base.ref ||
      finalPr?.state !== 'open' || finalPr?.body !== pullRequest.body || JSON.stringify(finalReviews) !== JSON.stringify(reviews)) {
    throw new Error('Main, PR, or reviews changed while checking; rerun on the current base/head');
  }
  return result;
}

function argumentsFrom(argv) {
  const values = {};
  const names = new Map([['--repository', 'repository'], ['--pr', 'prNumber'], ['--base-sha', 'baseSha'], ['--head-sha', 'headSha']]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = names.get(argv[index]);
    if (!key || key in values || !argv[index + 1]) throw new Error('Usage: check-pr.mjs --repository OWNER/REPO --pr N --base-sha FULL40 --head-sha FULL40');
    values[key] = argv[index + 1];
  }
  validateRepository(values.repository); values.prNumber = validateNumber(values.prNumber);
  validateSha(values.baseSha); validateSha(values.headSha);
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  try {
    options = argumentsFrom(process.argv.slice(2));
    console.log(`PR policy: ${options.repository} #${options.prNumber}; main=${options.baseSha}; head=${options.headSha}`);
    const result = await checkPullRequest({ ...options, client: createGitHubClient({ token: process.env.GITHUB_TOKEN }) });
    console.log(JSON.stringify(result, null, 2));
    writeStepSummary(result);
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(`PR policy unavailable/failed: ${error.message}`);
    try {
      writeStepSummary({ repository: options?.repository ?? 'unavailable', prNumber: options?.prNumber ?? 'unavailable',
        baseSha: options?.baseSha ?? 'unavailable', headSha: options?.headSha ?? 'unavailable',
        passed: false, unverified: true, reasons: [error.message], backdatedMigrations: [] });
    } catch { console.error('PR policy summary could not be written'); }
    process.exitCode = 1;
  }
}
