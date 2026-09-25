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
// date_of_birth is YYYY-MM-DD. guardian_emails holds every guardian the
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
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cell = (c) => String(table[i][at[c]] ?? '').trim();
    const problems = [];

    const child_name = cell('child_name');
    const date_of_birth = cell('date_of_birth');
    const child_email = normalizeEmail(cell('child_email'));
    const coach_email = normalizeEmail(cell('coach_email'));
    const guardian_emails = [...new Set(cell('guardian_emails').split(';').map(normalizeEmail).filter(Boolean))];

    if (!child_name) problems.push('child_name is empty');
    if (!isRealDate(date_of_birth)) problems.push('date_of_birth is not a real YYYY-MM-DD date');
    else if (date_of_birth > today || date_of_birth <= '1990-01-01') problems.push('date_of_birth is out of range');
    if (!EMAIL.test(child_email)) problems.push('child_email is not an email address');
    if (!EMAIL.test(coach_email)) problems.push('coach_email is not an email address');
    if (guardian_emails.length === 0) problems.push('no guardian email');
    if (guardian_emails.some(g => !EMAIL.test(g))) problems.push('a guardian email is not an email address');
    if (guardian_emails.includes(child_email)) problems.push('the child\'s email is also listed as a guardian\'s');
    if (child_email && childLine.has(child_email)) problems.push(`same child_email as line ${childLine.get(child_email)}`);

    if (problems.length) { errors.push(`Line ${line}: ${problems.join('; ')}`); continue; }
    childLine.set(child_email, line);
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
    if (!academyOf.has(r.child_email)) toLoad.push(r);
    else if (academyOf.get(r.child_email) === org) skipped.push(r.line);
    else conflicts.push(r.line);
  }
  return { toLoad, skipped, conflicts };
}

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (['--file', '--org', '--loaded-by'].includes(a)) out[a.slice(2)] = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args['loaded-by'] || !UUID.test(args.org ?? '')) {
    throw new Error('Usage: --file <roster.csv> --org <academy uuid> --loaded-by <name> [--apply]');
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
  if (!args.apply) {
    console.log('[load-roster] Dry run. Re-run with --apply to load.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required with --apply');
  const host = new URL(url).host;
  if (process.env.TRAK_CONFIRM_HOST !== host) {
    throw new Error(`Set TRAK_CONFIRM_HOST=${host} to confirm this is the project you mean to load into`);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
    .in('child_email', rows.map(r => r.child_email));
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

  let loaded = 0;
  for (const r of toLoad) {
    const { error } = await admin.rpc('admit_roster_child', {
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
    if (error) {
      // Rows before this one are admitted, each whole. A re-run skips them.
      console.log(`[load-roster] Line ${r.line} refused (${error.code ?? 'error'}): ${error.message}`);
      console.log(`[load-roster] Stopped. ${loaded} child(ren) admitted before line ${r.line}. Fix that line and run the same file again; admitted children are skipped.`);
      process.exitCode = 1;
      return;
    }
    loaded++;
  }
  console.log(`[load-roster] Admitted ${loaded} child(ren) into ${args.org}; ${skipped.length} already admitted.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(`[load-roster] ${e.message}`); process.exitCode = 1; });
}
