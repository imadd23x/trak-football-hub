# Migration version collision: #68 and #44

## Scope and acceptance

#68 at `2e34188` and #44 at `a9211cb`, against main `fc09ee4`, both added
version `20260919170000`. The combined tree had 73 files but only 72 versions.
The replay runner executed both files without modelling Supabase's migration
history primary key. This allowed green SQL tests for an invalid deployment.

Acceptance: reject duplicate versions and malformed/conflict filenames before
creating the test database or filtering migrations; retain successful ordered
replay for unique versions; prove the combined fresh install and main → #68 →
#44 upgrade. No application or schema behaviour changes beyond #68's existing
grant correction.

## Change

- Supabase CLI 2.117.0 generated `20260919193112_deny_policies_grant_nothing.sql`.
  The replacement is byte-identical to #68's SQL. Its previous version was not
  on main or in production migration history when renamed. No deployed file
  or production history entry was edited.
- `scripts/migration-input.mjs` checks names and unique versions. The database
  runner invokes it on the complete directory before executing any SQL.
- `src/__tests__/migration-input.test.ts` invokes the real runner in disposable
  fixture directories, using both the actual colliding names and a positive
  control that creates, populates and checks a table in migration order.

## Observed verification — September 19, 2026

Before the guard, the duplicate-file test exited 0; baseline mode hid the
duplicate by filtering it out; a preceding SQL statement ran before an invalid
conflict filename was noticed. Three regression assertions failed and the
valid-input control passed. After the guard all four tests passed.

Supabase CLI `db push --db-url <disposable-loopback-database> --include-all
--skip-vault --yes`, against native PostgreSQL 17.11:

1. Two same-version files failed with SQLSTATE `23505`,
   `schema_migrations_pkey`, after the first history row was inserted.
2. Main applied 65 migrations; corrected #68 raised the history count to 66;
   adding #44's older pending files raised it to 73 unique applied versions.
3. All six SQL suites passed: parent invitations, operational views, privilege
   and consent security, coach-note privacy, organisation cleanup, account export.
4. The disposable server was stopped after verification. No production URL,
   account, credential or data was used by this test.

Additional checks:

- #68: 357 source tests, 17 harness tests, typecheck and build passed.
- #68: 66-migration fresh and parent-upgrade replays passed all three suites.
- #68 + #44: 73-migration fresh and parent-upgrade replays passed all six suites;
  284 operational assertions; 449 source tests passed, 9 skipped; typecheck passed.
- Lint: zero errors, 134 existing warnings. Changed files have no lint findings.
- `uc:check` exited 0 for the enforced cases; three existing pending UC-A02
  athlete match-logging assertions failed and 15 pending cases had no tests.
  These are not evidence of whole-platform readiness.

## Integration and rollout

Independent review must cover the revised #68 head. Deploy #68, verify its
production workflow/history/grants, then integrate #44. Its `20260919170000`
file keeps its existing name. Supabase's deployment uses `--include-all` for
pending migrations older than the most recently deployed version.

#42 retains its suite registry but should reuse this input validator instead
of retaining a second duplicate-version loop. #65's separate filename check
is covered here; keep its documentation and gitignore changes when resolving
that runner overlap. The entry-point tests retain suite pragmas in their
fixtures to support #42's registry.

Before deployment, rollback is reverting this branch update. After deployment,
do not rename an applied migration, rewrite history, or restore the duplicate
version; fix any new defect with a separately reviewed forward change.

Native execution log for this session:
`/private/tmp/trak-migration-history-verification.log`.
Production deployment and four-role live journeys remain unverified by this change.
