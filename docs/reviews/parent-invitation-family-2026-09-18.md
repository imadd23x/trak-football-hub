# Parent invitation → family verification — September 18, 2026

Second-child membership and failed-refresh recovery **passed locally**. No app
repair was needed. This change adds one browser regression and this evidence
record; it creates no new PR and performs no production deployment or live write.

Base: verified fork commit `f1ce2fa0bcfdacb17d19cc8b8dd838ce63c8f7cc`, branch
`parent/P7-invitation-family-review`. Test: `e2e/parent-invitation.spec.ts`, “existing
parent accepts a second child, recovers a failed family refresh and keeps both
links after reload”.

The stateful fixture starts with an existing parent linked to synthetic adult A.
Accepting adult B's exact invitation adds B, then membership reads fail. The app
shows a retryable error instead of empty-family or cached-child content. Retry
restores both children; their distinct data follows selection across Home,
Matches, Alerts and Profile, Settings lists both, and both links survive reload.
The test requires exactly one claim with the parent's token and no credential,
profile, provisioning, consent or email writes. Mocked telemetry is allowed.

Verification on September 18:

| Check | Result |
|---|---|
| Chromium, production preview, 390 × 844 | **5/5 browser tests passed in 11.8s**, including the new journey (6.0s) |
| `npm run build` | Passed; existing large-chunk warning |
| `npm run typecheck` | Passed |
| Strict standalone TypeScript check of the browser file | Passed |
| `npm exec -- eslint e2e/parent-invitation.spec.ts` | Passed with no output |
| `git diff --check` | Passed |

Reproduce locally after `npm run build`:

```sh
PW_CHROMIUM_EXECUTABLE='/Users/imad/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' npm exec -- playwright test --config playwright.pilot.config.ts
npm exec -- tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --strict --skipLibCheck --types node e2e/parent-invitation.spec.ts
```

Local browser evidence: `/private/tmp/trak-parent-journey-browser.log`. After the
browser run, only a redundant assertion about hardcoded fixture birth years was
removed; no interaction, network handling or behavioral assertion changed.

The browser exercises the real App, router, AuthProvider, Supabase SDK and query
cache. All backend HTTP is intercepted; unexpected external requests fail. This
does **not** verify SQL/RLS, real Auth tokens, email delivery, consent enforcement,
physical phones or the deployed application. Synthetic adult fixtures and an
empty awaiting-consent response deliberately avoid consent-policy assumptions.

Live P7 evidence still requires reviewed parent changes to be released and
verified with designated synthetic accounts, actual invitation emails and two
physical phones, covering new/existing parents, a second child, wrong-account
recovery, expiry/resend and failure handling. Record the deployed commit and
observed outcomes separately; local browser success does not establish them.

At the user's request, only the standalone P2 zero-approval test conversion is
parked and has not been retried here. Broader consent requirements and real-child
admission gates remain in scope; this task neither resolves nor parks them.

## Port to existing PR39

The existing family branch now includes parent security `5a14efe` and deployed
main `09d22d4`. The P7 test/evidence commit alone was cherry-picked as `6969c47`;
no other integration-branch code was imported. Existing family behavior stayed
unchanged. Source: 241 tests passed; harness: 17 passed; typecheck/build passed;
lint: zero errors and 135 warnings. Both 59-migration orders and all 282 reporting
assertions passed. Both negative database baselines failed for their expected
defects. The enforced use-case gate passes; four pending player assertions and
16 untested pending cases remain.

The first browser run passed four scenarios but the new case timed out looking
for P6's pending “Account settings” subtitle. PR39 still had the previous subtitle.
The selector now uses the visible `SETTINGS` entry, leaving exact wording to P6's
tests and retaining every linking/recovery/isolation assertion. No app change was
needed. The final rerun passed **5/5 browser tests in 12.6s**, including the new
case in 5.9s. Strict browser-file typecheck, lint and whitespace checks pass.
Evidence: `/private/tmp/trak-family-current-browser-final.log` and
`/private/tmp/trak-family-upgrade-*.log`.

This ports the regression through an existing PR; it does not create a new PR or
claim release/live verification. PR39 still depends on reviewed PR33, while P6's
settings changes remain separately reviewable in PR32.
