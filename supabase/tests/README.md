# Database security regressions

Run `npm run test:db`. The runner creates an in-memory PostgreSQL database using pinned PGlite, installs a small Auth/Storage boundary, replays every real app migration, and executes role-switched SQL assertions. It never accepts a remote connection string or reads production credentials.

The parent invitation suite checks wrong recipient/role, verified email from Auth rather than caller input, direct-table bypasses, token disclosure, two children, first-time provisioning, expiry, explicit resend, repeated acceptance and recycled email addresses. Backfill fixtures execute immediately before the P1 migration and verify old expiration windows, preservation of accepted links, and removal of explicit column write grants.

For the negative control, run `npm run test:db -- --baseline`. It replays the historical migrations before P1 and **must fail** on the first foreign-email claim assertion. The failing baseline proves the suite exercises the original vulnerability rather than only matching SQL text.

PGlite tests execute PostgreSQL grants, functions, transactions and RLS. They do not verify Supabase Auth HTTP behavior, email delivery, Storage HTTP behavior, concurrent independent database connections or live platform configuration. Those require the browser/email and deployed-role checks in the release plan. Never execute synthetic test fixtures against the shared live project.

The email handler's mocked-provider tests also cover acceptance, token rotation and expiry while the first email request is in flight. Before an existing-account OTP fallback, it re-reads the same invitation with the caller's JWT and requires the same owner, recipient, token and expiry. A database check cannot atomically cancel an external email delivery: acceptance immediately after the final check, or after provider dispatch, can still leave an unnecessary email in flight. These tests do not establish delivery cancellation or provider-side deduplication.

Accepted invitations stay consumed after a parent deletes their account. `delete_my_account()` removes that parent's links and Auth account but retains invitations issued by the player; P1 refuses to reassign an accepted invitation to a new account using the same email. `create_parent_invite()` returns that accepted row and `resend_parent_invite()` does not reopen it, so recreating the parent account does not restore access through the current public RPCs. This needs a reviewed operator recovery/new-invitation procedure if encountered in the pilot. Do not reopen an accepted invitation solely because a new account controls its former recipient email. The account-deletion suite now exercises actual deletion and denies a new same-email parent's replay; a legitimate operator recovery workflow is still unimplemented.

## Academy access and deletion

`npm run test:db -- --coach-departure-review` replays the same real migrations, then runs the original six-finding departure audit, academy-access compatibility tests, and committed four-role account-deletion fixtures. CI requires this target as well as the separate parent suite. The two account-deletion files run last on the same connection: setup deliberately commits, assertions prove they run in another transaction, and the entire disposable database is closed afterward.

Coverage includes stable academy profile/DOB access after transfer, legitimate linked-player edits, denied retargeting/organization changes, independent roster adoption, and closed-academy history that cannot be revived through the real player-linking RPC or later updates. Deletion checks exercise all four roles, parent-link isolation, consumed invitations and roster/assessment/award FK cleanup. This is partial account-deletion evidence: see [remaining U10 findings](../../docs/reviews/account-deletion-followups.md) for retained meetings, attribution, consent evidence and unverified avatar handling.

`npm run test:db -- --coach-departure-baseline` stops before the F1/F6 repair migration and must fail. The 58-migration baseline reproduces five desired assertion failures across F1/F6. Never convert that expected failure into a green release check.

Academy orphan-backfill fixtures run immediately before and after the repair migration. They explicitly simulate pre-existing corrupt references inside the disposable database, verify repair and permanent closure, then remove all their fixtures. Simulated corruption is distinct from the actual account-deletion/FK failures reproduced by the negative control.

## Native PostgreSQL 17

`npm run test:db:native` repeats the full migration/backfill replay and both suites on PostgreSQL 17 using `initdb`, `pg_ctl` and `psql`. Install PostgreSQL 17 first; the macOS default binary directory is `/opt/homebrew/opt/postgresql@17/bin`. Set `TRAK_TEST_PG_BIN` to another absolute PostgreSQL 17 binary directory when needed. The current runner uses macOS's `/private/tmp` and is a local verification target; CI runs PGlite SQL and the portable runner safeguard tests.

The runner creates its own private cluster and Unix socket, disables TCP, clears inherited database credentials/settings, and never uses Homebrew's default cluster or a linked Supabase project. It stops and removes its own cluster on success or failure; if shutdown cannot be confirmed it retains the directory and reports failure. Never point this harness at a real database. It accepts no database URL.

For the optional Supabase security advisor, set `TRAK_TEST_SUPABASE_BIN` to the absolute CLI executable path. The runner supplies only its generated private Unix-socket URL; an unsupported connection or advisor error fails the command without falling back to another database. `--baseline` and `--coach-departure-baseline` reproduce the respective vulnerabilities and must exit nonzero.

`npm run test:db:runner` checks process deadlines/failures, environment isolation and replay selection without starting PostgreSQL. Native sequential SQL checks still do not establish concurrency, real Auth/Storage APIs, email delivery or live deployment.

## Concurrent player linking

`npm run test:db:concurrency` creates another private PostgreSQL 17 cluster, performs the real replay, then races two authenticated RPC connections. A third connection holds a table/row lock until both callers are observed waiting with distinct backend PIDs. It checks same-player calls with an empty roster and an existing stub, plus two different players competing for a stub. Assertions require correct returned-row ownership, no duplicates and retained stub history. A pair-scoped transaction lock makes repeated calls return the same row.

`npm run test:db:concurrency -- --historical-link-rpc` loads only the original immutable migration's link function into the disposable database after replay. Both same-player cases must fail with duplicate rows; the command remains nonzero. This is a negative control, never a release check. The fixed implementation passes all three scenarios on PostgreSQL 17.11; this is not a general load benchmark or proof of child identity from a name match. The original name-based adoption policy still needs an explicit identity contract.
