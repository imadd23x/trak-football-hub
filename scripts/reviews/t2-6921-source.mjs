import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Historical review evidence, not a moving-current-head or CI release gate.
export const candidate = '6921ed989978977f1ff1da75e008c2d69fa1b1f1';
export const priorReview = 'bfc1bcd9d02755a538bf2e5a0c8112ab81a7f62f';
const root = fileURLToPath(new URL('../../', import.meta.url));
function git(...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function readObject(revision, path) {
  try { return git('show', `${revision}:${path}`); }
  catch (error) {
    throw new Error(`Missing reviewed Git object ${revision}:${path}. Follow the document's fetch prerequisite.`, { cause: error });
  }
}
export const readCandidate = path => readObject(candidate, path);
export const readPriorReview = path => readObject(priorReview, path);
export function candidateMigrations() {
  const entries = git('ls-tree', '-r', '-z', candidate, '--', 'supabase/migrations').split('\0').filter(Boolean);
  const paths = entries.map(entry => {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(supabase\/migrations\/\d{14}_[A-Za-z0-9_-]+\.sql)$/.exec(entry);
    if (!match) throw new Error('Unexpected migration tree entry in pinned candidate');
    return match[2];
  }).sort();
  if (!paths.length) throw new Error('Pinned candidate has no migrations');
  return paths.map(path => ({ path, name: path.split('/').at(-1), sql: readCandidate(path) }));
}
