# Profile hydration recovery — scope and evidence

Base: fork #7 `c0999f9`. Initial runtime reproduction held the Auth user lookup after the SDK supplied a remembered session: the built app still displayed “Checking your account…” with zero buttons after 21 seconds; releasing that response immediately restored account choice. No unexpected request or browser exception occurred. Source: AuthContext's profile operation awaits `createOnboardingSession`, profile reads and existing pending-profile repair without a deadline.

Scope: bound this profile operation to 20 seconds, abort stale transport on account change/unmount/deadline, deduplicate same-account retries, preserve usable profiles and unfinished forms during refresh/repair, keep captured-account provisioning/cleanup and fail-closed routing. Add inline retryable profile-load feedback on account choice and protected routes. Reuse existing verified-session infrastructure; do not change the admission model or introduce a second one. Initial SDK session restoration and provider-owned sign-in/sign-out requests precede this operation and are not claimed bounded by this slice.

Acceptance: real-provider/SDK Auth or profile stalls end with retry controls; the actual transport aborts; retry can succeed; a timed-out old operation cannot overwrite a later same-account retry or a new family's state or start later provisioning/cleanup. An existing verified profile stays usable during a failed refresh or metadata repair. Token refresh must preserve drafts and avoid duplicate provisioning. In-flight server mutations may already have committed; cancellation does not claim rollback and retry must read actual state and preserve the existing idempotent contract.

Verification: registered failing tests before changes; positive retry and negative stale-result controls; actual built-app initial lookup, protected-route loading, retry and account changes with intercepted Auth/Data API. Existing source/harness/type/lint/build/use-case checks, exact-head fork CI, independent review. No real account, hosted database, provider/template change or production deployment.

Rollout: separate fork PR on the exact dependency; retain previous release gates and owner review. The new source commit can be reverted before release independently of #7; a released failure requires a forward repair preserving account isolation. Do not infer that this fixes initial SDK token refresh/restore or proves pilot concurrency capacity.

## Executed local evidence

The seven initial real-provider/SDK regressions failed on `c0999f9` before the fix. After implementation, all nine new hydration regressions and the existing Auth/onboarding-session regressions pass (39 focused tests). The two additional negative controls cover a transport that ignores abort and returns after a successful same-account retry, and a provisioning acknowledgement lost after a synthetic server commits. The latter models the existing idempotent server contract; it is not independent SQL proof of idempotency.

Full local results on the final source:

- 523 source tests across 43 files; 17 harness tests across four files; typecheck and production build pass.
- All 38 registered browser journeys pass against the actual production build and intercepted synthetic Auth/Data API. The four new journeys include two actual 20-second deadlines, observable browser request cancellation, keyboard retry, successful reload, protected-route fail-closed behavior, cross-tab family switching and an explicit retry after a rejected profile request. No unexpected backend requests or browser exceptions occurred.
- Inspected 320px account-choice and 390px protected-route screenshots: inline feedback and retry controls remain visible, without horizontal overflow. Existing authenticated forms stay mounted during a failed refresh in the real-provider test.
- Lint: zero errors, 131 inherited warnings. Build still reports the existing large-chunk advisory.
- The unchanged #37 bundle checker scanned the actual build: 95 files, 81 readable files, 77 named chunks; no dev-only module or burned credential value.
- `test:usecases` still contains three failing UC-A02 player self-logging cases, ten passing cases and 15 pending cases without tests. Its wrapper returns success despite those optional failures. UC-A02/UC-A03 retirement belongs to Tarek's already-authorised coach-only pilot task; this PR neither claims they passed nor silently removes them.

Injected SDK aborts produce handled `DOMException` stderr diagnostics in the unit suite; they are not unhandled test failures. A deadline cancels client transport and future follow-up work, not an already committed server mutation. Backend authorization and consent remain authoritative even when an existing profile is retained for a recoverable refresh failure.

Independent exact-commit review, fork CI, dependency integration and production verification are separate gates. No hosted database/Auth changes, real email, production merge or deployment were performed. Initial SDK session restoration/sign-in/sign-out and the academy-data departure follow-up remain outside this profile-operation fix.
