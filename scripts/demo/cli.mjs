#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDemo, createSupabaseAdapter, preflightDemo } from './apply.mjs';
import { buildDemoPlan } from './plan.mjs';

export const usage = `Synthetic demo fixtures (no .env is loaded)
  node scripts/demo/cli.mjs --as-of YYYY-MM-DD [--plan]
  node scripts/demo/cli.mjs --as-of YYYY-MM-DD --apply --url ORIGIN --confirm-target ORIGIN [--state-dir PATH]

Plan is the default and performs no network or filesystem writes.
Apply requires TRAK_DEMO_SERVICE_KEY in the server environment. Never pass it as a CLI argument.
Apply inserts missing synthetic records only. It never resets passwords, updates rows or purges data.
Use the same date, destination and private state directory to resume an interrupted apply.
Hosted application requires a separately reviewed operation; this tool does not authorize deployment.`;

export function parseArgs(args) {
  const result = { apply: false };
  const values = new Map([['--as-of', 'asOf'], ['--url', 'url'], ['--confirm-target', 'confirmTarget'], ['--state-dir', 'stateDir']]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Duplicate option ${arg}`);
    seen.add(arg);
    if (arg === '--help') result.help = true;
    else if (arg === '--apply') result.apply = true;
    else if (arg === '--plan') result.plan = true;
    else if (values.has(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      result[values.get(arg)] = value;
    } else throw new Error('Unknown option; use --help (credentials are never accepted as arguments)');
  }
  if (result.apply && result.plan) throw new Error('Choose --plan or --apply');
  if (!result.apply && (result.url || result.confirmTarget || result.stateDir)) throw new Error('Target and state options require --apply');
  return result;
}

export function validateTarget(value, confirmation) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Apply requires an explicit Supabase URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const hosted = /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || !(loopback && ['http:', 'https:'].includes(url.protocol) || hosted && url.protocol === 'https:' && !url.port)) {
    throw new Error('Target must be a Supabase HTTPS project origin or explicit local loopback origin');
  }
  if (confirmation !== url.origin) throw new Error('The --confirm-target value must exactly match the destination origin');
  return url.origin;
}

export function validateServiceKey(key) {
  if (typeof key !== 'string' || key.length < 20 || key.trim() !== key) throw new Error('TRAK_DEMO_SERVICE_KEY is required for apply');
  if (key.startsWith('sb_secret_')) return;
  try {
    const parts = key.split('.');
    if (parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role') return;
  } catch { /* Fall through without logging credentials. */ }
  throw new Error('Apply requires a server secret/service-role key, never an anonymous or publishable key');
}

export function credentialsName(target, namespace) {
  return `${createHash('sha256').update(`${target}\n${namespace}`).digest('hex')}.json`;
}

export async function loadCredentials(path, target, plan, existingAccounts) {
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw new Error('Credentials must be a private regular file owned by the current user (mode 600)');
    }
    let stored;
    try { stored = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('Cannot read private credentials; preserve the file and investigate before retrying'); }
    const ids = plan.accounts.map(account => account.id);
    if (stored.format !== 1 || stored.target !== target || stored.namespace !== plan.namespace
      || !stored.passwords || Object.keys(stored.passwords).length !== ids.length
      || ids.some(id => typeof stored.passwords[id] !== 'string' || stored.passwords[id].length < 24)) {
      throw new Error('Private credentials do not match this manifest and target');
    }
    return stored;
  }
  if (existingAccounts.size) throw new Error('Existing demo accounts require their original private credentials file; passwords will not be reset');
  const stored = {
    format: 1, target, namespace: plan.namespace,
    passwords: Object.fromEntries(plan.accounts.map(account => [account.id, `Trak!${randomBytes(24).toString('base64url')}`])),
  };
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(stored, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  return stored;
}

export async function run(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args);
  if (options.help) { console.log(usage); return; }
  const plan = buildDemoPlan({ asOf: options.asOf });
  if (!options.apply) { console.log(JSON.stringify(plan, null, 2)); return; }
  const target = validateTarget(options.url, options.confirmTarget);
  validateServiceKey(env.TRAK_DEMO_SERVICE_KEY);
  const stateDir = resolve(options.stateDir ?? '.local/trak-demo-seed');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = resolve(stateDir, credentialsName(target, plan.namespace));
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { throw new Error('Cannot acquire demo state lock; check for a running operator or interrupted run before retrying'); }
  try {
    await lock.writeFile(String(process.pid));
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(target, env.TRAK_DEMO_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init = {}) => fetch(input, {
        ...init, redirect: 'error',
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      }) },
    });
    const adapter = createSupabaseAdapter(client);
    const { existingAccounts } = await preflightDemo(plan, adapter);
    const credentials = await loadCredentials(path, target, plan, existingAccounts);
    // Recheck immediately before writing; another operator may have raced the
    // initial read. Database uniqueness handles residual insert races safely.
    const result = await applyDemo(plan, adapter, credentials);
    console.log(JSON.stringify({ target, namespace: plan.namespace, ...result, credentialsFile: path }, null, 2));
    console.log('Verified manifest records only. Auth login, email, UI journeys and consent gates are not established by this result.');
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(`Demo setup stopped: ${error.message}`);
    console.error('A failed apply may have created a partial cohort. Preserve its private state and rerun the identical manifest after resolving the error.');
    process.exitCode = 1;
  });
}
