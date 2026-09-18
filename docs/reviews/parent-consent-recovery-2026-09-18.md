# Parent consent-screen recovery — September 18, 2026

Scope: correct independent client failure paths in the existing consent journey,
based on current-main parent integration `a1e5339`. No consent policy, age
threshold, notice wording, grant/withdraw SQL or academy scope is changed here.
The parked P2 SQL-test conversion remains untouched. This is not completion of
the academy-specific consent design or approval to admit real children.

The existing screen submits approval, reloads pending children, then navigates
using the **old** child count. A newly pending child can be skipped, and a failed
post-save refresh can be hidden by navigation. RPC responses are cast without
validation: null/non-array responses can appear as nothing pending; malformed
child rows can crash the page.

Acceptance criteria:

1. Parse the pending-child response at the boundary. A valid empty array means
   nothing pending; invalid/missing data produces a retryable error.
2. After approval, use the successfully refreshed pending list to decide
   whether to continue to the next child or return home. A failed refresh keeps
   a visible read-retry state without sending another grant.
3. Bind a write to the authenticated account that started it, discard results
   after account changes/unmount, and prevent duplicate submissions. Disable
   editing while saving; preserve choices after a failed grant until the parent
   explicitly rechecks current status. Reset choices for a different child.
4. Treat malformed/uncertain write responses as unconfirmed. Recheck state
   before another grant rather than claiming success or automatically retrying
   a mutation.
5. Cover the actual routed App/Auth/Supabase SDK with synthetic HTTP, including
   optional choices defaulting off, second-child continuation and failures.

Implementation is limited to ParentConsent, a small typed RPC boundary, the
existing pending-consent reader and focused tests. Run the relevant source and
browser journeys, typecheck, lint and build. Review in the fork before any
production approval. Rollback is a client revert; no schema rollback is needed.

The confirmed guardian-withdrawal policy is recorded separately in
[the P2 design](../plans/p2-academy-consent.md); it is not implemented by this UI
repair.

## Verification

The original routed-app reproduction failed six of eight tests: it skipped a
newly pending second child, hid a failed refresh by navigating Home, treated
three invalid responses as empty and crashed on a null child name. The valid
empty response and initial-error/retry controls passed.

With this change, **15 real-App/Auth/Supabase SDK journey tests and 19 response
boundary tests pass**. HTTP is intercepted with explicitly synthetic users and
data. The tests check outgoing grant payloads and account tokens, optional
defaults and per-child reset, read-only retries after an uncertain response,
preservation of same-child choices, disabled inputs/duplicate clicks while a
grant is held, an A-to-B SDK account switch before A's response finishes, and
freshly unverified-email/non-parent-role responses rejecting before a grant.
No real accounts, email, consent records or provider calls are used.

Full source tests: **364 pass**. MSW/use-case harness checks: **17 pass**.
Typecheck passes; ESLint has **0 errors / 130 existing warnings**. The use-case
ratchet passes its two enforced cases, while three assertions in pending
UC-A02 fail because they target the removed `/player/log` route; 15 other
pending cases have no tests. These are not represented as passing coverage.

The production build passes, with the existing large-chunk warning. **All eight
mobile Chromium journeys pass (19.5 seconds)**, including the six existing
parent invitation/family/history regressions and two new consent journeys.
The new journeys prove malformed-response recovery, one grant despite repeated
clicks while saving, saved-status plus failed-refresh recovery, next-child
defaults, and Home navigation only after the fresh pending list is empty.
Exact grant payloads and read/write counts are asserted; unexpected external
requests and page errors fail the tests. This is a local production bundle at
390×844 with synthetic intercepted backend responses, not hosted-browser proof.
The saved/error and next-child screenshots were visually inspected; content and
retry controls fit the mobile layout. Explicit typechecking of the browser test
and focused lint also pass.

Reproduction commands:

```sh
npm test
npm run test:harness
npm run typecheck
npm run lint
npm run uc:check
npm run test:browser
```

Local browser execution set `PW_CHROMIUM_EXECUTABLE` to the installed Chromium.
Logs are in `/private/tmp/trak-consent-{source-final,harness,type-final,lint,usecases,build,browser}.log`;
screenshots are generated under `test-results/parent-consent-*` and stay out of
the commit. No production database, migration or deployed app was changed.

An independent source review found no actionable regression in this scoped
change. The local test environment exposed an unsupported `throwIfAborted`
method, so the helper now uses the portable `signal.aborted` guard; no test-only
polyfill hides that execution path.

## Remaining boundaries

Client duplicate-click protection and disabled SDK mutation retries do **not**
establish server-side idempotency. An uncertain request can still complete
after a status read, remount or another tab's action. The existing SQL lacks an
operation key; transactional idempotency belongs in the academy-specific grant
and withdrawal contract. Aborting a fetch cannot undo a committed write.

The current backend remains child-wide and uses the existing age threshold and
notice. Fresh Auth/email/role checks in this client protect this journey; they
do not repair the independently callable server RPC. Existing wording about
withdrawal and permission scope is intentionally unchanged pending the P2
contract. This is a fork-only client recovery change, not proof of backend
consent enforcement, deployment, production behavior or pilot readiness.
