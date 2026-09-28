#!/usr/bin/env node
// TRAK-89: move the rehearsal accounts off @rehearsal.trak.dev, a domain we
// don't own (its owner could turn mail on and receive our password resets),
// to @rehearsal.trakfootball.com, which is ours and accepts no mail.
//
//   node scripts/rename-rehearsal-emails.mjs            dry run: counts only
//   node scripts/rename-rehearsal-emails.mjs --apply    changes the accounts
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (listing and changing
// accounts is admin-only). --apply also needs TRAK_CONFIRM_HOST set to the
// host of SUPABASE_URL, as load-roster.mjs does.
//
// Each account changes through the Auth admin API, with email_confirm so no
// mail is sent. The id, password, profile and every record stay the same. An
// account already moved is skipped, so a re-run is safe. The first error stops
// the run with everything before it done.
//
// Run it only after migration 20260928110000 is live: J7 must already count
// the new domain as synthetic.
import { pathToFileURL } from 'node:url';

const OLD = '@rehearsal.trak.dev';
const NEW = '@rehearsal.trakfootball.com';

/** The new address for a rehearsal account, or null for any other account. */
export function renamed(email) {
  const e = String(email ?? '').trim().toLowerCase();
  return e.endsWith(OLD) && e.length > OLD.length ? e.slice(0, -OLD.length) + NEW : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const host = new URL(url).host;
  if (apply && process.env.TRAK_CONFIRM_HOST !== host) {
    throw new Error(`Set TRAK_CONFIRM_HOST=${host} to confirm which project --apply changes`);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const taken = new Set(users.map(u => String(u.email ?? '').toLowerCase()));
  const moves = users.flatMap(u => (renamed(u.email) ? [{ id: u.id, email: renamed(u.email) }] : []));
  const clash = moves.filter(m => taken.has(m.email));
  const already = users.filter(u => String(u.email ?? '').toLowerCase().endsWith(NEW)).length;
  console.log(`${host}: ${users.length} accounts, ${moves.length} to move, ${already} already at ${NEW}`);
  if (clash.length) throw new Error(`${clash.length} new address(es) already exist; nothing changed`);
  if (!apply) { console.log('Dry run: nothing changed. Add --apply to move them.'); return; }

  let done = 0;
  for (const m of moves) {
    const { error } = await admin.auth.admin.updateUserById(m.id, { email: m.email, email_confirm: true });
    if (error) throw new Error(`Stopped after ${done} of ${moves.length}: ${error.message}`);
    done++;
  }
  console.log(`Moved ${done} of ${moves.length}. Run again to confirm 0 left to move.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(error.message ?? error); process.exit(1); });
}
