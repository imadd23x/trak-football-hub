#!/usr/bin/env node
// TRAK-16 (G5) / TRAK-11 (J3): correct a wrong roster email, recording who,
// when and why (public.correct_roster_email, service role only).
// Spec: docs/superpowers/specs/2026-10-01-roster-email-correction-design.md
//
//   node scripts/correct-roster-email.mjs --roster-child <uuid> --kind guardian|child \
//     --old <address> --new <address> --by <your name> --reason <why> [--apply]
//
// Without --apply it only reads the roster and says what would happen. With
// --apply it corrects the address in one transaction. Either way it needs
// SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_…) and TRAK_CONFIRM_HOST set to
// the host of SUPABASE_URL. It sends nothing and never prints an address: the
// re-invite is a separate step. An address someone has already claimed is
// refused; that is an incident for the founders, not a correction.

import { pathToFileURL } from 'node:url';
import { operatorKey } from './load-roster.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalize = (s) => String(s ?? '').trim().toLowerCase();
const FLAGS = { '--roster-child': 'rosterChild', '--kind': 'kind', '--old': 'old', '--new': 'new', '--by': 'by', '--reason': 'reason' };

export function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') out.apply = true;
    else if (FLAGS[argv[i]]) out[FLAGS[argv[i]]] = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!UUID.test(out.rosterChild ?? '')) throw new Error('--roster-child must be the roster child id (a uuid)');
  if (!['guardian', 'child'].includes(out.kind)) throw new Error('--kind must be guardian or child');
  if (!EMAIL.test(normalize(out.old))) throw new Error('--old must be an email address');
  if (!EMAIL.test(normalize(out.new))) throw new Error('--new must be an email address');
  if (normalize(out.old) === normalize(out.new)) throw new Error('--new is the same address as --old');
  if (!String(out.by ?? '').trim()) throw new Error('--by (who is correcting) is required');
  if (!String(out.reason ?? '').trim()) throw new Error('--reason is required');
  return out;
}

/** The dry run: what correct_roster_email() would do with this roster row. */
export function describeTarget(row, kind, oldEmail) {
  const old = normalize(oldEmail);
  if (!row) return { status: 'not_on_roster', wasInvited: false };
  if (kind === 'child') {
    if (row.child_email == null) return { status: 'no_child_email', wasInvited: false };
    if (row.child_email !== old) return { status: 'not_on_roster', wasInvited: false };
    if (row.player_user_id) return { status: 'already_claimed', wasInvited: false };
    return { status: 'ready', wasInvited: row.invited_at != null };
  }
  const g = (row.roster_guardians ?? []).find((x) => x.email === old);
  if (!g) return { status: 'not_on_roster', wasInvited: false };
  if (g.parent_user_id) return { status: 'already_claimed', wasInvited: false };
  return { status: 'ready', wasInvited: g.invited_at != null };
}

/** What to print. Ids and outcomes only: never an address. */
export function report({ apply, rosterChild, kind, status, wasInvited, auditId }) {
  const who = `the ${kind} address on roster child ${rosterChild}`;
  if (status === 'already_claimed') {
    return [`[correct-roster-email] Refused: someone has already signed up with ${who}. This is an incident for the founders, not a correction.`];
  }
  if (status !== 'ready') return [`[correct-roster-email] Refused: ${status} (${who}).`];
  const lines = [apply
    ? `[correct-roster-email] Corrected ${who}; audit row ${auditId}.`
    : `[correct-roster-email] Dry run: would correct ${who}. Re-run with --apply to write it.`];
  if (wasInvited) lines.push('[correct-roster-email] An invitation had already gone to the old address: log a G5 near-miss on TRAK-16 (no addresses).');
  if (apply) lines.push(`[correct-roster-email] Next: re-invite roster child ${rosterChild}; nothing was sent.`);
  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = operatorKey(process.env);
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is required');
  const host = new URL(url).host;
  if (process.env.TRAK_CONFIRM_HOST !== host) {
    throw new Error(`Set TRAK_CONFIRM_HOST=${host} to confirm this is the project you mean to change`);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: row, error } = await admin.from('roster_children')
    .select('child_email, player_user_id, invited_at, roster_guardians(email, parent_user_id, invited_at)')
    .eq('id', args.rosterChild).maybeSingle();
  if (error) throw new Error(`Could not read the roster: ${error.message}`);
  const target = describeTarget(row, args.kind, args.old);
  let auditId;
  if (args.apply && target.status === 'ready') {
    const { data, error: fixError } = await admin.rpc('correct_roster_email', {
      p_roster_child_id: args.rosterChild, p_kind: args.kind, p_old_email: args.old, p_new_email: args.new,
      p_corrected_by: args.by, p_reason: args.reason,
    });
    // The database re-checks everything under a lock; its refusal reason never holds an address.
    if (fixError) throw new Error(`Refused by the database: ${fixError.message}`);
    auditId = data;
  }
  for (const line of report({ ...args, ...target, auditId })) console.log(line);
  if (target.status !== 'ready') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(`[correct-roster-email] ${e.message}`); process.exitCode = 1; });
}
