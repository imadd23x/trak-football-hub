# Account deletion and avatar lifecycle

## Problem and observed behavior

Four new synthetic role accounts in the isolated Supabase project successfully called delete_my_account (204), lost Auth/profile rows, and left byte-identical avatars downloadable through the service Storage API. A fifth synthetic parent could recreate its avatar with its pre-deletion JWT after Auth/profile deletion and explicit object cleanup. All newly created objects/accounts were cleaned. These probes are not production verification.

## Change and dependencies

This branch composes recoveryPR102, the local deletion-finalization fix990f7a3, and Storage-policy3108c0e. Settings removes its account-bound canonical avatar key and any stored path inside that same user's legacy folder through Storage API, rechecks the active identity, then invokes deletion. Storage errors stop before account deletion; completion still uses the existing deletion/logout recovery path.

A forward migration adds restrictive avatar INSERT/UPDATE policies. A private-schema helper locks and verifies the live Auth row. The deletion RPC locks the same row and refuses deletion while the canonical or own-folder avatar metadata exists. The locks prevent an upload and deletion from each passing their checks against incompatible states. Existing role-specific retention behavior is preserved.

This requires the corrected owner-delete policy. Do not deploy the deletion guard ahead of working client cleanup and that policy. Audience selection remains a separate decision; this branch's dependency preserves existing authenticated reads while denying anonymous reads.

## Verification

New SQL regression was red for deletion-with-avatar, preservation of blocked Auth/profile, and old-JWT re-upload. New real-SDK Settings tests were3red/37pass before the change and40pass after it. They cover cleanup ordering, Storage failure, and account switch while cleanup is pending. The existing browser deletion/reload/logout-retry test also checks exact object key and single cleanup before account deletion.

Native PostgreSQL17.11 executes both schedules with observed lock waits: upload first causes deletion refusal and preserves account/avatar; deletion first causes upload refusal and leaves neither. Disabling the avatar guard, live-account existence check, or deletion lock is caught. The missing-lock mutation produces Auth0/avatar1, demonstrating the race rather than merely inspecting function text.

Full CI evidence is retained outside this checkout at artifacts/2026-09-22-account-avatar-lifecycle/. The first run failed2Storage tests because their fixtures used UUIDs without live Auth accounts; those fixtures now create the required synthetic identities. Do not treat the initial failure logs as a product regression or erase them.

## Limits and rollout

The new migration is not applied to production or the isolated hosted project yet. SQL tests model Storage metadata; real Storage byte cleanup, API-level upload races, and all-role browser completion still require hosted verification. Unreferenced legacy-folder files cause a fail-closed refusal, not silent erasure; exhaustive legacy cleanup is not implemented. A network response lost after account deletion remains ambiguous. Legal history/consent/meeting retention decisions and real-phone checks remain open.

Run complete checks and obtain independent review before publication/merge as required by the release gate. Apply reviewed changes to the isolated project first and verify exact fixture bytes, account/profile removal, old-token denial, and unrelated-object preservation. Production requires separate authorization. Roll back client presentation only if needed; do not restore old-token upload access or remove the no-orphan guard. Repair forward.

Supabase requires deleting bytes via Storage API, not SQL: https://supabase.com/docs/guides/storage/management/delete-objects.
