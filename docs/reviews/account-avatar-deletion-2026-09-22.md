# Account deletion and avatar lifecycle

## Problem and final behavior

Four isolated synthetic role accounts could delete Auth/profile rows while leaving byte-identical avatars downloadable. A pre-deletion JWT could also recreate its avatar after account deletion. Settings now removes the canonical own-avatar key and any stored path inside the same user's legacy folder through Storage API, checks that the active identity has not changed, and then calls account deletion. Cleanup failure stops deletion; successful deletion completes local logout through the existing recovery path.

The deletion RPC refuses while own avatar metadata remains. Restrictive upload policies reject a missing Auth account. A second forward migration adds a private trigger at final Storage metadata INSERT/UPDATE: it derives the account from the UUID object-key prefix and locks/verifies that Auth row, including elevated Storage completion. Non-avatar buckets are unchanged. Existing role-specific retained history remains unchanged.

## Why two migrations are necessary

The first policy-only guard passed all20 local checks but failed a hosted race: upload200 and deletion204 for one new synthetic parent (run1dda7958). That probe stopped before byte observation and cleaned its fixture; it is not proof of surviving bytes. A separate observation39a9594b caught the safe upload-first schedule, which did not clear the original failure.

Supabase Storage probes RLS permissions in a rolled-back transaction and later persists metadata through asSuperUser(): https://github.com/supabase/storage/blob/master/src/storage/uploader.ts. The original native tests modeled only a single authenticated transaction. A new elevated-completion regression failed locally; migration20260922114806 makes it pass. It supplements already-applied migration20260922094942 rather than rewriting history. Removing the new trigger makes the regression fail again.

## Verification of the correction

- All20 canonical local checks pass:711 source tests,40 focused Settings tests,11 pilot browser tests, PGlite suites, native PG17.11, convergence/build checks. Hooks pass. Evidence:artifacts/2026-09-22-account-avatar-lifecycle/completion-full-ci/.
- Native concurrency exercises elevated upload first (deletion waits/refuses), deletion first (upload waits/refuses), and permission-probe rollback followed by deletion and elevated completion (refused, Auth0/avatar0). An initial new-test fixture setup incorrectly rolled back its own account creation; that harness error is preserved separately and corrected by committing setup before the permission probe.
- Isolated projectvklpncpwenulmjilnxuj now has93 original-version migrations, latest20260922114806. Completion trigger exists and local/hosted function hash matches044a378b931a6fcdd5ce49ab79e40164.
- Hosted run c8f12eae-2e01-477a-973e-e3b2535a18e2:four fresh parent races,90 requests. One upload-first refusal55000, then successful cleanup/deletion; three deletion-first outcomes with upload400 and deletion204. Auth/profile gone and Storage GET400 afterward; old-token uploads denied. All new fixtures cleaned.
- Hosted run e850c475-8000-4ff0-8521-83120b9c8543:coach/player/parent/club all pass,82 requests. Avatar blocks direct deletion; owner removal is repeatable; deletion204 removes Auth/profile; avatar bytes are inaccessible through Storage API; old JWT cannot recreate them. Exact fixtures cleaned. Minimal profiles do not establish populated academy-history retention.
- Security advisors:zero new findings; existing findings remain. Production was not changed. HTTP races sample schedules; native tests force the ordering. Storage API absence does not prove immediate physical erasure of inaccessible backend versions.

## Dependencies, acceptance and limits

Includes recovery#102 at8325dd6, local deletion-finalization990f7a3, and Storage-policy3108c0e. Corrected owner DELETE and client cleanup must accompany the deletion guard. Authenticated avatar reads are preserved pending the owner's audience decision; #109's own-only audience target is not yet satisfied.

The hosted race found during publication is now addressed by the forward correction and the executed checks above. Keep the PR a draft pending independent review of both migrations, client completion and elevated Storage persistence. Draft publication and review coordination are authorized; production merge/deployment requires separate authorization.

Unreferenced legacy-folder files cause a refusal and need operator cleanup; exhaustive legacy discovery is not implemented. A lost network response after deletion remains ambiguous. Legal retention decisions, all-role browser completion and real-phone checks remain open. Storage bytes must be removed through Storage API, never SQL: https://supabase.com/docs/guides/storage/management/delete-objects. Repair forward; do not restore stale-token upload access.
