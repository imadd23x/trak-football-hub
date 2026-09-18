import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyDemo } from './apply.mjs';
import { buildDemoPlan } from './plan.mjs';
import { migrationReplayOrder } from '../test-native-db.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plan = buildDemoPlan({ asOf: '2026-09-25' });
const credentials = {
  namespace: plan.namespace,
  // Test-only values, never sent to an Auth service or used as real passwords.
  passwords: Object.fromEntries(plan.accounts.map(account => [account.id, 'synthetic-test-password-not-for-login'])),
};
const sentinelId = '96000000-0000-0000-0000-000000000001';
const identifier = value => {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
};

async function caller(db, role, id = null) {
  assert.ok(['authenticated', 'service_role'].includes(role));
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, ...(id ? { sub: id } : {}) })]);
}

async function fixture(t, replayMode = 'all') {
  // No path/URL/config is accepted: this database exists in memory only.
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(resolve(root, 'supabase/tests/bootstrap.sql'), 'utf8'));
  const migrations = migrationReplayOrder((await readdir(resolve(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')), replayMode);
  for (const name of migrations) {
    try {
      await db.exec(await readFile(resolve(root, 'supabase/migrations', name), 'utf8'));
    } catch (error) {
      throw new Error(`Real migration replay failed at ${name}`, { cause: error });
    }
  }
  assert.ok(migrations.includes('20260917205027_secure_parent_invites.sql'), 'P1 is a seed-review dependency');
  assert.ok(migrations.includes('20260918062345_preserve_academy_access_and_fk_cleanup.sql'), 'academy access/adoption repair is a seed-review dependency');
  t.diagnostic(`Replayed ${migrations.length} real migrations (${replayMode}); Auth HTTP/email/password behavior is not simulated or verified.`);

  // The SQL Auth boundary stores real FK identities. Only the admin API's
  // app_metadata is represented in JS because bootstrap intentionally omits
  // GoTrue internals. This is not proof of createUser/login/email behavior.
  const authMetadata = new Map();
  const writes = { accounts: 0, records: 0 };
  const adapter = {
    async getAccount(id) {
      await db.exec('RESET ROLE');
      const { rows } = await db.query('SELECT to_jsonb(u) AS account FROM auth.users u WHERE id=$1', [id]);
      return rows[0] ? { ...rows[0].account, app_metadata: authMetadata.get(id) ?? {} } : null;
    },
    async createAccount(attributes) {
      await db.exec('RESET ROLE');
      await db.query('INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3::jsonb)',
        [attributes.id, attributes.email, JSON.stringify(attributes.user_metadata)]);
      authMetadata.set(attributes.id, structuredClone(attributes.app_metadata));
      writes.accounts++;
    },
    async getRecord({ table, row }) {
      await caller(db, 'service_role');
      const result = await db.query(`SELECT to_jsonb(r) AS record FROM public.${identifier(table)} r WHERE id=$1`, [row.id]);
      return result.rows[0]?.record ?? null;
    },
    async createRecord({ table, row }) {
      await caller(db, 'service_role');
      const columns = Object.keys(row);
      const values = columns.map(column => row[column]);
      try {
        await db.query(`INSERT INTO public.${identifier(table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, values);
      } catch (error) {
        throw new Error(`Manifest/schema mismatch at ${table}/${row.id}: ${error.message}`, { cause: error });
      }
      writes.records++;
    },
  };

  // An unrelated identity is deliberately outside the manifest namespace.
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [sentinelId, 'unrelated-sentinel@test.invalid']);
  await db.query("INSERT INTO public.profiles(user_id,role,full_name) VALUES($1,'player','Unrelated sentinel, never modify')", [sentinelId]);
  return { db, adapter, writes, authMetadata };
}

async function snapshot(db) {
  await db.exec('RESET ROLE');
  const tables = ['auth.users', ...new Set(['profiles', ...plan.records.map(record => record.table)].map(table => `public.${identifier(table)}`))];
  const result = {};
  for (const table of tables) {
    result[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id::text),'[]'::jsonb) AS records FROM ${table} r`)).rows[0].records;
  }
  return result;
}

async function sentinel(db) {
  await db.exec('RESET ROLE');
  return (await db.query('SELECT to_jsonb(u) AS account,to_jsonb(p) AS profile FROM auth.users u JOIN public.profiles p ON p.user_id=u.id WHERE u.id=$1', [sentinelId])).rows[0];
}

function failOnce(adapter, operation, when, at = 3) {
  let calls = 0;
  return {
    ...adapter,
    async [operation](value) {
      const fail = ++calls === at;
      if (fail && when === 'before') throw new Error('Injected failure before write');
      await adapter[operation](value);
      if (fail && when === 'after') throw new Error('Injected response lost after committed write');
    },
  };
}

for (const replayMode of ['all', '--academy-upgrade-review']) {
  test(`real schema (${replayMode}): fresh apply, exact replay and unrelated identity preservation`, async t => {
    const { db, adapter, writes } = await fixture(t, replayMode);
    const untouched = await sentinel(db);
    const first = await applyDemo(plan, adapter, credentials);
    assert.equal(first.createdAccounts, plan.accounts.length);
    assert.equal(first.insertedRecords, plan.records.length);
    assert.equal(first.existingAccounts, 0);
    assert.equal(first.existingRecords, 0);
    assert.deepEqual((await db.query('SELECT current_user AS role,auth.uid() AS uid')).rows,
      [{ role: 'service_role', uid: null }], 'database fixture writes use service role without impersonating an end user');
    assert.deepEqual(await sentinel(db), untouched);
    const stored = await snapshot(db);
    const before = { ...writes };
    const second = await applyDemo(plan, adapter, credentials);
    assert.equal(second.createdAccounts, 0);
    assert.equal(second.insertedRecords, 0);
    assert.equal(second.existingAccounts, plan.accounts.length);
    assert.equal(second.existingRecords, plan.records.length);
    assert.deepEqual(writes, before, 'second apply performs no writes at all');
    assert.deepEqual(await snapshot(db), stored, 'all stored values, including defaults, remain unchanged');
    assert.deepEqual(await sentinel(db), untouched);
  });
}

for (const [operation, when] of [['createRecord', 'before'], ['createRecord', 'after'], ['createAccount', 'after']]) {
  test(`real schema: resume ${operation} ${when === 'before' ? 'partial failure' : 'uncertain response'} without duplicates`, async t => {
    const { db, adapter, writes } = await fixture(t);
    const untouched = await sentinel(db);
    await assert.rejects(applyDemo(plan, failOnce(adapter, operation, when), credentials), /Injected/);
    assert.ok(writes.accounts > 0, 'the interrupted attempt really persisted part of the plan');
    await applyDemo(plan, adapter, credentials);
    assert.deepEqual(writes, { accounts: plan.accounts.length, records: plan.records.length }, 'each planned identity and row is created once across attempts');
    const complete = await snapshot(db);
    await applyDemo(plan, adapter, credentials);
    assert.deepEqual(writes, { accounts: plan.accounts.length, records: plan.records.length });
    assert.deepEqual(await snapshot(db), complete);
    assert.deepEqual(await sentinel(db), untouched);
  });
}

test('actual roles: two-child parent data and foreign-academy reads/writes', async t => {
  const { db, adapter } = await fixture(t);
  await applyDemo(plan, adapter, credentials);
  const stored = await snapshot(db);
  const academies = plan.scenarios.academies;
  assert.deepEqual(academies.map(academy => academy.country).sort(), ['AE', 'GR']);
  for (const academy of academies) {
    const foreign = academies.find(other => other.organizationId !== academy.organizationId);
    await caller(db, 'authenticated', academy.accounts.parent);
    const links = (await db.query('SELECT player_user_id FROM public.player_parent_links WHERE parent_user_id=$1 ORDER BY player_user_id', [academy.accounts.parent])).rows;
    assert.deepEqual(links.map(link => link.player_user_id), [...academy.parentChildIds].sort());
    const names = (await db.query('SELECT full_name FROM public.profiles WHERE user_id=ANY($1::uuid[])', [academy.parentChildIds])).rows;
    assert.equal(new Set(names.map(profile => profile.full_name)).size, 2);
    const adultMatches = (await db.query('SELECT id FROM public.matches WHERE user_id=$1', [academy.accounts.adult1])).rows;
    assert.ok(adultMatches.length > 0, 'adult child has distinct visible match history');
    assert.equal((await db.query('SELECT id FROM public.matches WHERE user_id=$1', [academy.accounts.minor17])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM public.matches WHERE user_id=$1', [foreign.accounts.adult1])).rows.length, 0);

    await caller(db, 'authenticated', academy.accounts.coach);
    assert.equal((await db.query('SELECT id FROM public.squad_players WHERE id=$1', [academy.roster.adult1])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM public.squad_players WHERE id=$1', [foreign.roster.adult1])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM public.coach_assessments WHERE squad_player_id=$1', [foreign.roster.adult1])).rows.length, 0);
    assert.equal((await db.query('UPDATE public.squad_players SET shirt_number=99 WHERE id=$1 RETURNING id', [foreign.roster.adult1])).rows.length, 0);
    await assert.rejects(db.query('INSERT INTO public.coach_assessments(coach_user_id,squad_player_id) VALUES($1,$2)', [academy.accounts.coach, foreign.roster.adult1]), error => error.code === '42501');

    await caller(db, 'authenticated', academy.accounts.admin);
    assert.equal((await db.query('SELECT user_id FROM public.player_details WHERE user_id=$1', [academy.accounts.adult1])).rows.length, 1);
    assert.equal((await db.query('SELECT user_id FROM public.player_details WHERE user_id=$1', [foreign.accounts.adult1])).rows.length, 0);
    assert.equal((await db.query('SELECT user_id FROM public.profiles WHERE user_id=$1', [foreign.accounts.adult1])).rows.length, 0);
  }
  assert.deepEqual(await snapshot(db), stored, 'denied foreign writes leave all fixture data intact');
});

test('actual player linking RPC adopts each prepared stub without losing its two assessments', async t => {
  const { db, adapter, writes } = await fixture(t);
  await applyDemo(plan, adapter, credentials);
  for (const academy of plan.scenarios.academies) {
    await caller(db, 'service_role');
    const before = (await db.query('SELECT to_jsonb(a) AS assessment FROM public.coach_assessments a WHERE squad_player_id=$1 ORDER BY id', [academy.roster.adoptionStub])).rows;
    assert.deepEqual(before.map(row => row.assessment.id).sort(), [...academy.adoptionAssessmentIds].sort());
    const coachProfile = plan.records.find(record => record.table === 'profiles' && record.row.user_id === academy.accounts.coach);
    assert.ok(coachProfile?.row.invite_code);
    await caller(db, 'authenticated', academy.accounts.adoptionAdult);
    for (let attempt = 0; attempt < 2; attempt++) {
      const linked = (await db.query('SELECT public.link_player_to_coach($1) AS id', [`TRK-${coachProfile.row.invite_code}`])).rows[0];
      assert.equal(linked.id, academy.roster.adoptionStub);
    }
    const after = (await db.query('SELECT to_jsonb(a) AS assessment FROM public.coach_assessments a WHERE squad_player_id=$1 ORDER BY id', [academy.roster.adoptionStub])).rows;
    assert.deepEqual(after, before);
    const roster = (await db.query('SELECT id,organization_id FROM public.squad_players WHERE linked_player_id=$1', [academy.accounts.adoptionAdult])).rows;
    assert.deepEqual(roster, [{ id: academy.roster.adoptionStub, organization_id: academy.organizationId }]);
  }
  const exercised = await snapshot(db);
  const beforeReplay = { ...writes };
  await assert.rejects(applyDemo(plan, adapter, credentials), /Fixture content conflict/);
  assert.deepEqual(writes, beforeReplay, 'an exercised fixture is not silently reset');
  assert.deepEqual(await snapshot(db), exercised);
});

test('fixture safety: no consent, telemetry, private feedback or minor development is fabricated', async t => {
  const { db, adapter } = await fixture(t);
  await applyDemo(plan, adapter, credentials);
  await caller(db, 'service_role');
  for (const table of ['parental_consents', 'telemetry_events', 'coach_assessment_notes', 'parent_invites']) {
    assert.equal((await db.query(`SELECT count(*) AS count FROM public.${identifier(table)}`)).rows[0].count, 0, `${table} remains empty`);
  }
  for (const academy of plan.scenarios.academies) {
    const heldRoster = [academy.roster.minor17, academy.roster.missingAge];
    const age = (await db.query('SELECT extract(year FROM age($1::date,date_of_birth))::int AS age FROM public.player_details WHERE user_id=$2', [plan.asOf, academy.accounts.minor17])).rows[0]?.age;
    assert.equal(age, 17, 'minor fixture is seventeen on the explicit rehearsal date');
    for (const table of ['coach_assessments', 'recognition_awards', 'session_attendance', 'meeting_requests']) {
      assert.equal((await db.query(`SELECT count(*) AS count FROM public.${identifier(table)} WHERE squad_player_id=ANY($1::uuid[])`, [heldRoster])).rows[0].count, 0, `${table} has no minor/missing-age development`);
    }
    assert.equal((await db.query('SELECT count(*) AS count FROM public.matches WHERE user_id=$1', [academy.accounts.minor17])).rows[0].count, 0);
  }
  const threshold = (await db.query('SELECT public.consent_threshold_age() AS age')).rows[0].age;
  t.diagnostic(`Current database threshold is ${threshold}. Seed cleanliness is not proof of U3 or under-18 enforcement; that separate consent audit remains required.`);
});
