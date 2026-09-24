# TRAK-18: Profile guardian controls

Profile previously let a player create a parent invitation by entering any email whenever no pending invitation existed. This slice removes that creation path and tells the player to contact their academy for guardian additions or corrections. Profile retains this guidance when empty; Home still hides an empty invitation card. Existing invitation addresses remain read-only, with the same expiry, share, resend, retry and account-change safeguards.

This implements only the Profile portion of G2 in `MVP Requirements`. It does not close TRAK-18. Onboarding still accepts a guardian email, and the backend audit still requires coordinated admission/authority fixes in TRAK-48/49. Existing invitation records are not evidence of academy authorization. No migration, provisioning, AuthContext, onboarding, email delivery function or production state is changed.

## Verification on 24 September 2026

Base: canonical main `97ddb7bc1c2db15f1d100b3c5131704857e7f0c4`. Node 22.23.0; dependencies from the unchanged lockfile. All backend responses in browser tests are synthetic and intercepted; no hosted account was used.

- Baseline invitation suite: 20/20 passed.
- New tests against unchanged production components: 6 failed, 18 passed. Empty/accepted/error/account-change cases exposed the old editor; pending/expired cases lacked academy guidance. An initial mock setup error was corrected before recording this red run.
- Final invitation suite: 24/24 passed. Obsolete creation expectations were replaced with UI denial, Profile retry and existing-recipient resend controls. Prior expiry, uncertain rotation, sibling invitation and shared-account recovery tests remain.
- Full source suite: 713 passed, 9 skipped. Harness: 18 passed.
- Typecheck, build, bundle credential scan and lint exited 0. Lint reports 131 warnings. The full source suite still emits existing Router/MSW/Supabase test warnings; it is not a warning-free run.
- Use-case check exited 0: 5 enforced, 13 pending without tests. No registry entry or enforcement level changed. This debt is not pilot acceptance.
- Built mobile route: 6/6 Chromium cases passed at 390×844, covering empty, accepted, pending, expired, failed-read recovery and resend. The observed resend body contains only the existing `invite_id` and `resend: true`, under the initiating player's token. Manual sharing fallback reveals only the rotated read-only link. Unexpected backend requests and page errors are both zero. Empty and expired screenshots were visually inspected, including long-address wrapping.

Run the focused browser suite after a production build using synthetic configuration:

```sh
VITE_SUPABASE_URL=https://xbykbqolvqyqmipikuae.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=synthetic-anon-key VITE_SENTRY_DSN='' npm run build
npx playwright test --config playwright.g2-profile.config.ts
```

The separate config reuses the pilot browser configuration without changing its shared test list. It must be run explicitly; neither the default pilot browser command nor CI currently selects this new browser file. Component regressions run in the normal source test suite. No SQL suite was rerun for this UI-only change; this provides no new backend G2 proof.

## Proposed review acceptance

Run the required source/harness/typecheck/build/lint/use-case checks and the dedicated browser suite. Confirm no guardian-email entry or add action is exposed by Profile across the tested states, retry remains usable, and resend cannot change the invitation recipient. Preserve the prior invitation controls and review the explicit G2 backend limitations. The reservation is in [the G2 coordination thread](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1790191626493799).

Reviewer agreement, independent review, CI on the proposed PR head, release recovery (#125), merge and deployed synthetic verification remain outstanding. No independent verdict or full G2 closure is claimed.
