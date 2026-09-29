#!/usr/bin/env node
// TRAK-49 [J1]: load an academy's roster by hand (concierge admission).
//
//   node scripts/load-roster.mjs --file roster.csv --org <academy uuid> --loaded-by <your name>
//   node scripts/load-roster.mjs ... --apply        (writes; see "Applying" below)
//
// The CSV has a header row with these columns, in any order:
//
//   child_name, date_of_birth, age_group, child_email, guardian_emails, coach_email
//
// date_of_birth is YYYY-MM-DD. child_email may be blank for a child who has
// none (TRAK-84): their guardian creates the login after consenting.
// guardian_emails holds every guardian the
// academy supplied, separated by ";". Quote a field that contains a comma.
//
// Without --apply this is a dry run: it validates every row and reports what
// it would load, touching nothing. It never prints names, emails or dates of
// birth, only row numbers and counts, so its output can be pasted into a
// Linear issue without putting child data there.
//
// Applying needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and
// TRAK_CONFIRM_HOST set to the host of SUPABASE_URL, so a key left in the
// shell cannot load into the wrong project by accident. Each child is one
// call to admit_roster_child(), which admits the child, the squad row and
// every guardian together or not at all. The database repeats every check
// made here; this file exists to catch a bad file before anything is written.
//
// A validation problem loads nothing. A refusal from the database stops the
// load at that line, with every earlier child already admitted, each whole.
// Fix the line and run the same file again: children already admitted to
// this academy are skipped by child_email and the rest load. A re-run never
// changes a child who is already admitted.
//
// Invitations (TRAK-11 phase 3): with --send-invites, right after each child is
// admitted, the send-roster-invites function emails that child's guardians an
// invitation to sign up. A skipped row is never invited, so a resumed load
// never re-sends. A failed send doesn't undo or stop the admission; it is
// printed by line, and the operator re-invites that child later with
// --reinvite (TRAK-91): the same file again, which loads nothing and re-sends
// only where a guardian was never invited and hasn't signed up. Without
// --apply it only says which lines it would re-invite (it still needs the key
// to read the roster).
//
//   node scripts/load-roster.mjs ... --reinvite            (read-only: what would go)
//   node scripts/load-roster.mjs ... --reinvite --apply    (sends them)
// Without --send-invites nobody is emailed (--no-invites says so explicitly).
// Invitations stay opt-in until phase 4's landing pages exist: until then the
// link lands on a page that can't finish signup. Never send for a practice,
// rehearsal or synthetic load.
// The key must be the project's legacy service_role JWT (the same value the
// edge function sees as SUPABASE_SERVICE_ROLE_KEY).
//
//   node scripts/load-roster.mjs ... --apply --send-invites

import { isSyntheticAddress } from './synthetic-domain.mjs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const COLUMNS = ['child_name', 'date_of_birth', 'age_group', 'child_email', 'guardian_emails', 'coach_email'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeEmail = (s) => String(s ?? '').trim().toLowerCase();

// RFC 4180 enough for a roster: quoted fields, doubled quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validates the whole file. Returns the rows ready to load and every problem
// found, each naming its CSV line (the header is line 1) and never the data.
export function validateRoster(text, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const table = parseCsv(text.replace(/^﻿/, ''));
  const errors = [];
  if (table.length === 0) return { rows: [], errors: ['The file is empty'] };

  const header = table[0].map(h => h.trim().toLowerCase());
  const missing = COLUMNS.filter(c => !header.includes(c));
  if (missing.length) return { rows: [], errors: [`Missing column(s): ${missing.join(', ')}`] };
  const at = Object.fromEntries(COLUMNS.map(c => [c, header.indexOf(c)]));

  const rows = [];
  const childLine = new Map();
  // Without an email, the name and date of birth identify a child in the file.
  const noEmailLine = new Map();
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cell = (c) => String(table[i][at[c]] ?? '').trim();
    const problems = [];

    const child_name = cell('child_name');
    const date_of_birth = cell('date_of_birth');
    const child_email = normalizeEmail(cell('child_email')) || null;
    const coach_email = normalizeEmail(cell('coach_email'));
    const guardian_emails = [...new Set(cell('guardian_emails').split(';').map(normalizeEmail).filter(Boolean))];

    if (!child_name) problems.push('child_name is empty');
    if (!isRealDate(date_of_birth)) problems.push('date_of_birth is not a real YYYY-MM-DD date');
    else if (date_of_birth > today || date_of_birth <= '1990-01-01') problems.push('date_of_birth is out of range');
    if (child_email && !EMAIL.test(child_email)) problems.push('child_email is not an email address');
    if (!EMAIL.test(coach_email)) problems.push('coach_email is not an email address');
    if (guardian_emails.length === 0) problems.push('no guardian email');
    if (guardian_emails.some(g => !EMAIL.test(g))) problems.push('a guardian email is not an email address');
    if (child_email && guardian_emails.includes(child_email)) problems.push('the child\'s email is also listed as a guardian\'s');
    if (child_email && childLine.has(child_email)) problems.push(`same child_email as line ${childLine.get(child_email)}`);
    const person = `${child_name.toLowerCase()}|${date_of_birth}`;
    if (!child_email && noEmailLine.has(person)) problems.push(`same child (name and date of birth, no email) as line ${noEmailLine.get(person)}`);

    if (problems.length) { errors.push(`Line ${line}: ${problems.join('; ')}`); continue; }
    if (child_email) childLine.set(child_email, line);
    else noEmailLine.set(person, line);
    rows.push({ line, child_name, date_of_birth, age_group: cell('age_group'), child_email, guardian_emails, coach_email });
  }

  // A guardian address that is some other row's child address.
  for (const r of rows) {
    for (const g of r.guardian_emails) {
      if (childLine.has(g)) errors.push(`Line ${r.line}: a guardian email is the child_email on line ${childLine.get(g)}`);
    }
  }
  return { rows, errors };
}

// Splits validated rows into those still to load and those already admitted.
// admitted is [{ child_email, organization_id }] for the file's addresses. An
// address admitted to this academy is skipped, so a stopped load can resume.
// One admitted to another academy is a conflict: nothing loads.
export function planLoad(rows, admitted, org) {
  const academyOf = new Map(admitted.map(a => [normalizeEmail(a.child_email), a.organization_id]));
  const toLoad = [];
  const skipped = [];
  const conflicts = [];
  for (const r of rows) {
    // An email-less child is never in admitted, so it is always tried; the
    // database refuses a second copy (TRAK-84).
    if (!academyOf.has(r.child_email)) toLoad.push(r);
    else if (academyOf.get(r.child_email) === org) skipped.push(r.line);
    else conflicts.push(r.line);
  }
  return { toLoad, skipped, conflicts };
}

// Admits each row in order, then (unless invite is null) asks for that child's
// guardians to be invited. admit(row) resolves { data: rosterChildId, error };
// invite(rosterChildId) resolves true when every invitation went. A refused
// admission stops the load there; a failed invitation is only reported.
export async function loadRows(toLoad, { admit, invite }, log) {
  let loaded = 0;
  let invited = 0;
  const inviteFailed = [];
  const alreadyOnRoster = [];
  for (const r of toLoad) {
    const { data: rosterChildId, error } = await admit(r);
    // TRAK-84: a re-run meets an email-less child the academy already has.
    if (error && !r.child_email && error.code === '23505') { alreadyOnRoster.push(r.line); continue; }
    if (error) {
      // Rows before this one are admitted, each whole. A re-run skips them.
      log(`[load-roster] Line ${r.line} refused (${error.code ?? 'error'}): ${error.message}`);
      log(`[load-roster] Stopped. ${loaded} child(ren) admitted before line ${r.line}. Fix that line and run the same file again; admitted children are skipped.`);
      return { loaded, invited, inviteFailed, alreadyOnRoster, stoppedAt: r.line };
    }
    loaded++;
    if (!invite) continue;
    if (await invite(rosterChildId).catch(() => false)) invited++;
    else {
      inviteFailed.push(r.line);
      log(`[load-roster] Line ${r.line} admitted, but its invitation didn't go. Re-invite that child once the cause is fixed.`);
    }
  }
  return { loaded, invited, inviteFailed, alreadyOnRoster };
}

// TRAK-91: which rows of the file --reinvite asks to invite again. onRoster is
// this academy's roster children as { id, child_email, date_of_birth,
// player_name, guardians: [{ invited_at, parent_user_id }] }. A row is matched
// by child_email, or, without one, by name and date of birth (TRAK-84). It is
// re-invited only if a guardian was never invited and hasn't signed up, so a
// family that already has its email, or an account, is never sent another.
export function planReinvite(rows, onRoster) {
  const byEmail = new Map(onRoster.filter(c => c.child_email).map(c => [normalizeEmail(c.child_email), c]));
  const person = (name, dob) => `${String(name ?? '').trim().toLowerCase()}|${dob}`;
  const byPerson = new Map(onRoster.filter(c => !c.child_email).map(c => [person(c.player_name, c.date_of_birth), c]));
  const toInvite = [];
  const upToDate = [];
  const notOnRoster = [];
  const synthetic = [];
  for (const r of rows) {
    const child = r.child_email ? byEmail.get(r.child_email) : byPerson.get(person(r.child_name, r.date_of_birth));
    if (!child) notOnRoster.push(r.line);
    else if (!child.guardians.some(g => !g.invited_at && !g.parent_user_id)) upToDate.push(r.line);
    // send-roster-invites emails every stored guardian who hasn't signed up,
    // invited before or not. If one of them is on a reserved test domain, the
    // line is refused: a file corrected since the load doesn't change who is
    // stored (Imad, #202).
    else if (child.guardians.some(g => !g.parent_user_id && isSyntheticAddress(g.email))) synthetic.push(r.line);
    else toInvite.push({ line: r.line, rosterChildId: child.id });
  }
  return { toInvite, upToDate, notOnRoster, synthetic };
}

// TRAK-91 follow-up: the lines holding a reserved test address (the J7 rule),
// child or guardian. Such an address can't receive mail, so inviting it is an
// operator mistake (the synthetic TRAK-24 file with --send-invites, or
// --reinvite on it). main() refuses before anything is loaded or sent.
export function syntheticInviteLines(rows) {
  return rows.filter(r => [r.child_email, ...r.guardian_emails].filter(Boolean).some(isSyntheticAddress)).map(r => r.line);
}

// Sends each re-invitation in turn. A failure is reported by line and the rest
// still go; nothing is admitted or changed apart from the invitation itself.
export async function reinviteRows(toInvite, invite, log) {
  let invited = 0;
  const failed = [];
  for (const { line, rosterChildId } of toInvite) {
    if (await invite(rosterChildId).catch(() => false)) invited++;
    else {
      failed.push(line);
      log(`[load-roster] Line ${line}: the invitation didn't go again. Run --reinvite once more when the cause is fixed.`);
    }
  }
  return { invited, failed };
}

export function parseArgs(argv) {
  const out = { apply: false, 'send-invites': false, reinvite: false };
  let noInvites = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--send-invites') out['send-invites'] = true;
    else if (a === '--no-invites') noInvites = true;
    else if (a === '--reinvite') out.reinvite = true;
    else if (['--file', '--org', '--loaded-by'].includes(a)) out[a.slice(2)] = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (noInvites && out['send-invites']) throw new Error('Use either --send-invites or --no-invites, not both');
  if (out.reinvite && (noInvites || out['send-invites'])) {
    throw new Error('--reinvite sends invitations by itself and loads nothing; leave out --send-invites and --no-invites');
  }
  return out;
}

async function resolveCoaches(admin, emails) {
  const wanted = new Set(emails);
  const found = new Map();
  for (let page = 1; found.size < wanted.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    for (const u of data.users) {
      const e = normalizeEmail(u.email);
      if (wanted.has(e)) found.set(e, u.id);
    }
    if (data.users.length < 1000) break;
  }
  return found;
}

// TRAK-91: the recovery for invitations that never went. Reads this academy's
// roster, then (with --apply) re-sends only what planReinvite picks.
async function reinvite(admin, args, rows, sendInvite) {
  const { data, error } = await admin
    .from('roster_children')
    .select('id, child_email, date_of_birth, squad_players(player_name), roster_guardians(email, invited_at, parent_user_id)')
    .eq('organization_id', args.org);
  if (error) throw new Error(`Could not read the roster: ${error.message}`);
  const onRoster = (data ?? []).map(c => ({
    id: c.id,
    child_email: c.child_email,
    date_of_birth: c.date_of_birth,
    player_name: c.squad_players?.player_name ?? '',
    guardians: c.roster_guardians ?? [],
  }));
  const { toInvite, upToDate, notOnRoster, synthetic } = planReinvite(rows, onRoster);
  if (synthetic.length) {
    console.log(`[load-roster] Line(s) ${synthetic.join(', ')}: a stored guardian address is a reserved test address (e.g. .test); not invited. Correct it on the roster first.`);
  }
  if (notOnRoster.length) {
    console.log(`[load-roster] Line(s) ${notOnRoster.join(', ')} aren't on this academy's roster. --reinvite loads nothing: load them first.`);
  }
  if (upToDate.length) {
    console.log(`[load-roster] Line(s) ${upToDate.join(', ')}: every guardian is already invited or signed up; left alone.`);
  }
  if (!toInvite.length) {
    console.log('[load-roster] Nothing to re-invite.');
    return;
  }
  const lines = toInvite.map(t => t.line).join(', ');
  if (!args.apply) {
    console.log(`[load-roster] Dry run. Would re-invite the guardians on line(s) ${lines}. Re-run with --apply to send.`);
    return;
  }
  const { invited, failed } = await reinviteRows(toInvite, sendInvite, console.log);
  console.log(`[load-roster] Re-invitations went for ${invited} child(ren); ${failed.length ? `not for line(s) ${failed.join(', ')}` : 'none failed'}.`);
  if (failed.length) process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args['loaded-by'] || !UUID.test(args.org ?? '')) {
    throw new Error('Usage: --file <roster.csv> --org <academy uuid> --loaded-by <name> [--apply] [--send-invites | --reinvite]');
  }
  const { rows, errors } = validateRoster(await readFile(args.file, 'utf8'));
  const guardians = rows.reduce((n, r) => n + r.guardian_emails.length, 0);
  console.log(`[load-roster] ${rows.length} valid row(s), ${guardians} guardian address(es), ${errors.length} problem(s).`);
  for (const e of errors) console.log(`[load-roster] ${e}`);
  if (errors.length) {
    console.log('[load-roster] Nothing loaded. Fix the file and run again; a file with a problem loads nothing.');
    process.exitCode = 1;
    return;
  }
  if (args['send-invites'] || args.reinvite) {
    const synthetic = syntheticInviteLines(rows);
    if (synthetic.length) {
      console.log(`[load-roster] Line(s) ${synthetic.join(', ')} use a reserved test address (e.g. .test), which can't receive mail. Load them without --send-invites, and don't --reinvite them. Nothing loaded or sent.`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(args.reinvite
    ? '[load-roster] --reinvite: loads nothing; re-sends invitations only where a guardian was never invited and hasn\'t signed up.'
    : !args['send-invites']
      ? '[load-roster] Nobody will be emailed (add --send-invites to invite the guardians).'
      : `[load-roster] Loading will email up to ${guardians} guardian address(es) an invitation to sign up.`);
  // --reinvite reads the roster even without --apply, to say what it would send.
  if (!args.apply && !args.reinvite) {
    console.log('[load-roster] Dry run. Re-run with --apply to load.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required with --apply or --reinvite');
  const host = new URL(url).host;
  if (process.env.TRAK_CONFIRM_HOST !== host) {
    throw new Error(`Set TRAK_CONFIRM_HOST=${host} to confirm this is the project you mean to load into`);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sendInvite = async (rosterChildId) => {
    const res = await fetch(`${url.replace(/\/+$/, '')}/functions/v1/send-roster-invites`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roster_child_id: rosterChildId }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.failed === 0;
  };
  if (args.reinvite) {
    await reinvite(admin, args, rows, sendInvite);
    return;
  }

  const coaches = await resolveCoaches(admin, [...new Set(rows.map(r => r.coach_email))]);
  const unknown = rows.filter(r => !coaches.has(r.coach_email)).map(r => r.line);
  if (unknown.length) {
    console.log(`[load-roster] No account for the coach on line(s) ${unknown.join(', ')}. Nothing loaded.`);
    process.exitCode = 1;
    return;
  }

  const { data: admitted, error: admittedError } = await admin
    .from('roster_children')
    .select('child_email, organization_id')
    .in('child_email', rows.map(r => r.child_email).filter(Boolean));
  if (admittedError) throw new Error(`Could not check existing admissions: ${admittedError.message}`);
  const { toLoad, skipped, conflicts } = planLoad(rows, admitted, args.org);
  if (conflicts.length) {
    console.log(`[load-roster] The child on line(s) ${conflicts.join(', ')} is already admitted to another academy. Nothing loaded.`);
    process.exitCode = 1;
    return;
  }
  if (skipped.length) {
    console.log(`[load-roster] Line(s) ${skipped.join(', ')} already admitted to this academy; skipped, not changed.`);
  }

  const admit = (r) => admin.rpc('admit_roster_child', {
    p_organization_id: args.org,
    p_coach_user_id: coaches.get(r.coach_email),
    p_child_name: r.child_name,
    p_age_group: r.age_group,
    p_date_of_birth: r.date_of_birth,
    p_child_email: r.child_email,
    p_guardian_emails: r.guardian_emails,
    p_loaded_by: args['loaded-by'],
    p_source_file: args.file.split('/').pop(),
  });
  const invite = args['send-invites'] ? sendInvite : null;
  const { loaded, invited, inviteFailed, alreadyOnRoster, stoppedAt } = await loadRows(toLoad, { admit, invite }, console.log);
  if (stoppedAt) { process.exitCode = 1; return; }
  if (invite) console.log(`[load-roster] Invitations went for ${invited} child(ren); ${inviteFailed.length ? `not for line(s) ${inviteFailed.join(', ')}` : 'none failed'}.`);
  console.log(`[load-roster] Admitted ${loaded} child(ren) into ${args.org}; ${skipped.length + alreadyOnRoster.length} already admitted.`);
  if (inviteFailed.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(`[load-roster] ${e.message}`); process.exitCode = 1; });
}
