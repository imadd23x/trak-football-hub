# Database birthday consistency

Scope: preserve the existing `public.player_age_years(uuid)` body, owner, ACLs, volatility, security mode and signature; pin only its execution timezone to UTC with a new forward migration. The frontend birthday helper was separately released in #38. #42's timezone change is a test fixture and does not modify this database helper.

Observed failure on released main `4335e89`: the same synthetic player has a different age and consent-required result in UTC−12 on their UTC birthday. The test uses extreme timezones so it exercises a different calendar date at every wall-clock time, with an assertion proving that the old expression disagrees. It does not depend on running CI at midnight.

Acceptance: birthday yesterday/today/tomorrow at the existing consent boundary, unknown/missing DOB, leap-day DOB and the real consent caller must agree in UTC, Dubai, Athens, Los Angeles, UTC−12 and UTC+14. The function must restore its caller's timezone after returning. The threshold and unknown-age consent policy are intentionally unchanged here.

Before the migration, the new SQL suite fails the birthday age and consent assertions. Afterward all 64 assertions pass in both fresh and deployed reports-before-parent order, with all 67 migrations and the existing three SQL suites. The suite is registered in the current runner and carries the @trak-suite marker for #42's future registry. Preserve both registrations when integrating that PR.

Release: standalone fork branch based on released main. Requires independent review and production approval. No live migration or authenticated production RPC verification has been performed. After release, verify the applied function setting and approved synthetic birthday fixtures. Repair forward if deployment fails; do not rewrite the historical migration or roll back to session-dependent ages.

This does not implement the agreed under-18 academy consent policy. Legacy threshold 15, missing-age behavior and the full authority-to-data/UI cutover remain separate real-child admission gates.

Additional access finding: a read-only live catalog query confirmed that `player_age_years(uuid)` is SECURITY DEFINER and callable by both anon and authenticated. The initial test assumption that anonymous execute was already denied was incorrect and was removed before recording the reproduced timezone failure. No child values were queried. This existing arbitrary-ID age lookup needs the RPC permission review; the UTC migration neither adds nor fixes those permissions.

Final local verification: 385 source tests and 17 harness tests pass; typecheck/build pass; lint has zero errors and 134 existing warnings. The enforced use-case gate passes, with three existing pending UC-A02 failures and 15 pending cases without tests still reported.

Native PostgreSQL 17.11 verification: replayed main's 66 migrations, ran the new suite and observed the birthday age/consent failures, applied only the new forward migration, and passed all 64 assertions. Compared `pg_proc` before/after: function body, owner, ACLs, security mode and volatility were identical. The three existing SQL suites also passed. The disposable server was stopped after verification. CI repeats the fresh and deployed-order SQL regressions through the existing PGlite harness; this native check was local.
