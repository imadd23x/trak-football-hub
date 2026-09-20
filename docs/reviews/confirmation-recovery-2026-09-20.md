# Email confirmation recovery — implementation record

Scope: incremental UT-22 on fork #4 `d306355`; email confirmation only. Existing session choice, staff admission and household contracts remain dependencies. Password-reset recovery is a separate outstanding slice.

Acceptance before release: an emailed confirmation cannot replace a remembered family account or sign out its other devices; only confirmation types are accepted; token verification runs once per operation even under StrictMode; failed verification and cleanup have truthful terminal/retry states; cleanup retry never consumes the token again; late completion cannot alter another account; email-change first-step responses do not claim completion. Phone/keyboard states and real SDK request semantics must be exercised.

Implementation approach: use the existing Supabase SDK with a separate non-persistent Auth client for confirmation, no URL session detection or automatic refresh, explicit local-session cleanup, and a bounded request. Keep the app's normal Auth client/storage untouched. Do not edit hosted email templates or claim those are verified.

Rollout: focused fork PR, exact-head independent review, required checks, explicit production approval and synthetic email-provider rehearsal. Rollback before deployment is source revert; after delivery hold the callback feature and fix forward without restoring cross-account session replacement. No migration or hosted Auth/config changes are part of this patch.

## Implementation and verified behavior

`email-confirmation.ts` uses a non-persistent Auth client with URL detection and auto-refresh disabled, a distinct storage key, no remaining visibility listener, and a 20-second abort covering verification/response parsing/cleanup. It never reads or saves the app session. Only `signup`, `email` and `email_change` are accepted; missing/duplicate fields and recovery/invite/magic-link purposes are refused before an Auth call. A completed verification is retained within the operation, so cleanup retries only `signOut({ scope: 'local' })`. Partial email-change acknowledgement directs the user to the other inbox. A generic 403 is not falsely labelled an expired link.

The page presents pending, error/retry, partial-email-change and confirmed states with keyboard-accessible links/buttons. Completion offers the existing account-choice route, without automatic dashboard navigation. StrictMode shares the pending operation; a different URL gets its own operation; cleanup can finish after unmount without touching a new family account.

The browser reproduction exposed an adjacent required integration fix: AuthContext suppressed every auth event on `/auth/confirm` and also skipped its getSession fallback. Returning internally to Landing therefore stayed on “Checking your account…” forever. Only those obsolete confirmation suppressions were removed. The reset-password suppression and all other provider contracts remain unchanged. The landing comment was corrected to describe the isolated confirmation flow.

## Verification evidence

- Before implementation: all 16 initial confirmation regressions failed while the existing 436 source tests passed. Failures included destruction of a remembered account and global cleanup scope; some failures also reflect the newly required accessible outcome/retry UI, not 16 independent vulnerabilities.
- Final focused real-SDK tests: 20/20 pass, including expired/malformed/wrong-purpose links, duplicate parameters, local cleanup retry, remembered-family isolation, partial email change, thrown transport failure, a stalled request aborted by the actual fetch signal, non-expiry 403 and late response after unmount.
- Complete source suite: 456 tests pass. Harness: 17 pass. Typecheck and production build pass. Full lint: zero errors, 134 inherited warnings; focused new-file lint is clean.
- Built-app Chromium: all 21 parent/staff/account/confirmation journeys pass after the provider repair. The six confirmation journeys pass again after the final wording/error-classification change. Phone widths 320/390, keyboard continuation, reload, expired links and cleanup retry are covered. Screenshots inspected; no horizontal overflow. All backend traffic is intercepted synthetic traffic; tests assert no unexpected calls or uncaught page errors.
- Initial built-app run: 18 pass, three confirmation-to-account-choice returns fail. Network trace showed verification and cleanup completing, but no remembered-account hydration. This failed run is the evidence for the provider repair, not a fixture timeout to relax. The fixture was then extended to serve the expected existing parent-context reads, validating their account IDs and bearer tokens.
- The use-case command exits zero for its enforced scope, but three optional UC-A02 player-self-logging tests still fail and 15 cases have no tests. Those obsolete player-write cases belong to Tarek's separately reserved coach-only retirement task. They are not reported as passing or silently removed here.
- This base lacks the native `check:bundle` script. The unchanged checker and denylist from #37 `93ae9ea` were run in a temporary directory against this candidate's actual dist: 97 files, 83 readable, 79 named chunks; no dev-only module or known burned value. No checker was added to this branch.

SDK semantics were checked against the installed implementation and the official [verifyOtp documentation](https://supabase.com/docs/reference/javascript/auth-verifyotp) and [signOut documentation](https://supabase.com/docs/reference/javascript/auth-signout). The [current changelog](https://supabase.com/changelog.md) was read; no dependency/config upgrade was made. `verifyOtp` can create a session, and default sign-out scope is global, which is why this operation isolates storage and explicitly selects local cleanup.

No hosted email-template/provider setting, live Auth account, Supabase migration or production deployment was changed. Hosted delivery, the actual template/redirect configuration and secure email-change two-inbox behavior still require an approved synthetic live rehearsal. An aborted/lost verification response can leave the link consumed server-side; the UI offers sign-in or a new link rather than asserting that the server did nothing. Browser-held access tokens already issued by Auth do not become instantly invalid merely because a refresh session is revoked.

Remaining UT-22 scope includes password-reset recovery and the household/consent integration. The pilot as a whole is not complete.
