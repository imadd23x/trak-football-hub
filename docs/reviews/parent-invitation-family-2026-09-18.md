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
