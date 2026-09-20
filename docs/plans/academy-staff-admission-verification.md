# Staff invitations and activation — draft, not a release candidate

Base: canonical main `4335e8984777b7b704e8706d3fe277352658c9ed`. Decision: [academy-led admission](academy-led-admission.md), including fully waived pilot enrolment and no later payments. Implementation is in fork branch `parent/P5-academy-staff-admission`, upstream draft PR #74. This document distinguishes the committed foundation `9408ea9` from its email/UI follow-up.

## Scope and observed failures

On unchanged main, actual authenticated calls successfully create public coach/admin profiles, insert a coach profile directly, join by a shared academy code and move coach membership directly to another academy. The baseline control requires exactly those five assertion failures; absent new functions or a SQL syntax error cannot satisfy it.

The first forward migration adds an unexposed `trak_admission` schema containing explicit platform-owner authority, invitations and transaction-scoped activation capabilities. Public issuance, acceptance and revocation RPCs perform server-side authorization; private helpers/tables are inaccessible to application roles. No owner identity is automatically trusted or bootstrapped.

Invitations bind verified recipient email, current issuer authority, staff role and academy. They expire in seven days; a deliberate replacement revokes the previous pending invitation. Raw random tokens are returned once, never persisted. Repeating an issuance request returns status without another token. Acceptance is atomic and repeated clicks succeed only while the accepted membership still exists. An old accepted link cannot restore a removed coach.

Guards block new staff creation and membership reassignment through existing RPCs/direct writes. Profile and academy identity are pinned. Ordinary Settings upserts and departure/deletion remain supported. AFTER INSERT guards distinguish actual new rows from an existing-row UPSERT; an exception rolls back the complete statement. FK cleanup may clear coach membership when the referenced academy has already been deleted. The profile identity UPDATE guard deliberately duplicates an RLS restriction as defense in depth; removing that trigger alone is not expected to bypass RLS. Tarek independently checked the foundation, not this email/UI extension, in [his review](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/pull/74#issuecomment-5749908643).

## Email and user-facing flow

The second forward migration adds recipient-scoped activation inspection, issuer-scoped invitation status, delivery claims and opaque attempt receipts. Issuance/rotation and the email allowance commit atomically: rejecting a rate-limited replacement must preserve the previous working link. Claims serialize by issuer and invitation scope; limits are 50 dispatches per issuer per UTC day and a 60-second per-recipient cooldown. A duplicate request checks persisted status and cannot dispatch again. Only the service role can record the matching provider receipt; a recorded outcome cannot be rewritten.

`send-staff-invite` verifies the caller, prepares the invitation with that caller's JWT, and uses the service role only for Auth invitation mail and the receipt. Existing-account fallback requests a magic link with `shouldCreateUser: false` after checking current invitation/attempt status again. Unknown network/provider outcomes remain unconfirmed; they are not described as delivered and do not trigger automatic repeat mail. Responses expose neither the activation token nor provider internals.

Academy screens link to `/staff/invitations`. Public coach/admin signup routes now explain personal invitations; editable legacy onboarding metadata no longer creates or repairs staff identities. `/staff-invite` authenticates before revealing academy details, preserves its route when requesting an email sign-in link, and offers explicit account switching. New profileless recipients choose a password; existing profiles and existing-account links preserve credentials. Password writes use the captured account token and activation stops if the account changes. Navigation waits for the new profile to hydrate. UI inputs, stale results and pending requests are reset on account changes.

## Verification recorded September 20, 2026

| Check | Observed result |
|---|---|
| `npm run test:db` | 68 migrations replay; all five SQL suites pass, including 51 staff-admission and 27 delivery assertions, plus 282 operational-view assertions |
| `npm run test:db -- --parent-upgrade-review` | Same five suites pass with deployed reporting migration before parent upgrade |
| `npm run test:staff-guards` | 14 controls pass: unchanged-main reproduction, seven admission mutations and six delivery mutations |
| `npm run test:staff-native -- --pg-bin /opt/homebrew/opt/postgresql@17/bin` | PostgreSQL 17.11: all five SQL suites and 13 independent-connection races pass; server stopped afterward |
| `npm test` | 420 source tests pass, including 16 handler, 11 real-SDK activation/sign-in, five invitation-management and 21 AuthContext tests |
| `npm run test:harness` | 17 tests pass |
| `npm run test:consent-timezones` | All configured timezone runs pass |
| `npm run test:browser` | Nine Chromium journeys pass against the local production build: five existing parent journeys and four new staff journeys |
| Deno entry point | `npx --yes deno@2.9.6 check --no-config --no-lock supabase/functions/send-staff-invite/index.ts` passes |
| Static checks | Typecheck and production build pass; lint has zero errors and 134 existing warnings (no new warnings) |
| `npm run uc:check` | Gate exits successfully with two enforced cases; still reports three pending UC-A02 failures and 15 cases without tests on this base |

Mutation tests must reach the named behavioral failure, not an arbitrary SQL exception. Delivery mutations independently falsify recipient binding, verified email, duplicate dispatch, receipt identity, receipt privileges and daily quota. The inspection fixtures deliberately use a verified wrong recipient with the correct staff role and an unverified recipient with an unexpired token; unrelated guards cannot mask those checks.

Native races observe a competing transaction blocked before the first commits. They cover duplicate issue/accept, two academies competing for one recipient, resend/accept, both revoke/accept orders, issuer removal, owner withdrawal, recipient email changes, duplicate email preparation, rate-limited replacement rollback and revocation before delivery claim. The foundation also has `--falsify-recipient-lock`, previously verified to expose two successful conflicting admissions when that lock is removed.

Browser tests intercept all Supabase traffic with synthetic fixtures and reject unexpected endpoints. They exercise the real frontend/Auth SDK, including an Auth email fragment, password update, hydrated navigation, uncertain-send retries retaining the same request, and parsing an actual HTTP 502 function response. Mobile screenshots of activation/management were visually inspected. Public staff guidance was checked at small portrait, landscape and enlarged text sizes with reduced motion. These tests do not contact production or prove mailbox receipt.

The coach homepage still writes a legacy four-character invitation display code after activation. The browser fixture explicitly verifies that narrow write, user filter and JWT instead of hiding it behind a generic success response. Removing that path and child admission by shared codes remains the K-A/I-A household/roster cutover.

## Composition and release limits

Both SQL suites declare registry-compatible pragmas: `--staff-admission-review` and `--staff-delivery-review`, with `in-all=true`; the verdict helper is a fixture. When composing with Tarek's #42, retain its registry runner and discard this branch's hardcoded suite-array additions. The native concurrency script has its own explicit suite list. The earlier foundation alone was composed with #42 at `918d8c3` and passed five registered suites; the complete extension still needs current-head integration with #42, #44 and #47. Handwritten RPC types are supplied for this branch; regenerate/check the full merged API contract during integration.

Imad confirmed coach-only pilot match logging. Tarek owns retirement of UC-A02/UC-A03 and corresponding registry/test/documentation updates on a separate branch, preserving player/parent viewing checks. This PR does not silently change that registry or claim its pending failures are resolved.

Remaining release gates include a reviewed owner bootstrap, Auth redirect allowlist/email-template checks and a synthetic real-provider delivery smoke test; household waived enrolment, consent before child credentials, child session suspension, academy roster assignment, legacy caller removal and deliberate existing-identity migration. Existing staff are not auto-revoked or converted. Public player/parent provisioning remains pending household cutover. Complete-history account deletion and pending #44/#47/P2 composition need separate integration checks.

No production SQL, live Auth changes, email send, merge or frontend deployment has occurred. Keep #74 draft until independent review of this exact extension and the wider cutover are ready. Deploy migrations, function and frontend in a reviewed sequence; do not deploy the admission guard alone while legacy signup is still the live caller. Recovery is a reviewed forward fix preserving invitation/admission evidence, not reopening public-role or shared-code admission.
