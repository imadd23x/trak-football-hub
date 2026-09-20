# UT-22: choose a remembered account before continuing

September 20, 2026. Incremental fix on staff admission PR74 `c910829a088c0debaaf15c61ad897b1a77f00f84`; canonical main `4335e89` is an ancestor. This branch changes the landing-page consumer, one password-reset success message, focused tests and browser test registration. It does not redefine household admission or edit a peer-owned contract.

## Cause and behavior

`LandingPage` previously navigated whenever Auth restored a session and loaded a profile. Visiting the sign-in page, refreshing a token or following an implicit email fragment could therefore skip account choice. A missing profile was also assumed to mean a parent invitation, although staff activation can now be incomplete too. The sign-in submit handler did not catch an unexpected rejection, which could leave its button disabled indefinitely.

Returning visitors now see the remembered account's name/email and choose Continue or Sign in with another account. Continue uses only a recognized role. A successful password submission on this page can proceed once its matching email/profile finishes loading; a response for A does not automatically open B. Session restoration and token refresh alone do not trigger navigation. Sign-out must succeed before a new empty sign-in form is shown; failures preserve the visible account and offer retry. UI errors from an old unmounted account are discarded. Accounts with unavailable roles can check access again or switch rather than being routed into a guessed invitation flow. Initial hydration shows a loading status instead of briefly presenting an incorrect form.

This is a navigation/interaction fix, not an additional authorization barrier. Direct authenticated routes remain governed by the existing guards, RLS and consent work. The global parent context may still refresh membership while a remembered parent is on the public route. It is not a promise of zero background account requests before Continue.

## Verification

- Before the source change, 13 of the first 14 focused React regressions failed, and a thrown sign-in error produced an unhandled rejection. The existing deliberate-sign-in case passed. After the fix and two additional unknown-role controls, all **16 focused tests pass**.
- Full source suite **436/436**, harness **17/17**, typecheck and production build pass. Lint reports zero errors and 134 warnings in this branch. No new package or database migration is introduced.
- Built-app Chromium: **15/15 journeys pass**, including all nine existing parent/staff journeys and six new account-choice cases. New coverage exercises 320/390 px, reload, keyboard Continue, failed logout then retry, failed password then successful switch to another family, an actual SDK-parsed email fragment missing-profile recovery and the password-reset return path. Synthetic requests are intercepted through the real Supabase SDK. Unexpected requests and page exceptions are asserted absent.
- One initial browser assertion expected `/` exactly; the SDK correctly cleared the fragment token but retained an empty `#`. The test now requires the same origin/root path and an empty parsed hash. No application code was changed to satisfy that cosmetic expectation. The reset fixture was also corrected to expect the two null PKCE fields sent by the actual SDK; the password/account expectations remain exact.
- Both phone screenshots were generated; the 320 px result was visually inspected and has no clipping or horizontal overflow. The browser tests assert overflow at both widths.
- This dependency does not yet contain the `check:bundle` npm script. Its initial invocation failed as missing, so the unchanged checker and denylist from reviewed PR37 `b0cb7ab` were run in an isolated scratch directory against this branch's actual `dist`. It scanned 97 files/83 readable files/79 named chunks and found no dev-only module or burned value. This ad hoc check is not represented as a new CI guard; the shared checker arrives through its existing dependency.

Commands: `npx vitest run src/pages/__tests__/LandingAccountChoice.test.tsx`; `npm test`; `npm run test:harness`; `npm run typecheck`; `npm run lint`; `npm run build`; `npx playwright test --config playwright.pilot.config.ts`.

The password-reset success message now says “Password updated,” matching the subsequent account-choice screen. Its new browser check verifies the real SDK request and return path. Initial commit `b763063` passed the full [fork CI workflow](https://github.com/imadd23x/trak-football-hub/actions/runs/35522206026), with production jobs skipped; the follow-up requires its own CI result.

## Review, release and remaining scope

The separate fork PR targets the exact staff-admission branch for a small reviewable delta. Pass its actual CI and obtain independent review before combining it with the main release candidate. #74 itself remains a draft dependency. An upstream merge/deployment still requires Imad's production approval and separate live verification. No real account, email, Auth configuration, database or deployment was changed by these tests.

UT-22 is not wholly closed: the existing AuthConfirm handler/provider/template paths need separate review, and household login/consent cutover remains outstanding. This change uses the existing AuthProvider sign-out operation; it does not redesign session persistence or sign-out scope. If a regression appears, hold release and fix forward. Do not restore automatic redirection or guess a profile role as the recovery path.


Tarek independently accepted the account/session logic at `b763063`: 16 focused tests passed in his checkout; removing the navigation gate caused eight tests to fail. His review excluded browser execution, which is recorded separately above. He correctly identified that `refreshProfile` catches its own failures in AuthContext and resolves; the unreachable component catch is removed rather than inventing a second error surface. The existing AuthContext toast owns that error. Final-head acceptance and CI are separate from his earlier scoped verdict.
