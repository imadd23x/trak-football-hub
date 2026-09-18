#!/usr/bin/env node
// Synthetic PG17 query comparison only. Never connects to an existing cluster.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplayPlan, childEnvironment, runCommand, temporaryRoot } from './test-native-db.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const coach = '95000000-0000-0000-0000-000000000001';
const indexName = 'idx_coach_assessments_coach_created';
const migrationName = '20260918080430_index_coach_assessment_history.sql';
const expectedIndexDefinition = `CREATE INDEX ${indexName} ON public.coach_assessments USING btree (coach_user_id, created_at DESC)`;

function usesIndex(plan, name) {
  return plan['Index Name'] === name || (plan.Plans ?? []).some(child => usesIndex(child, name));
}

// Fingerprint complete fixture rows and all public RLS policies independently
// of the application result comparisons. Index creation must change none.
const fixtureStateSql = `SELECT json_build_object(
  'assessments', (SELECT md5(string_agg(row_to_json(a)::text, '' ORDER BY a.id)) FROM public.coach_assessments a),
  'rosters', (SELECT md5(string_agg(row_to_json(sp)::text, '' ORDER BY sp.id)) FROM public.squad_players sp),
  'policies', (SELECT md5(string_agg(row_to_json(p)::text, '' ORDER BY p.oid))
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
);`;
export const queries = {
  squad_history: `SELECT squad_player_id,coach_rating,created_at FROM public.coach_assessments WHERE coach_user_id='${coach}' ORDER BY created_at DESC`,
  home_history_analytics: `SELECT id,squad_player_id,coach_rating,created_at FROM public.coach_assessments WHERE coach_user_id='${coach}' ORDER BY created_at DESC`,
  // SQL equivalent of the routed Home feed's projection and embedded player.
  // This is not the PostgREST-generated plan or an HTTP/network measurement.
  home_latest5: `SELECT a.*,row_to_json(p) AS squad_players FROM (SELECT * FROM public.coach_assessments WHERE coach_user_id='${coach}' ORDER BY created_at DESC LIMIT 5) a LEFT JOIN LATERAL (SELECT sp.player_name FROM public.squad_players sp WHERE sp.id=a.squad_player_id) p ON true ORDER BY a.created_at DESC`,
  latest_per_player: `SELECT sp.id AS squad_player_id,a.coach_rating,a.created_at FROM public.squad_players sp LEFT JOIN LATERAL (SELECT ca.coach_rating,ca.created_at FROM public.coach_assessments ca WHERE ca.squad_player_id=sp.id AND ca.coach_user_id=auth.uid() AND ca.coach_rating IS NOT NULL ORDER BY ca.created_at DESC LIMIT 1) a ON true WHERE sp.coach_user_id=auth.uid() ORDER BY sp.player_name`,
};

export const fixtureSql = `
SET statement_timeout='60s';
CREATE FUNCTION pg_temp.perf_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
$$;
-- Twenty separate academies with one coach and thirty linked adults each.
-- All writes below run as the disposable owner, before authenticated reads.
INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT pg_temp.perf_id(n),'perf-'||n||'@test.invalid',now() FROM (
  SELECT generate_series(1,20) n
  UNION ALL SELECT generate_series(1001,1020)
  UNION ALL SELECT generate_series(10001,10600)
) identities;
INSERT INTO public.profiles(user_id,role,full_name)
SELECT pg_temp.perf_id(n),'coach','Synthetic Coach '||n FROM generate_series(1,20)n;
INSERT INTO public.profiles(user_id,role,full_name)
SELECT pg_temp.perf_id(1000+n),'club','Synthetic Admin '||n FROM generate_series(1,20)n;
INSERT INTO public.profiles(user_id,role,full_name)
SELECT pg_temp.perf_id(10000+n),'player','Synthetic Player '||n FROM generate_series(1,600)n;
INSERT INTO public.player_details(user_id,date_of_birth)
SELECT pg_temp.perf_id(10000+n),date '2000-01-01' FROM generate_series(1,600)n;
INSERT INTO public.organizations(id,admin_user_id,name,join_code)
SELECT pg_temp.perf_id(2000+n),pg_temp.perf_id(1000+n),'Synthetic Performance Academy '||n,'PERF-ORG-'||n
FROM generate_series(1,20)n;
INSERT INTO public.coach_details(user_id,organization_id)
SELECT pg_temp.perf_id(n),pg_temp.perf_id(2000+n) FROM generate_series(1,20)n;
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id)
SELECT pg_temp.perf_id(20000+n),pg_temp.perf_id(1+(n-1)/30),'Synthetic Player '||n,pg_temp.perf_id(10000+n)
FROM generate_series(1,600)n;
INSERT INTO public.coach_assessments(coach_user_id,squad_player_id,created_at)
SELECT pg_temp.perf_id(1+(n-1)/30),pg_temp.perf_id(20000+n),
  timestamptz '2026-09-18 12:00:00+00'-(s*7+60)*interval '1 day'-n*interval '1 second'
FROM generate_series(1,600)n CROSS JOIN generate_series(1,50)s;
INSERT INTO public.coach_assessments(coach_user_id,squad_player_id,created_at)
SELECT pg_temp.perf_id(1),pg_temp.perf_id(20001),timestamptz '2026-09-18 12:00:00+00'-s*interval '1 hour'
FROM generate_series(1,1100)s;
ANALYZE;
SELECT json_build_object(
  'synthetic_coaches',(SELECT count(*) FROM coach_details WHERE user_id::text LIKE '95000000-%'),
  'synthetic_club_admins',(SELECT count(*) FROM profiles WHERE user_id::text LIKE '95000000-%' AND role='club'),
  'synthetic_organizations',(SELECT count(*) FROM organizations WHERE id::text LIKE '95000000-%'),
  'synthetic_adult_players',(SELECT count(*) FROM player_details WHERE user_id::text LIKE '95000000-%' AND date_of_birth=date '2000-01-01'),
  'synthetic_rosters',(SELECT count(*) FROM squad_players WHERE id::text LIKE '95000000-%'),
  'synthetic_linked_org_rosters',(SELECT count(*) FROM squad_players sp JOIN coach_details cd ON cd.user_id=sp.coach_user_id
    WHERE sp.id::text LIKE '95000000-%' AND sp.linked_player_id IS NOT NULL AND sp.organization_id=cd.organization_id),
  'synthetic_assessments',(SELECT count(*) FROM coach_assessments WHERE coach_user_id::text LIKE '95000000-%'),
  'all_rosters',(SELECT count(*) FROM squad_players),
  'all_assessments',(SELECT count(*) FROM coach_assessments));
`;

// Default SECURITY INVOKER: EXPLAIN and result capture use the authenticated
// caller and real RLS, not the bootstrap owner. Each psql owns its temp function.
const captureFunction = `
CREATE FUNCTION pg_temp.capture_perf(p_sql text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $capture$
DECLARE p jsonb; rows jsonb; started timestamptz; finished timestamptz;
BEGIN
 started:=clock_timestamp();
 EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '||p_sql INTO p;
 finished:=clock_timestamp();
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) FROM ('||p_sql||')x' INTO rows;
 RETURN jsonb_build_object('pid',pg_backend_pid(),'role',current_user,'uid',auth.uid(),
  'started_at',started,'finished_at',finished,'plan',p->0,'rows',rows);
END;
$capture$;
SET statement_timeout='10s';
SET ROLE authenticated;
SET request.jwt.claims='{"role":"authenticated","sub":"${coach}"}';
`;
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const brief = result => ({
  pid: result.pid,
  role: result.role,
  uid: result.uid,
  rows: result.rows.length,
  execution_ms: result.plan['Execution Time'],
  planning_ms: result.plan['Planning Time'],
  shared_hits: result.plan.Plan['Shared Hit Blocks'],
  shared_reads: result.plan.Plan['Shared Read Blocks'],
  total_cost: result.plan.Plan['Total Cost'],
  sha256: digest(result.rows),
});

export async function runPerformance(args = []) {
  if (args.length) {
    throw new Error('Usage: node scripts/test-query-performance.mjs (no database URL or other arguments accepted)');
  }
  const bin = process.env.TRAK_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
  if (!isAbsolute(bin)) throw new Error('TRAK_TEST_PG_BIN must be an absolute PG17 binary directory');

  const directory = await mkdtemp(join(temporaryRoot, 'trak-query-pg17-'));
  const data = join(directory, 'data');
  const socket = join(directory, 'socket');
  const port = '55443';
  const env = childEnvironment(bin, directory);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const command = (name, argv, options = {}) => runCommand(join(bin, name), argv, {
    cwd: directory, env, signal: controller.signal, ...options,
  });
  const psql = ['-X', '--no-password', '-h', socket, '-p', port, '-U', 'postgres',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'];
  const query = sql => command('psql', [...psql, '-c', sql], { timeoutMs: 70_000 });
  let started = false, failure, cleanupFailure, artifactDirectory;
  const report = {
    synthetic: true,
    limitations: 'Local single-machine SQL, twenty academies with linked synthetic adult players and uneven history. No HTTP, hosted latency, load SLA or verified hosted row cap. Sequential replay fixtures remain and total counts are recorded.',
    queries,
    runs: {},
  };

  try {
    await chmod(directory, 0o700);
    await mkdir(socket, { mode: 0o700 });
    const version = await command('postgres', ['--version'], { timeoutMs: 10_000 });
    if (!/\(PostgreSQL\) 17\./.test(version.stdout)) throw new Error('PostgreSQL 17 required');
    report.version = version.stdout.trim();
    console.log('[query-performance]', report.version);
    await command('initdb', ['-D', data, '-U', 'postgres', '--locale=C', '--encoding=UTF8',
      '--auth-local=trust', '--auth-host=reject', '--no-instructions']);
    started = true;
    await command('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-w', '-t', '30', '-o',
      `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=${port} -c timezone=UTC`, 'start'],
    { timeoutMs: 40_000 });

    const replay = await buildReplayPlan(root, 'all');
    await writeFile(join(directory, 'replay.sql'), replay.sql, { mode: 0o600 });
    await command('psql', [...psql, '-f', join(directory, 'replay.sql')], { timeoutMs: 180_000 });
    report.migration_count = replay.migrationCount;
    console.log('[query-performance] Replayed migrations and sequential suites:', replay.migrationCount);
    report.counts = JSON.parse((await query(fixtureSql)).stdout.trim());
    assert.equal(report.counts.synthetic_coaches, 20);
    assert.equal(report.counts.synthetic_club_admins, 20);
    assert.equal(report.counts.synthetic_organizations, 20);
    assert.equal(report.counts.synthetic_adult_players, 600);
    assert.equal(report.counts.synthetic_rosters, 600);
    assert.equal(report.counts.synthetic_linked_org_rosters, 600);
    assert.equal(report.counts.synthetic_assessments, 31100);
    console.log('[query-performance] Counts:', JSON.stringify(report.counts));
    const fixtureState = JSON.parse((await query(fixtureStateSql)).stdout.trim());
    const migrationSql = await readFile(join(root, 'supabase/migrations', migrationName), 'utf8');
    const replayedDefinition = (await query(`SELECT pg_get_indexdef('public.${indexName}'::regclass);`)).stdout.trim();
    assert.equal(replayedDefinition, expectedIndexDefinition);
    report.index_migration = {
      file: migrationName,
      sha256: createHash('sha256').update(migrationSql).digest('hex'),
      replayed_definition: replayedDefinition,
    };

    // Full replay includes the real migration. Remove exactly its index in
    // this owned disposable cluster to obtain an honest unindexed baseline.
    // No other index, row, policy or function is removed or rewritten.
    await query(`DROP INDEX public.${indexName};`);
    const absent = JSON.parse((await query(`SELECT to_json(to_regclass('public.${indexName}') IS NULL);`)).stdout.trim());
    assert.equal(absent, true);
    report.index_migration.absent_in_baseline = absent;

    async function capture(label, sql) {
      const output = join(directory, `${label}.json`);
      const script = join(directory, `${label}.sql`);
      // Output goes to a private file so large complete result sets and plans
      // are never truncated by the bounded child-process console capture.
      await writeFile(script,
        `\\set ON_ERROR_STOP on\n${captureFunction}\n\\o ${output}\nSELECT pg_temp.capture_perf(${quote(sql)});\n`,
        { mode: 0o600 });
      await command('psql', [...psql, '-f', script], { timeoutMs: 20_000 });
      const result = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(result.role, 'authenticated');
      assert.equal(result.uid, coach);
      return result;
    }

    for (const phase of ['before', 'after']) {
      if (phase === 'after') {
        // Apply the actual repository file, not a hand-written equivalent.
        // The server observation covers migration planning/build plus its
        // immediate metadata query; client wall time also includes connection
        // startup. ANALYZE below is excluded. Neither is a production SLA.
        const buildStarted = performance.now();
        const build = await query(`
          SET statement_timeout='30s';
          DO $timer$ BEGIN
            PERFORM set_config('trak.perf_index_build_started', clock_timestamp()::text, false);
          END; $timer$;
          ${migrationSql}
          SELECT json_build_object(
            'database_build_elapsed_ms', extract(epoch FROM clock_timestamp()
              - current_setting('trak.perf_index_build_started')::timestamptz) * 1000,
            'definition', pg_get_indexdef('public.${indexName}'::regclass),
            'size_bytes', pg_relation_size('public.${indexName}'::regclass));
        `);
        report.index_migration.build = JSON.parse(build.stdout.trim());
        report.index_migration.build.client_wall_ms = performance.now() - buildStarted;
        assert.equal(report.index_migration.build.definition, expectedIndexDefinition);
        assert.ok(report.index_migration.build.size_bytes > 0);
        await query('ANALYZE public.coach_assessments;');
        console.log('[query-performance] Real index migration:', JSON.stringify(report.index_migration));
      }
      const runs = {};
      report.runs[phase] = runs;
      for (const [name, sql] of Object.entries(queries)) {
        runs[name] = await capture(`${phase}_${name}`, sql);
        console.log(`[query-performance] ${phase}/${name}`, JSON.stringify(brief(runs[name])));
      }

      assert.equal(runs.home_history_analytics.rows.length, 2600);
      assert.equal(runs.home_latest5.rows.length, 5);
      const identity = ({ id, squad_player_id, created_at }) => ({ id, squad_player_id, created_at });
      assert.deepEqual(runs.home_latest5.rows.map(identity),
        runs.home_history_analytics.rows.slice(0, 5).map(identity));
      for (const row of runs.home_latest5.rows) {
        assert.equal(row.coach_user_id, coach);
        assert.equal(row.squad_players.player_name, 'Synthetic Player 1');
      }
      const homeUsesIndex = usesIndex(runs.home_latest5.plan.Plan, indexName);
      assert.equal(homeUsesIndex, phase === 'after');
      runs.home_uses_named_index = homeUsesIndex;

      const latest = new Map();
      for (const row of runs.squad_history.rows) {
        if (!latest.has(row.squad_player_id) && row.coach_rating !== null) {
          latest.set(row.squad_player_id, row);
        }
      }
      assert.equal(runs.squad_history.rows.length, 2600);
      assert.equal(latest.size, 30);
      assert.equal(runs.latest_per_player.rows.length, 30);
      for (const row of runs.latest_per_player.rows) {
        assert.deepEqual(row, latest.get(row.squad_player_id));
      }

      const parallel = await Promise.all(Array.from({ length: 5 }, (_, index) =>
        capture(`${phase}_parallel_${index}`, queries.home_latest5)));
      assert.equal(new Set(parallel.map(result => result.pid)).size, 5);
      for (const result of parallel) assert.deepEqual(result.rows, runs.home_latest5.rows);
      // These are observed EXPLAIN execution intervals, not launch times.
      // Date parsing has millisecond precision; sub-ms overlap may go unobserved.
      const overlap = parallel.some((a, i) => parallel.some((b, j) =>
        i < j && Date.parse(a.started_at) < Date.parse(b.finished_at)
          && Date.parse(b.started_at) < Date.parse(a.finished_at)));
      runs.parallel_latest5 = parallel;
      runs.observed_explain_overlap = overlap;
      console.log(`[query-performance] ${phase}/five-independent-clients`, JSON.stringify({
        observed_explain_overlap: overlap,
        results: parallel.map(brief),
      }));
    }

    for (const name of Object.keys(queries)) {
      assert.deepEqual(report.runs.after[name].rows, report.runs.before[name].rows);
    }
    assert.deepEqual(JSON.parse((await query(fixtureStateSql)).stdout.trim()), fixtureState);
    report.fixture_rows_and_policies_unchanged = true;
    report.identical_before_after = true;
    artifactDirectory = await mkdtemp(join(temporaryRoot, 'trak-query-report-'));
    await chmod(artifactDirectory, 0o700);
    await writeFile(join(artifactDirectory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log('[query-performance] Identical full result rows before/after; latest-per-player matches full history. No timing threshold asserted.');
    console.log('[query-performance] Full synthetic plans/results:', join(artifactDirectory, 'report.json'));
  } catch (error) {
    failure = error;
    console.error('[query-performance]', error.message);
    try {
      console.error((await readFile(join(directory, 'server.log'), 'utf8')).slice(-2000));
    } catch {
      // Startup may not create a log.
    }
  } finally {
    if (started) {
      try {
        await command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'],
          { signal: undefined, timeoutMs: 20_000 });
      } catch (error) {
        const status = await command('pg_ctl', ['-D', data, 'status'],
          { signal: undefined, timeoutMs: 10_000, allowedCodes: [0, 3] }).catch(() => undefined);
        if (status?.code !== 3) cleanupFailure = error;
      }
    }
    if (!cleanupFailure) {
      try {
        await rm(directory, { recursive: true, force: true });
        console.log('[query-performance] Owned cluster stopped and removed.');
      } catch (error) {
        cleanupFailure = error;
      }
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  if (cleanupFailure) throw new Error(`Cleanup failed; inspect only ${directory}: ${cleanupFailure.message}`);
  if (failure) throw failure;
  return artifactDirectory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPerformance(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
