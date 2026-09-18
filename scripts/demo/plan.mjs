import { createHash } from 'node:crypto';

/**
 * Pure synthetic fixture plan: no clock, credentials, network or database writes.
 * Accounts are identity specifications, not working Supabase Auth credentials.
 * Direct parent links and historical unlinked-adult assessments are service-only
 * fixture setup, not evidence of invitation, consent or authorization enforcement.
 */

const DAY = 86_400_000;
const academies = [
  { country: 'AE', label: 'UAE', timeZone: 'Asia/Dubai' },
  { country: 'GR', label: 'Greece', timeZone: 'Europe/Athens' },
];
const accountDefinitions = [
  ['admin', 'club', 'Administrator'], ['coach', 'coach', 'Coach'],
  ['parent', 'parent', 'Parent'], ['adult1', 'player', 'Adult One'],
  ['adult2', 'player', 'Adult Two'], ['minor17', 'player', 'Pending Minor'],
  ['adoptionAdult', 'player', 'Adoption Adult'],
];

function calendarDate(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('asOf must be an exact YYYY-MM-DD calendar date');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('asOf must be a valid calendar date');
  }
  // Bound fixture dates to modern time-zone offsets and four-digit years for
  // the surrounding history/upcoming events, while retaining century leap cases.
  if (value < '2000-01-01' || value > '2100-12-31') {
    throw new RangeError('asOf must be between 2000-01-01 and 2100-12-31');
  }
  return date;
}

function uuid(namespace, key) {
  const bytes = createHash('sha256').update(`${namespace}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function birthday(asOf, years) {
  const year = Number(asOf.slice(0, 4)) - years;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDay = asOf.slice(5) === '02-29' && !leap ? '02-28' : asOf.slice(5);
  return `${String(year).padStart(4, '0')}-${monthDay}`;
}

function localTimestamp(date, time, timeZone) {
  // Explicit supplied instant: the host's clock/time zone is never consulted.
  // Noon is after either Athens DST transition; both fixtures use evening times.
  const part = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00.000Z`)).find(value => value.type === 'timeZoneName');
  const offset = part?.value.replace('GMT', '');
  if (!/^\+0[234]:00$/.test(offset ?? '')) throw new Error(`Unsupported fixture offset for ${timeZone}`);
  return `${date}T${time}:00${offset}`;
}

/** @param {{asOf: string}} options */
export function buildDemoPlan({ asOf } = {}) {
  const anchor = calendarDate(asOf);
  const namespace = `trak-demo-v1-${asOf}`;
  const accounts = [], records = [], scenarios = { academies: [] };
  const id = key => uuid(namespace, key);
  const day = offset => new Date(anchor.getTime() + offset * DAY).toISOString().slice(0, 10);
  const timestamp = (offset, hour = '00') => `${day(offset)}T${hour}:00:00.000Z`;
  const createdAt = timestamp(-30);
  const add = (table, key, row) => {
    const record = { table, row: { id: id(`${table}:${key}`), created_at: createdAt, ...row } };
    records.push(record);
    return record.row.id;
  };

  for (const academy of academies) {
    const key = academy.country.toLowerCase();
    const accountIds = {}, names = {};
    for (const [alias, role, label] of accountDefinitions) {
      const accountId = id(`account:${key}:${alias}`);
      const fullName = `Synthetic ${academy.label} ${label}`;
      accounts.push({ id: accountId, email: `${key}.${alias.toLowerCase()}@${namespace}.test.invalid`, role, fullName });
      accountIds[alias] = accountId;
      names[alias] = fullName;
      add('profiles', `${key}:${alias}`, {
        user_id: accountId, role, full_name: fullName,
        ...(alias === 'coach' ? { invite_code: `SYN-${academy.country}-${id(`code:${key}:coach`).slice(0, 8).toUpperCase()}` } : {}),
      });
    }
    const academyName = `Synthetic ${academy.label} Academy`;
    const organizationId = add('organizations', key, {
      admin_user_id: accountIds.admin, name: academyName,
      join_code: `SYN-${academy.country}-${id(`code:${key}:organization`).slice(0, 8).toUpperCase()}`,
    });
    add('coach_details', key, {
      user_id: accountIds.coach, organization_id: organizationId,
      current_club: academyName, team: 'Synthetic Demonstration Squad', coach_role: 'Head Coach',
    });
    const ages = { adult1: 24, adult2: 22, minor17: 17, adoptionAdult: 25 };
    for (const [alias, years] of Object.entries(ages)) {
      add('player_details', `${key}:${alias}`, {
        user_id: accountIds[alias], date_of_birth: birthday(asOf, years),
        position: alias === 'adult2' ? 'Goalkeeper' : 'Midfielder', current_club: academyName,
        age_group: years < 18 ? 'U18' : 'Adult', shirt_number: { adult1: 8, adult2: 1, minor17: 17, adoptionAdult: 12 }[alias],
      });
    }
    const roster = {};
    for (const alias of ['adult1', 'adult2', 'minor17', 'adoptionStub', 'missingAge']) {
      const playerAlias = alias === 'adoptionStub' ? 'adoptionAdult' : alias;
      const linked = ['adult1', 'adult2', 'minor17'].includes(alias);
      roster[alias] = add('squad_players', `${key}:${alias}`, {
        coach_user_id: accountIds.coach, organization_id: organizationId,
        player_name: names[playerAlias] ?? `Synthetic ${academy.label} Missing Age`,
        linked_player_id: linked ? accountIds[alias] : null,
        age: ages[playerAlias] ?? null, age_group: alias === 'missingAge' ? null : (alias === 'minor17' ? 'U18' : 'Adult'),
        position: alias === 'adult2' ? 'Goalkeeper' : 'Midfielder', status: 'active',
      });
    }
    const parentChildIds = [accountIds.adult1, accountIds.minor17];
    for (const alias of ['adult1', 'minor17']) add('player_parent_links', `${key}:${alias}`, {
      parent_user_id: accountIds.parent, player_user_id: accountIds[alias],
    });
    const sessionId = add('coach_sessions', key, {
      coach_user_id: accountIds.coach, session_type: 'match', title: `Synthetic ${academy.label} Demonstration Match`,
      session_date: day(-2), competition: 'Friendly', venue: 'Home', created_at: timestamp(-2, '19'),
    });
    add('coach_calendar_events', key, {
      coach_user_id: accountIds.coach, title: `Synthetic ${academy.label} Upcoming Training`,
      event_type: 'training', starts_at: localTimestamp(day(2), '18:00', academy.timeZone),
      ends_at: localTimestamp(day(2), '19:30', academy.timeZone),
      venue: `Synthetic ${academy.label} Pitch`, published: true, source: 'manual', updated_at: createdAt,
    });
    for (const [index, alias] of ['adult1', 'adult2'].entries()) {
      add('matches', `${key}:${alias}`, {
        user_id: accountIds[alias], position: index === 0 ? 'Midfielder' : 'Goalkeeper', competition: 'Friendly',
        venue: index === 0 ? 'Home' : 'Away', age_group: 'Adult',
        opponent: `Synthetic ${academy.label} ${index === 0 ? 'Orange' : 'Blue'} Team`,
        team_score: index === 0 ? 3 : 0, opponent_score: index === 0 ? 1 : 2,
        minutes_played: index === 0 ? 90 : 60, goals: index === 0 ? 1 : 0, assists: index === 0 ? 2 : 0,
        card_received: 'None', body_condition: 'good', self_rating: index === 0 ? 'good' : 'average',
        computed_rating: index === 0 ? 8.1 : 5.2, match_date: day(-2),
        logged_by: accountIds[alias], logged_by_role: 'player', created_at: timestamp(-2, '20'),
      });
      add('session_attendance', `${key}:${alias}`, {
        session_id: sessionId, squad_player_id: roster[alias], status: 'present',
        minutes_played: index === 0 ? 90 : 60, created_at: timestamp(-2, '19'),
      });
    }
    const adoptionAssessmentIds = [];
    for (const [alias, daysBefore, score] of [
      ['adult1', 1, 8], ['adult2', 1, 5], ['adoptionStub', 14, 6], ['adoptionStub', 7, 7],
    ]) {
      const assessmentId = add('coach_assessments', `${key}:${alias}:${daysBefore}`, {
        coach_user_id: accountIds.coach, squad_player_id: roster[alias],
        session_id: alias === 'adoptionStub' ? null : sessionId, organization_id: organizationId,
        coach_name_snapshot: names.coach, appearance: 'started', flag: 'fair',
        work_rate: score, tactical: score, attitude: score, technical: score, physical: score, coachability: score,
        consistency: score, impact: score, workrate: score, technique: score, spirit: score,
        created_at: timestamp(-daysBefore, '12'),
      });
      if (alias === 'adoptionStub') adoptionAssessmentIds.push(assessmentId);
    }
    add('recognition_awards', key, {
      coach_user_id: accountIds.coach, squad_player_id: roster.adult1, organization_id: organizationId,
      coach_name_snapshot: names.coach, award_type: 'player_of_week',
      awarded_for: `Synthetic demonstration week ending ${asOf}`, created_at: timestamp(-1, '13'),
    });
    scenarios.academies.push({ country: academy.country, timeZone: academy.timeZone, organizationId,
      accounts: accountIds, roster, sessionId, adoptionAssessmentIds, parentChildIds });
  }
  const tables = {};
  for (const { table } of records) tables[table] = (tables[table] ?? 0) + 1;
  return { version: 1, namespace, asOf, accounts, records, scenarios,
    counts: { accounts: accounts.length, records: records.length, tables } };
}
