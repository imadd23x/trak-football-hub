# Password recovery callback and account boundary

Scope: the frozen pilot candidate `9324361` had a reset form that accepted any cached session, ignored recovery URL errors, waited indefinitely after its one retry, and submitted through the mutable shared Auth client. This follow-up changes the reset page, its Auth lifecycle integration, a small eagerly registered client hook, and focused tests. It changes no database, backend configuration, API key, invitation, or consent contract.

## Acceptance and implementation

- An implicit recovery callback belonging to this tab must be observed before the form becomes ready. Existing sessions, ordinary sign-in, refresh, and a recovery event without that callback do not establish recovery context.
- The client captures the URL before `createClient` consumes it and subscribes immediately afterward. The small hook in the generated client must be preserved if that file is regenerated. A route-module-only listener was tried and rejected: actual-client tests showed it could miss a fast SDK callback before the dependency finished loading.
- The observed callback token and account are held only in private memory. The temporary URL copy is cleared immediately after setup. No additional storage key, log, telemetry field, or persistent recovery flag is introduced. SDK session storage continues its existing behavior.
- SDK event callbacks stay synchronous. Validation is queued outside the Auth session lock. `INITIAL_SESSION` arriving after the recovery event does not discard valid proof. A same-account refresh may preserve an established context; sign-out, a changed identity, or a new ordinary session invalidates it.
- Before submitting, the current session must still match, and `getUser(capturedToken)` must return the same account. The Auth PUT uses that captured bearer token. Its response must identify the same user, and the current session is checked again before success. Late work cannot change the form after an account switch. A retryable identity-service failure or HTTP429 preserves the same recovery context for a manual retry; a rejected identity/token remains invalid, and no PUT is sent before validation succeeds.
- Callback verification offers a slow state after ten seconds while permitting a delayed valid response. An update attempt has a fifteen-second deadline covering the session check, identity request, PUT, and response handling. A timeout invalidates that attempt and aborts its fetch; a later SDK response cannot send or complete it. The UI distinguishes an update that may already have reached the server from a preflight that never sent it.
- Success consumes the in-memory context and clears password fields. The user explicitly chooses Continue to Trak; no uncancelled navigation timer remains.
- The reset route updates AuthContext's account state without its automatic sign-out redirect, leaving the page to display account changes and recovery errors.

## Evidence

The initial actual-SDK/MSW regression run reproduced five failures and passed the valid-reset control. After implementation, tests cover the bare route, expired/reused error URLs with an unrelated retained session, rejected tokens, pre-mount recovery, recovery events without this tab's callback, account switches before and after dispatch, sign-out, duplicate submission/retry, mismatched identity, malformed/wrong-user 2xx responses, stalled preflight/PUT, and delayed valid verification. Two additional AuthContext tests cover reset-route hydration and sign-out.

Independent review found that the first PUT implementation accepted any 2xx body and lacked a deadline. Four new regression cases failed before those findings were fixed. Retained mutation evidence also demonstrates failure when server identity verification, successful-response identity verification, or the immediate listener timing is removed.

Final local validation: all23 current CI command checks plus default smoke pass; source872 passed/9 existing skips, pilot browser20/20, default smoke11/11. Focused recovery/AuthContext42/42 were also independently rerun. Exact logs are recorded in the local review artifact: `artifacts/2026-09-22-password-recovery/`. Source tests use the real application client and installed Auth SDK with synthetic MSW endpoints; no hosted password is changed by these tests.

## Rollout, rollback, and limits

This is a local candidate until independent review and the release gate are satisfied. Build the final candidate for the dedicated test project, generate a fresh recovery action link for each case, and verify successful reset, invalid/reused link, slow exchange, and account switching in the browser. SMTP delivery remains a separate acceptance check.

No migration or data rollback is needed. If a release introduces a recovery regression, revert this frontend commit or disable the affected reset path while preparing a correction; the previous page's known session-selection and loading failures must not be called pilot-ready.

`PASSWORD_RECOVERY` is an SDK lifecycle signal, not server-enforced recovery-only authority. The Auth service permits authenticated password changes according to its own rules. This change prevents accidental client account substitution; it does not promise session revocation or make claims about attackers who already possess valid tokens. It covers the application's current implicit callback flow, not PKCE. Reloading after the SDK consumed the callback, or opening a bare reset route in another tab, loses this deliberately in-memory context and requires a fresh link. A dispatched request may commit even if the browser later aborts it; the page reports that uncertainty.
