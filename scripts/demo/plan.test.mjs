import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { buildDemoPlan } from './plan.mjs';

const asOf = '2026-09-25';
const rows = (plan, table) => plan.records.filter(record => record.table === table).map(record => record.row);
const age = (birth, date) => Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) - (date.slice(5) < birth.slice(5) ? 1 : 0);

test('requires an exact, valid calendar date, including century leap rules', () => {
  for (const invalid of [undefined, null, 20260925, '', '2026-9-25', '2026-09-25\n', '2026-09-25T00:00:00Z',
    '2026-02-29', '2024-02-30', '1900-02-29', '2100-02-29', '2026-00-01', '2026-13-01', '2026-04-31', '0000-01-01']) {
    assert.throws(() => buildDemoPlan({ asOf: invalid }), /asOf/);
  }
  assert.throws(() => buildDemoPlan(), /asOf/);
  assert.equal(buildDemoPlan({ asOf: '2000-02-29' }).asOf, '2000-02-29');
});

test('rejects dates outside the supported range before generating historical offsets or extended years', () => {
  for (const invalid of ['0026-01-01', '1900-01-01', '1999-12-31', '2101-01-01', '9999-12-31']) {
    assert.throws(() => buildDemoPlan({ asOf: invalid }), /asOf must be between 2000-01-01 and 2100-12-31/);
  }
  for (const boundary of ['2000-01-01', '2100-12-31']) {
    const plan = buildDemoPlan({ asOf: boundary });
    for (const event of rows(plan, 'coach_calendar_events')) {
      assert.match(event.starts_at, /^\d{4}-\d{2}-\d{2}T18:00:00\+0[234]:00$/);
      assert.ok(Number.isFinite(Date.parse(event.starts_at)));
    }
  }
});

test('same input produces independent, JSON-stable plans without clock or randomness', () => {
  const baseline = buildDemoPlan({ asOf });
  const originalDate = Date, originalRandom = Math.random, originalFetch = globalThis.fetch;
  globalThis.Date = class ExplicitDateOnly extends originalDate {
    constructor(...args) {
      if (!args.length) throw new Error('Current clock must not be consulted');
      super(...args);
    }
    static now() { throw new Error('Current clock must not be consulted'); }
  };
  Math.random = globalThis.fetch = () => { throw new Error('Non-deterministic/external dependency'); };
  try { assert.deepEqual(buildDemoPlan({ asOf }), baseline); }
  finally { globalThis.Date = originalDate; Math.random = originalRandom; globalThis.fetch = originalFetch; }
  baseline.records[0].row.full_name = 'Changed by caller';
  assert.notEqual(buildDemoPlan({ asOf }).records[0].row.full_name, 'Changed by caller');
  assert.deepEqual(JSON.parse(JSON.stringify(buildDemoPlan({ asOf }))), buildDemoPlan({ asOf }));
});

test('all identities and row IDs are unique stable UUIDs with version and variant bits', () => {
  const plan = buildDemoPlan({ asOf });
  const ids = [...plan.accounts.map(account => account.id), ...plan.records.map(record => record.row.id)];
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const other = buildDemoPlan({ asOf: '2026-09-26' });
  assert.equal(plan.namespace, `trak-demo-v1-${asOf}`);
  assert.equal(other.accounts.some(account => ids.includes(account.id)), false);
  assert.equal(other.records.some(record => ids.includes(record.row.id)), false);
});

test('manifest has exactly two synthetic academies, four roles and the specified records', () => {
  const plan = buildDemoPlan({ asOf });
  assert.equal(plan.version, 1);
  assert.deepEqual(plan.counts, { accounts: 14, records: 62, tables: {
    profiles: 14, organizations: 2, coach_details: 2, player_details: 8,
    squad_players: 10, player_parent_links: 4, coach_sessions: 2,
    coach_calendar_events: 2, matches: 4, session_attendance: 4,
    coach_assessments: 8, recognition_awards: 2,
  } });
  assert.equal(plan.accounts.length, plan.counts.accounts);
  assert.equal(plan.records.length, plan.counts.records);
  for (const [table, count] of Object.entries(plan.counts.tables)) assert.equal(rows(plan, table).length, count);
  assert.deepEqual([...new Set(plan.accounts.map(account => account.role))].sort(), ['club', 'coach', 'parent', 'player']);
  assert.deepEqual(plan.scenarios.academies.map(academy => academy.country), ['AE', 'GR']);
  for (const account of plan.accounts) {
    assert.match(account.fullName, /^Synthetic /);
    assert.ok(account.email.endsWith(`@${plan.namespace}.test.invalid`));
    assert.equal('password' in account, false);
  }
  for (const row of rows(plan, 'organizations')) assert.match(row.name, /^Synthetic /);
});

test('all foreign references exist before the referencing row is applied', () => {
  const plan = buildDemoPlan({ asOf });
  const seen = new Map([['auth.users', new Set(plan.accounts.map(account => account.id))]]);
  const references = {
    user_id: 'auth.users', coach_user_id: 'auth.users', admin_user_id: 'auth.users',
    player_user_id: 'auth.users', parent_user_id: 'auth.users', linked_player_id: 'auth.users',
    logged_by: 'auth.users', organization_id: 'organizations',
    squad_player_id: 'squad_players', session_id: 'coach_sessions',
  };
  for (const { table, row } of plan.records) {
    for (const [column, target] of Object.entries(references)) {
      if (row[column] !== undefined && row[column] !== null) assert.ok(seen.get(target)?.has(row[column]), `${table}.${column} must reference an earlier ${target} row`);
    }
    if (!seen.has(table)) seen.set(table, new Set());
    seen.get(table).add(row.id);
  }
});

test('each parent has exactly the named adult and minor, with no cross-academy links', () => {
  const plan = buildDemoPlan({ asOf });
  for (const academy of plan.scenarios.academies) {
    const links = rows(plan, 'player_parent_links').filter(row => row.parent_user_id === academy.accounts.parent);
    assert.deepEqual(links.map(row => row.player_user_id), academy.parentChildIds);
    assert.deepEqual(academy.parentChildIds, [academy.accounts.adult1, academy.accounts.minor17]);
    for (const row of rows(plan, 'squad_players').filter(row => row.coach_user_id === academy.accounts.coach)) assert.equal(row.organization_id, academy.organizationId);
  }
});

test('minors and missing-age stubs have no development history or fabricated consent', () => {
  const plan = buildDemoPlan({ asOf });
  const blockedPlayers = new Set(plan.scenarios.academies.map(academy => academy.accounts.minor17));
  const blockedRoster = new Set(plan.scenarios.academies.flatMap(academy => [academy.roster.minor17, academy.roster.missingAge]));
  for (const { table, row } of plan.records) {
    assert.ok(!['parental_consents', 'parent_invites', 'coach_assessment_notes', 'telemetry_events', 'pilot_config'].includes(table));
    assert.ok(!/feedback|ai_|wellness|meeting/.test(table));
    if (table === 'matches') assert.ok(!blockedPlayers.has(row.user_id));
    if (['coach_assessments', 'recognition_awards', 'session_attendance'].includes(table)) assert.ok(!blockedRoster.has(row.squad_player_id));
  }
  for (const academy of plan.scenarios.academies) {
    const missing = rows(plan, 'squad_players').find(row => row.id === academy.roster.missingAge);
    assert.equal(missing.age, null);
    assert.equal(missing.linked_player_id, null);
  }
});

test('adult adoption retains two explicitly identified historical assessments on an unlinked stub', () => {
  const plan = buildDemoPlan({ asOf });
  for (const academy of plan.scenarios.academies) {
    const stub = rows(plan, 'squad_players').find(row => row.id === academy.roster.adoptionStub);
    const account = plan.accounts.find(account => account.id === academy.accounts.adoptionAdult);
    assert.equal(stub.player_name, account.fullName);
    assert.equal(stub.linked_player_id, null);
    const history = rows(plan, 'coach_assessments').filter(row => row.squad_player_id === stub.id);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map(row => row.id), academy.adoptionAssessmentIds);
    assert.ok(history.every(row => row.created_at < `${asOf}T00:00:00.000Z`));
    assert.ok(!rows(plan, 'squad_players').some(row => row.linked_player_id === account.id));
  }
});

test('birthdays stay calendar-valid on leap days and all adult identities remain at least twenty', () => {
  for (const date of ['2024-02-29', '2026-09-25', '2000-02-29', '2100-03-01']) {
    const plan = buildDemoPlan({ asOf: date });
    for (const academy of plan.scenarios.academies) {
      for (const key of ['adult1', 'adult2', 'adoptionAdult', 'minor17']) {
        const details = rows(plan, 'player_details').find(row => row.user_id === academy.accounts[key]);
        assert.equal(new Date(`${details.date_of_birth}T00:00:00.000Z`).toISOString().slice(0, 10), details.date_of_birth);
        if (key === 'minor17') assert.equal(age(details.date_of_birth, date), 17);
        else assert.ok(age(details.date_of_birth, date) >= 20);
      }
    }
  }
  const leap = buildDemoPlan({ asOf: '2024-02-29' });
  const minor = rows(leap, 'player_details').find(row => row.user_id === leap.scenarios.academies[0].accounts.minor17);
  assert.equal(minor.date_of_birth, '2007-02-28');
});

test('development histories are distinguishable and use current schema values', () => {
  const plan = buildDemoPlan({ asOf });
  for (const academy of plan.scenarios.academies) {
    const first = rows(plan, 'matches').find(row => row.user_id === academy.accounts.adult1);
    const second = rows(plan, 'matches').find(row => row.user_id === academy.accounts.adult2);
    assert.notEqual(first.opponent, second.opponent);
    assert.notEqual(first.computed_rating, second.computed_rating);
    assert.equal(first.logged_by, first.user_id);
    assert.equal(second.logged_by, second.user_id);
    for (const row of rows(plan, 'coach_assessments')) assert.equal('coach_rating' in row, false);
  }
  for (const award of rows(plan, 'recognition_awards')) assert.equal(award.award_type, 'player_of_week');
  for (const { row } of plan.records) assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
});

test('fixture labels support routed squad/match filters and valid rating inputs', () => {
  const plan = buildDemoPlan({ asOf });
  // CoachSquadPage compares full position names; CoachAddPlayer stores them.
  const positions = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'];
  for (const table of ['player_details', 'squad_players', 'matches']) {
    for (const row of rows(plan, table)) assert.ok(positions.includes(row.position), `${table}: ${row.position}`);
  }
  for (const academy of plan.scenarios.academies) {
    const squad = rows(plan, 'squad_players').filter(row => row.coach_user_id === academy.accounts.coach);
    assert.equal(squad.filter(row => row.position.toLowerCase() === 'goalkeeper').length, 1);
    assert.equal(squad.filter(row => row.position.toLowerCase() === 'midfielder').length, 4);
  }
  for (const match of rows(plan, 'matches')) {
    // Routed PlayerMatches uses title-case equality; rating-engine inputs use
    // lower-case body/self values. The persisted card uses the routed form label.
    assert.ok(['League', 'Cup', 'Friendly'].includes(match.competition));
    assert.ok(['Home', 'Away'].includes(match.venue));
    assert.ok(['None', 'Yellow', 'Red'].includes(match.card_received));
    assert.ok(['fresh', 'good', 'tired', 'knock'].includes(match.body_condition));
    assert.ok(['poor', 'average', 'good', 'excellent'].includes(match.self_rating));
  }
  for (const assessment of rows(plan, 'coach_assessments')) {
    assert.ok(['started', 'sub', 'training'].includes(assessment.appearance));
    assert.ok(['fair', 'generous', 'way off'].includes(assessment.flag));
  }
  for (const award of rows(plan, 'recognition_awards')) {
    assert.equal(award.award_type, 'player_of_week');
    assert.match(award.awarded_for, /^Synthetic demonstration week ending \d{4}-\d{2}-\d{2}$/);
  }
});

test('explicit calendar offsets preserve the academy wall time in summer and winter', () => {
  for (const date of ['2026-09-25', '2026-01-25']) {
    const plan = buildDemoPlan({ asOf: date });
    for (const academy of plan.scenarios.academies) {
      const calendar = rows(plan, 'coach_calendar_events').find(row => row.coach_user_id === academy.accounts.coach);
      assert.match(calendar.starts_at, /T18:00:00\+0[234]:00$/);
      const wallTime = new Intl.DateTimeFormat('en-GB', { timeZone: academy.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(calendar.starts_at));
      assert.equal(wallTime, '18:00');
    }
  }
});

test('entire serialized plan is identical across device time zones', () => {
  const moduleUrl = new URL('./plan.mjs', import.meta.url).href;
  const script = `import {buildDemoPlan} from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(buildDemoPlan({asOf:'2024-02-29'})));`;
  const expected = JSON.stringify(buildDemoPlan({ asOf: '2024-02-29' }));
  for (const TZ of ['UTC', 'Asia/Dubai', 'Europe/Athens', 'America/New_York']) {
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { TZ }, encoding: 'utf8' }), expected);
  }
});
