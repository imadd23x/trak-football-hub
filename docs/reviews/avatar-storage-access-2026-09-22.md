# Avatar Storage access and owner deletion

A hosted synthetic probe on21September2026 reproduced two defects on source
9324361: anonymous users could list a private-bucket avatar, mint a signed URL
and fetch its exact bytes; the owning user's remove returned200 with an empty
array and left the object intact. The test used one69-byte inert PNG in the
dedicated test project. No production object was accessed.

## Change and acceptance

Migration `20260921211039_restrict_anonymous_avatar_reads_and_fix_owner_delete.sql`
replaces the avatar SELECT policy's PUBLIC audience with authenticated, keeping
its existing bucket scope. The DELETE policy now accepts either the uploader's
bare UUID key used by Settings or the prior own-folder format. INSERT and UPDATE
ownership rules, bucket settings and profile URLs are unchanged.

Acceptance is: anonymous listing/exact-object reads expose no avatar row; an
authenticated owner can insert, upsert, read and delete the bare UUID object;
the owner can still delete their legacy folder object; unrelated users cannot
delete either format; another bucket stays closed.

Authenticated users retain their existing read audience, including unrelated
users. This is a compatibility choice for this repair, not an assertion that
this audience is the final privacy design. April's migration explicitly
described coach/parent/passport visibility, while later signed-URL work did not
define a narrower role/relationship rule. A separate documented product decision
is needed before restricting that audience.

## Focused verification

The new auto-registered `supabase/tests/avatar_storage_security.sql` runs in
`npm run test:db` and can be selected with:

```sh
node scripts/test-db.mjs --avatar-storage-review
```

The suite supplies managed Storage schema/table grants and bucket/name uniqueness
inside a rolled-back disposable transaction. It exercises real migration RLS,
rather than passing because the minimal platform bootstrap omitted a privilege.
Its ON CONFLICT UPDATE changes the fixture row ID so the replacement path is
observable. It does not emulate Storage HTTP, object blobs or CDN behavior.

- Before the fix, PGlite and native PostgreSQL17 each fail four assertions:
  anonymous listing/exact lookup, own bare-key removal and privileged absence.
- After the fix,19/19 assertions pass in both engines.
- Four independent native policy mutations are caught: SELECT TO public,
  folder-only DELETE, bucket-wide DELETE and bare-key-only DELETE.
- Reapplying the migration on native PostgreSQL preserves19/19 passes.
- All90 pre-existing migration files are byte-identical to9324361; this is the
  only forward migration.

All23 current CI checks passed, including852 unit tests (9 skipped),
all database/replay/convergence/concurrency checks, staff admission controls,
typecheck, lint, build and bundle check. The new suite is present in the default
database-security run. Native Supabase security advisors against the explicitly
owned Unix-socket database reported no issues; no hosted advisor run was used.
The built pilot browser suite passed20/20 and the separate default browser
smoke/network suite passed11/11. Both used guarded synthetic requests; no hosted
Auth, Storage or production action was part of these browser tests.
Local evidence lives in `artifacts/2026-09-22-avatar-storage-policy` at the
workspace root; the native evidence runner is included there. The original
hosted reproduction is in
`artifacts/2026-09-21-test-project-setup/avatar-storage-results.json`.

## Rollout and follow-up verification

Apply the reviewed migration to the isolated test project first. Reuse only the
exact inert fixture identified by the private receipt: confirm its bytes,
verify anonymous signing/listing denial, verify owner and foreign authenticated
read compatibility, then remove it as its owner and verify actual absence.
Do not create a replacement fixture over an existing avatar or mutate a profile.
The source-only policy tests are not proof of the deployed Storage API.

Production deployment requires its normal review/deployment gate and separate
authorization. No production migration, object mutation or setting change has
been made by this implementation.

Already-issued signed URLs are bearer capabilities until expiry; changing
SELECT does not retract them. The probe used60-second URLs. Account deletion
still invokes only the SQL account RPC and has no Storage cleanup call; fixing
owner DELETE does not complete U10 or establish a retained-data policy.

If a compatibility problem appears, ship a new reviewed forward migration.
Preserve anonymous denial and owner-only deletion while repairing the specific
authorized path; do not edit historical migration files or reopen PUBLIC reads
as an automatic rollback.
