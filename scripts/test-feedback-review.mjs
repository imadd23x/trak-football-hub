#!/usr/bin/env node
// Opt-in unresolved storage/concurrency audit against a private PG17 cluster.
// Desired assertions exit nonzero until the implementation is repaired.
// No application connection settings, existing cluster, TCP listener or live DB.
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplayPlan, childEnvironment, runCommand, temporaryRoot } from './test-native-db.mjs';

if (process.argv.length > 2) throw new Error('Usage: node scripts/test-feedback-review.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = process.env.TRAK_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
if (!isAbsolute(bin)) throw new Error('TRAK_TEST_PG_BIN must be an absolute PostgreSQL 17 binary directory');
const port = '55443';
const directory = await mkdtemp(join(temporaryRoot, 'trak-feedback-review-'));
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
const uid = n => `98000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// Keep publication A uncommitted while B enters the real RPC independently.
// A correctly serialized B waits until A commits; an unsafe B may finish early.
// No application function or trigger is replaced to manufacture the race.
function controlConnection() {
  const child = spawn(join(bin, 'psql'), psqlArgs, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', errors = '', pending, sequence = 0, closed = false, stopping = false, lastError, stopPromise;
  let resolveClosed;
  const whenClosed = new Promise(resolve => { resolveClosed = resolve; });
  const rejectPending = error => {
    if (!pending) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    current.reject(error);
  };
  const recordError = error => {
    lastError = error;
    errors = `${errors}\n${error.message}`.slice(-16384);
    rejectPending(error);
  };
  const waitForClose = milliseconds => new Promise(resolve => {
    if (closed) { resolve(true); return; }
    const timer = setTimeout(() => resolve(false), milliseconds);
    whenClosed.then(() => { clearTimeout(timer); resolve(true); });
  });
  const kill = signal => {
    if (closed) return;
    try { child.kill(signal); } catch (error) { recordError(error); }
  };
  // No SQL is written during teardown: closing the connection rolls back its
  // open transaction. Pipe errors cannot escape and skip the pg_ctl finally.
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopping = true;
    controller.signal.removeEventListener('abort', interrupted);
    rejectPending(new Error('Control connection stopped'));
    stopPromise = (async () => {
      try {
        if (closed) return true;
        child.stdin.destroy();
        kill('SIGTERM');
        if (await waitForClose(1_000)) return true;
        kill('SIGKILL');
        if (await waitForClose(2_000)) return true;
        // A failure to reap this owned process must not hold Node open forever
        // or prevent the independent cluster shutdown. Report false to caller.
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        return false;
      } catch (error) {
        recordError(error);
        kill('SIGKILL');
        return false;
      }
    })();
    return stopPromise;
  };
  const interrupted = () => {
    recordError(new Error('Control connection interrupted'));
    void stop();
  };
  child.stdout.on('data', data => {
    buffer += data;
    if (pending && buffer.includes(pending.marker)) {
      const current = pending;
      const value = buffer.slice(0, buffer.indexOf(current.marker));
      buffer = buffer.slice(buffer.indexOf(current.marker) + current.marker.length).trimStart();
      pending = undefined;
      clearTimeout(current.timer);
      current.resolve(value.trim());
    }
    if (buffer.length > 16384) buffer = buffer.slice(-16384);
  });
  child.stderr.on('data', data => { errors = (errors + data).slice(-16384); });
  child.on('error', recordError);
  child.stdin.on('error', recordError);
  child.stdout.on('error', recordError);
  child.stderr.on('error', recordError);
  child.once('close', code => {
    closed = true;
    controller.signal.removeEventListener('abort', interrupted);
    rejectPending(new Error(`Control psql exited ${code}: ${errors}`));
    resolveClosed(true);
  });
  controller.signal.addEventListener('abort', interrupted, { once: true });
  if (controller.signal.aborted) interrupted();
  return {
    async sql(text) {
      if (pending || closed || stopping || lastError || !child.stdin.writable
        || child.stdin.destroyed || child.stdin.writableEnded) {
        throw lastError || new Error('Control connection unavailable');
      }
      const marker = `__TRAK_CONTROL_${++sequence}__`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          recordError(new Error('Control connection exceeded 10s deadline'));
          void stop();
        }, 10_000);
        pending = { marker, resolve, reject, timer };
        try {
          child.stdin.write(`${text};\n\\echo ${marker}\n`, error => { if (error) recordError(error); });
        } catch (error) { recordError(error); }
      });
    },
    stop,
  };
}

let startAttempted = false, control, cleanupFailure, failure;
try {
  await chmod(directory, 0o700);
  await mkdir(socket, { mode: 0o700 });
  const version = await command('postgres', ['--version'], { timeoutMs: 10_000 });
  if (!/\(PostgreSQL\) 17\./.test(version.stdout)) throw new Error('PostgreSQL 17 required');
  console.log(`[feedback-review] ${version.stdout.trim()}`);
  await command('initdb', ['-D', data, '-U', 'postgres', '--locale=C', '--encoding=UTF8', '--auth-local=trust', '--auth-host=reject', '--no-instructions']);
  startAttempted = true;
  await command('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-w', '-t', '30', '-o',
    `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=${port} -c timezone=UTC`, 'start'], { timeoutMs: 40_000 });
  const plan = await buildReplayPlan(root, 'all');
  const replay = join(directory, 'replay.sql');
  await writeFile(replay, plan.sql, { mode: 0o600 });
  await command('psql', [...psqlArgs, '-f', replay], { timeoutMs: 180_000 });
  console.log(`[feedback-review] Replayed ${plan.migrationCount} real migrations and sequential suites.`);
  const failures = [];
  // Sequential review errors remain nonzero evidence; continue the independent
  // concurrency and restricted-default checks before reporting the final result.
  for (const suite of ['coach_rating_contract.sql', 'feedback_storage_review.sql']) {
    const sqlPath = join(directory, suite);
    await writeFile(sqlPath, await readFile(join(root, 'supabase/tests', suite), 'utf8'), { mode: 0o600 });
    // Each psql call opens a fresh connection. Mark only this runner-owned
    // cluster connection; bootstrap's session setting does not carry across.
    const result = await command('psql', [...psqlArgs, '-c', "SET trak.test_database='disposable'", '-f', sqlPath], { allowedCodes: [0, 3] });
    console.log(`[feedback-review] ${suite}: ${result.code === 0 ? 'PASS' : 'FAIL'}`);
    console.log(result.stderr.trim());
    if (result.code !== 0) failures.push(suite);
  }
  const fixture = `
    INSERT INTO auth.users(id,email,email_confirmed_at)
      SELECT ('98000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'feedback-concurrency-'||i||'@test.invalid',now() FROM generate_series(1,3) i;
    INSERT INTO profiles(user_id,role,full_name) VALUES
      ('${uid(1)}','coach','Synthetic Publication Coach'),
      ('${uid(2)}','player','Synthetic Publication Adult'),
      ('${uid(3)}','club','Synthetic Publication Admin');
    INSERT INTO organizations(id,admin_user_id,name,join_code)
      VALUES ('${uid(10)}','${uid(3)}','Synthetic Publication Academy','FB980');
    INSERT INTO coach_details(user_id,organization_id) VALUES ('${uid(1)}','${uid(10)}');
    INSERT INTO player_details(user_id,date_of_birth) VALUES ('${uid(2)}','2000-01-01');
    INSERT INTO squad_players(id,coach_user_id,linked_player_id,player_name)
      VALUES ('${uid(20)}','${uid(1)}','${uid(2)}','Synthetic Publication Adult');
  `;
  await query(fixture);
  const coach = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${uid(1)}","role":"authenticated"}',true);`;
  const publish = label => `SELECT public.publish_player_feedback('${uid(20)}','SYNTHETIC ${label}');`;
  control = controlConnection();
  // First call completes while its transaction remains open. Second transaction
  // overlaps that uncommitted publication. No timing assumption orders commits.
  const first = await control.sql(`BEGIN; SET LOCAL statement_timeout='15s'; ${coach} ${publish('A')}`);
  let secondResult;
  const second = query(`SET application_name='trak_feedback_publication_b'; BEGIN; SET LOCAL statement_timeout='15s'; ${coach} ${publish('B')} COMMIT;`)
    .then(value => (secondResult = { ok: true, output: value.stdout }), error => (secondResult = { ok: false, error: error.message }));
  let blocked = false;
  for (let attempt = 0; attempt < 100 && !secondResult; attempt++) {
    const status = await query("SELECT count(*) FROM pg_stat_activity WHERE application_name='trak_feedback_publication_b' AND wait_event_type='Lock';");
    blocked = Number(status.stdout.trim()) > 0;
    if (blocked) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (!secondResult && !blocked) throw new Error('Second publication neither finished nor reached an observed lock wait; concurrency schedule unproven');
  const secondFinishedBeforeFirstCommit = Boolean(secondResult);
  await control.sql('COMMIT');
  await second;
  const { stdout } = await query(`SELECT json_build_object(
    'rows', count(*), 'current', count(*) FILTER (WHERE superseded_at IS NULL),
    'distinct_revisions', count(DISTINCT revision),
    'revisions', json_agg(revision ORDER BY revision),
    'current_text', min(published_text) FILTER (WHERE superseded_at IS NULL)
  ) FROM player_feedback WHERE squad_player_id='${uid(20)}';`);
  const observed = JSON.parse(stdout.trim());
  const firstIds = first.split('\n').filter(line => /^[0-9a-f-]{36}$/.test(line));
  const secondIds = (secondResult.output || '').split('\n').filter(line => /^[0-9a-f-]{36}$/.test(line));
  const passed = firstIds.length === 1 && secondResult.ok && secondIds.length === 1
    && firstIds[0] !== secondIds[0] && observed.rows === 2 && observed.current === 1
    && observed.distinct_revisions === 2 && observed.revisions.join(',') === '1,2'
    && observed.current_text === 'SYNTHETIC B';
  console.log(`[feedback-review] ${JSON.stringify({ name: 'overlapping_first_publications', passed,
    blocked, secondFinishedBeforeFirstCommit, firstIds, secondIds, secondResult, observed })}`);
  if (!passed) failures.push('overlapping_first_publications');

  // Ownership must be checked after a contended row lock resolves. A departing
  // coach's old snapshot cannot authorize a publication after departure commits.
  // Use an adult fixture: this is independent of the deferred consent audit.
  await control.sql(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims','{"sub":"${uid(3)}","role":"authenticated"}',true);
    SELECT public.remove_coach_from_org('${uid(1)}');`);
  let departureResult;
  const duringDeparture = query(`SET application_name='trak_feedback_departure'; BEGIN; SET LOCAL statement_timeout='15s'; ${coach} ${publish('AFTER DEPARTURE')} COMMIT;`)
    .then(value => (departureResult = { ok: true, output: value.stdout }), error => (departureResult = { ok: false, error: error.message }));
  let departureBlocked = false;
  for (let attempt = 0; attempt < 100 && !departureResult; attempt++) {
    const status = await query("SELECT count(*) FROM pg_stat_activity WHERE application_name='trak_feedback_departure' AND wait_event_type='Lock';");
    departureBlocked = Number(status.stdout.trim()) > 0;
    if (departureBlocked) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await control.sql('COMMIT');
  await duringDeparture;
  if (!departureBlocked) throw new Error('Departure schedule did not reach the publication row-lock wait; outcome unproven');
  const afterDeparture = await query(`SELECT json_build_object(
    'rows', count(*), 'current', count(*) FILTER (WHERE superseded_at IS NULL),
    'unauthorized', count(*) FILTER (WHERE published_text='SYNTHETIC AFTER DEPARTURE')
  ) FROM player_feedback WHERE squad_player_id='${uid(20)}';`);
  const departureObserved = JSON.parse(afterDeparture.stdout.trim());
  const departurePassed = !departureResult.ok && departureResult.error.includes('Not your player')
    && departureObserved.rows === 2 && departureObserved.current === 1 && departureObserved.unauthorized === 0;
  console.log(`[feedback-review] ${JSON.stringify({ name: 'departure_during_publication_lock', passed: departurePassed,
    departureBlocked, response: departureResult, observed: departureObserved })}`);
  if (!departurePassed) failures.push('departure_during_publication_lock');

  // Replay with table default grants revoked immediately before PR40, as on a
  // project where new public tables require explicit Data API grants. Existing
  // migrations/defaults are unchanged; the application migration is not edited.
  await query('CREATE DATABASE feedback_restricted');
  const restrictedArgs = psqlArgs.map((arg, i) => psqlArgs[i - 1] === '-d' ? 'feedback_restricted' : arg);
  const marker = '\\echo [stage] 20260918120000_coach_approved_feedback.sql';
  if (plan.sql.split(marker).length !== 2) throw new Error('Expected exactly one PR40 migration in the replay');
  let restrictedPlan = plan.sql.replace(marker,
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;\n' + marker);
  // Roles are cluster-wide and were created by the first bootstrap. Keep all
  // bootstrap grants and every application migration in the second database.
  for (const statement of ['CREATE ROLE anon NOLOGIN;', 'CREATE ROLE authenticated NOLOGIN;', 'CREATE ROLE service_role NOLOGIN BYPASSRLS;']) {
    if (restrictedPlan.split(statement).length !== 2) throw new Error('Expected one bootstrap role declaration');
    restrictedPlan = restrictedPlan.replace(statement, '-- Test role already exists in this private cluster.');
  }
  const restrictedPath = join(directory, 'restricted.sql');
  await writeFile(restrictedPath, restrictedPlan, { mode: 0o600 });
  await command('psql', [...restrictedArgs, '-f', restrictedPath], { timeoutMs: 180_000 });
  const restricted = await command('psql', [...restrictedArgs, '-c', `${fixture}
    BEGIN; ${coach} ${publish('RESTRICTED')} COMMIT;
    BEGIN;
    CREATE TEMP TABLE feedback_read_result(name text, passed boolean, observed text);
    GRANT INSERT ON feedback_read_result TO authenticated;
    CREATE FUNCTION pg_temp.read_publication(label text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $test$
    DECLARE n integer;
    BEGIN
      SELECT count(*) INTO n FROM public.player_feedback WHERE squad_player_id='${uid(20)}';
      INSERT INTO pg_temp.feedback_read_result VALUES(label,n=1,'rows='||n);
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO pg_temp.feedback_read_result VALUES(label,false,'permission denied');
    END $test$;
    ${coach}
    SELECT pg_temp.read_publication('owning coach reads approved publication');
    SELECT set_config('request.jwt.claims','{"sub":"${uid(2)}","role":"authenticated"}',true);
    SELECT pg_temp.read_publication('linked adult reads approved publication');
    RESET ROLE;
    SELECT 'RESTRICTED_RESULT='||jsonb_agg(to_jsonb(feedback_read_result))::text FROM feedback_read_result;
    ROLLBACK;
  `]);
  const resultLine = restricted.stdout.split('\n').find(line => line.startsWith('RESTRICTED_RESULT='));
  if (!resultLine) throw new Error('Restricted-default publication results missing');
  const reads = JSON.parse(resultLine.slice('RESTRICTED_RESULT='.length));
  console.log(`[feedback-review] Restricted-default ACL results: ${JSON.stringify(reads)}`);
  if (reads.length !== 2 || reads.some(row => !row.passed)) failures.push('restricted_default_table_access');
  if (failures.length) throw new Error(`Unresolved feedback review: ${failures.join(', ')}`);
} catch (error) {
  failure = error;
  console.error(`[feedback-review] ${error.message}`);
  try { console.error((await readFile(join(directory, 'server.log'), 'utf8')).slice(-2000)); } catch { /* startup may not have produced a log */ }
} finally {
  try {
    if (control && !await control.stop()) {
      failure ||= new Error('Control psql did not close within its shutdown deadline');
      console.error(`[feedback-review] ${failure.message}; continuing cluster shutdown.`);
    }
  } catch (error) {
    // The cluster must still stop if control teardown itself encounters trouble.
    failure ||= error;
    console.error(`[feedback-review] Control cleanup failed: ${error.message}; continuing cluster shutdown.`);
  }
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
    console.log('[feedback-review] Temporary cluster stopped and directory removed.');
  } else console.error(`[feedback-review] Cleanup failed; inspect only ${directory}: ${cleanupFailure.message}`);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
if (failure || cleanupFailure) process.exitCode = 1;
