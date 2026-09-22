#!/usr/bin/env node
// Real concurrent RPC calls against an exclusively owned temporary PG17 cluster.
// No application connection settings, existing cluster, TCP listener or live DB.
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplayPlan, childEnvironment, runCommand, temporaryRoot } from './test-native-db.mjs';

if (process.argv.length !== 2) throw new Error('No arguments accepted');
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = process.env.TRAK_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
if (!isAbsolute(bin)) throw new Error('TRAK_TEST_PG_BIN must be an absolute PostgreSQL 17 binary directory');
const port = '55443';
const directory = await mkdtemp(join(temporaryRoot, 'trak-avatar-race-'));
const data = join(directory, 'data');
const socket = join(directory, 'socket');
const env = childEnvironment(bin, directory);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const command = (name, args, options = {}) => runCommand(join(bin, name), args, {
  cwd: directory, env, signal: controller.signal, ...options,
});
const psqlArgs = ['-X', '--no-password', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'];
const query = sql => command('psql', [...psqlArgs, '-c', sql], { timeoutMs: 20_000 });
const uid = n => `94000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// A persistent third connection holds a row/table lock until both independent
// RPC connections reach a lock wait. This controls scheduling, not application
// logic: no migration/function is replaced and no extra trigger is installed.
function controlConnection() {
  const child = spawn(join(bin, 'psql'), psqlArgs, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', errors = '', pending, sequence = 0, closed = false;
  child.stdout.on('data', data => {
    buffer += data;
    if (pending && buffer.includes(pending.marker)) {
      const value = buffer.slice(0, buffer.indexOf(pending.marker));
      buffer = buffer.slice(buffer.indexOf(pending.marker) + pending.marker.length).trimStart();
      clearTimeout(pending.timer);
      pending.resolve(value.trim());
      pending = undefined;
    }
    if (buffer.length > 16384) buffer = buffer.slice(-16384);
  });
  child.stderr.on('data', data => { errors = (errors + data).slice(-16384); });
  child.on('error', error => { pending?.reject(error); });
  child.on('close', code => {
    closed = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Control psql exited ${code}: ${errors}`)); pending = undefined; }
  });
  return {
    async sql(text) {
      if (pending || closed) throw new Error('Control connection unavailable');
      const marker = `__TRAK_CONTROL_${++sequence}__`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Control connection exceeded 10s deadline')); }, 10_000);
        pending = { marker, resolve, reject, timer };
        child.stdin.write(`${text};\n\\echo ${marker}\n`);
      });
    },
    stop() { child.stdin.end('ROLLBACK;\n\\q\n'); if (!closed) child.kill('SIGTERM'); },
  };
}

let startAttempted = false, control, cleanupFailure, failure;
try {
  await chmod(directory, 0o700);
  await mkdir(socket, { mode: 0o700 });
  const version = await command('postgres', ['--version'], { timeoutMs: 10_000 });
  if (!/\(PostgreSQL\) 17\./.test(version.stdout)) throw new Error('PostgreSQL 17 required');
  console.log(`[avatar-concurrency] ${version.stdout.trim()}`);
  await command('initdb', ['-D', data, '-U', 'postgres', '--locale=C', '--encoding=UTF8', '--auth-local=trust', '--auth-host=reject', '--no-instructions']);
  startAttempted = true;
  await command('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-w', '-t', '30', '-o',
    `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=${port} -c timezone=UTC`, 'start'], { timeoutMs: 40_000 });
  const plan = await buildReplayPlan(root, 'all');
  const replay = join(directory, 'replay.sql');
  await writeFile(replay, plan.sql, { mode: 0o600 });
  await command('psql', [...psqlArgs, '-f', replay], { timeoutMs: 180_000 });
  console.log(`[avatar-concurrency] Replayed ${plan.migrationCount} real migrations and sequential suites.`);
  await query(`GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('${uid(1)}','avatar-race1@test.invalid',now()),('${uid(2)}','avatar-race2@test.invalid',now());
    INSERT INTO public.profiles(user_id,role,full_name) VALUES ('${uid(1)}','parent','Race One'),('${uid(2)}','parent','Race Two');`);
  control = controlConnection();
  const actor = n => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${uid(n)}","role":"authenticated"}',true);`;
  const waitForLock = async name => {
    for(let i=0;i<100;i++) {
      const state=await query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`);
      if(state.stdout.trim()==='1') return;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error('Concurrent operation never reached the expected lock wait: '+name);
  };
  // Elevated Storage completion holds the trigger's Auth-row lock until commit.
  await control.sql(`BEGIN; INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','${uid(1)}')`);
  const deletion=query(`SET application_name='avatar_delete_wait'; BEGIN; SET LOCAL statement_timeout='10s'; ${actor(1)} SELECT public.delete_my_account(); COMMIT;`)
    .then(()=>({ok:true}),error=>({ok:false,error:error.message}));
  await waitForLock('avatar_delete_wait');
  await control.sql('COMMIT');
  const d=await deletion;
  const first=await query(`SELECT (SELECT count(*) FROM auth.users WHERE id='${uid(1)}')||':'||(SELECT count(*) FROM storage.objects WHERE name='${uid(1)}')`);
  if(d.ok||!d.error.includes('Remove your avatar')||first.stdout.trim()!=='1:1') throw new Error('Upload-first did not preserve account and avatar: '+JSON.stringify({d,state:first.stdout}));
  console.log('[avatar-concurrency] upload-first: deletion waited, refused; account1/avatar1 preserved');
  // Deletion holds an exclusive Auth-row lock; the stale-token upload must
  // recheck existence after waiting for deletion to commit.
  await control.sql(`BEGIN; ${actor(2)} SELECT public.delete_my_account()`);
  const upload=query(`SET application_name='avatar_upload_wait'; BEGIN; SET LOCAL statement_timeout='10s'; ${actor(2)} INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','${uid(2)}'); COMMIT;`)
    .then(()=>({ok:true}),error=>({ok:false,error:error.message}));
  await waitForLock('avatar_upload_wait');
  await control.sql('COMMIT');
  const u=await upload;
  const second=await query(`SELECT (SELECT count(*) FROM auth.users WHERE id='${uid(2)}')||':'||(SELECT count(*) FROM storage.objects WHERE name='${uid(2)}')`);
  if(u.ok||!u.error.includes('Avatar account no longer exists')||second.stdout.trim()!=='0:0') throw new Error('Deletion-first allowed a stale upload: '+JSON.stringify({u,state:second.stdout}));
  console.log('[avatar-concurrency] deletion-first: upload waited, refused; account0/avatar0');
  // Storage's initial RLS permission probe rolls back. Account deletion may
  // commit before its later elevated metadata write; JWT policies cannot stop
  // that write. Exercise this exact split and preserve the failed state.
  await query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${uid(3)}','avatar-race3@test.invalid',now());
    INSERT INTO public.profiles(user_id,role,full_name) VALUES('${uid(3)}','parent','Split Completion');`);
  await query(`BEGIN; ${actor(3)} INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','${uid(3)}'); ROLLBACK;`);
  await query(`BEGIN; ${actor(3)} SELECT public.delete_my_account(); COMMIT;`);
  const completion=await query(`INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','${uid(3)}')`)
    .then(()=>({ok:true}),error=>({ok:false,error:error.message}));
  const split=await query(`SELECT (SELECT count(*) FROM auth.users WHERE id='${uid(3)}')||':'||(SELECT count(*) FROM storage.objects WHERE name='${uid(3)}')`);
  if(completion.ok||!completion.error.includes('Avatar account no longer exists')||split.stdout.trim()!=='0:0') throw new Error('Elevated completion recreated a deleted avatar: '+JSON.stringify({completion,state:split.stdout}));
  console.log('[avatar-concurrency] rolled-back permission probe, deletion, elevated completion: refused; account0/avatar0');


} catch (error) {
  failure = error;
  console.error(`[avatar-concurrency] ${error.message}`);
  try { console.error((await readFile(join(directory, 'server.log'), 'utf8')).slice(-2000)); } catch { /* startup may not have produced a log */ }
} finally {
  control?.stop();
  if (startAttempted) {
    try {
      await command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { signal: undefined, timeoutMs: 20_000 });
    } catch (error) {
      const status = await command('pg_ctl', ['-D', data, 'status'], { signal: undefined, timeoutMs: 10_000, allowedCodes: [0, 3] }).catch(() => undefined);
      if (status?.code !== 3) cleanupFailure = error;
    }
  }
  if (!cleanupFailure) {
    await rm(directory, { recursive: true, force: true });
    console.log('[avatar-concurrency] Temporary cluster stopped and directory removed.');
  } else console.error(`[avatar-concurrency] Cleanup failed; inspect only ${directory}: ${cleanupFailure.message}`);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
if (failure || cleanupFailure) process.exitCode = 1;
