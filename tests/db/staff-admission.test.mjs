import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { validateMigrationFiles } from '../../scripts/migration-input.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = name => readFile(resolve(root, name), 'utf8');
const migration = '20260920111726_academy_staff_admission.sql';
const baselineFailures = ['direct coach academy reassignment', 'direct staff profile insert',
  'legacy public admin provisioning', 'legacy public coach provisioning', 'legacy shared code admission'];
const mutations = [
  ['recipient binding', "recipient IS NULL OR recipient<>invite.recipient_email", "recipient IS NULL", 'wrong recipient'],
  ['verified recipient', "WHERE id=actor AND email_confirmed_at IS NOT NULL", "WHERE id=actor", 'unverified recipient'],
  ['expiry', "OR invite.expires_at<=clock_timestamp()", "", 'expired token'],
  ['revocation', "invite.state<>'pending'", "false", 'revoked token'],
  ['staff guard', "IF trak_admission.maintenance() THEN", "IF true THEN", 'legacy public coach provisioning'],
  ['current membership on replay', "IF invite.state='accepted' AND invite.accepted_by=actor THEN",
    "IF invite.state='accepted' AND invite.accepted_by=actor THEN RETURN jsonb_build_object('replayed',true);", 'accepted link cannot restore departed coach'],
  ['academy authority', "o.id=p_org AND o.admin_user_id=p_issuer FOR SHARE", "o.id=p_org FOR SHARE", 'cross academy invite'],
];

const deliveryMigration = '20260920114801_staff_invitation_delivery.sql';
const deliveryMutations = [
  ['recipient-scoped inspection', 'OR actor_email<>invite.recipient_email', '', 'wrong recipient sees no activation details'],
  ['verified inspection', 'WHERE id=actor AND email_confirmed_at IS NOT NULL;', 'WHERE id=actor;', 'unverified recipient sees no activation details'],
  ['duplicate dispatch', "'dispatch',false,'delivery_state',invite.delivery_state", "'dispatch',true,'delivery_state',invite.delivery_state", 'duplicate claim never dispatches'],
  ['provider receipt binding', 'AND delivery_attempt_id=p_attempt_id FOR UPDATE', 'AND p_attempt_id IS NOT NULL FOR UPDATE', 'wrong receipt denied'],
  ['provider receipt privileges', 'public.finish_staff_invite_delivery(uuid,uuid,text) TO service_role;', 'public.finish_staff_invite_delivery(uuid,uuid,text) TO service_role,authenticated;', 'issuer cannot forge provider success'],
  ['daily email allowance', "AT TIME ZONE 'UTC'))>=50", "AT TIME ZONE 'UTC'))>=500", 'daily email allowance enforced'],
];

async function database(mode, targetMigration = migration) {
  const db = new PGlite();
  try {
    await db.exec(await read('supabase/tests/bootstrap.sql'));
    for (const file of validateMigrationFiles(await readdir(resolve(root, 'supabase/migrations')))) {
      if (mode === 'baseline' && file >= migration) continue;
      let sql = await read('supabase/migrations/' + file);
      if (file === targetMigration && Array.isArray(mode)) {
        assert.equal(sql.split(mode[1]).length, 2, 'mutation must target exactly one runtime expression');
        sql = sql.replace(mode[1], mode[2]);
      }
      await db.exec(sql);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}

test('baseline detects actual legacy admissions, not absent new RPCs', async () => {
  const db = await database('baseline');
  try {
    const prefix = (await read('supabase/tests/staff_admission.sql')).split('-- END LEGACY BYPASS PROBES')[0];
    await assert.rejects(db.exec(prefix + await read('supabase/tests/staff_admission_verdict.sql')), error => {
      assert.equal(error.message, 'Staff admission assertions failed');
      assert.deepEqual(error.detail.split('\n').sort(), baselineFailures.sort());
      return true;
    });
  } finally { await db.close(); }
});

for (const mutation of mutations) {
  test('runtime mutation is detected: ' + mutation[0], async () => {
    const db = await database(mutation);
    try {
      await assert.rejects(db.exec(await read('supabase/tests/staff_admission.sql')), error => {
        assert.equal(error.message, 'Staff admission assertions failed');
        assert.ok(error.detail.split('\n').includes(mutation[3]), error.detail);
        return true;
      });
    } finally { await db.close(); }
  });
}

for (const mutation of deliveryMutations) {
  test('delivery runtime mutation is detected: ' + mutation[0], async () => {
    const db = await database(mutation, deliveryMigration);
    try {
      await assert.rejects(db.exec(await read('supabase/tests/staff_delivery.sql')), error => {
        assert.equal(error.message, 'Staff admission assertions failed');
        assert.ok(error.detail.split('\n').includes(mutation[3]), error.detail);
        return true;
      });
    } finally { await db.close(); }
  });
}
