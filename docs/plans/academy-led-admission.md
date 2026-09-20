# Academy-led admission — controlling signup requirement

Decision: Imad's September 20 clarification makes the section **“Trak Architecture for Academy, Coach, Player, and Parent Sign Up”** in `trak_use_cases_and_testing.md` authoritative for signup and invitations. Conflicting observations elsewhere in that document must not drive implementation. This supersedes the earlier decision to defer the payment/household/child-username architecture. Unrelated testing observations remain in scope.

## Required flow

1. Platform owners provision academy administrators and send single-use activation links. There is no public administrator self-registration.
2. Academy administrators invite coaches by email. Activation uses an expiring, single-use token bound to the recipient, role and academy. A coach cannot self-select an academy or join by a shared code.
3. For this pilot, an academy-approved, fully waived enrolment establishes eligibility, provisions one household account and sends its single-use activation link. Collect the parent's name/email and children's names/DOBs without payment details. The household uses one shared login, as requested. Public parent/player self-registration is replaced.
4. The household must complete the consent gate before accessing the ordinary dashboard or creating a child's login. The parent creates a child username/password; a child email is not required.
5. The academy assigns eligible, consented children to coaches. Coaches select stable player identities from their assigned academy roster; arbitrary name-only development profiles are not admitted.
6. Consent withdrawal suspends the affected child's access. This must apply to existing sessions and backend operations, not only the sign-in screen. Access also requires valid academy enrolment. Preserve records and decision history according to the separately reviewed retention requirements. There is no payment-lapse condition in this free pilot.

## Resolved pilot enrolment decision

Imad confirmed: **“Full waived academy enrollment. No payments later, the pilot is simply to collect data/feedback.”** The entire pilot is free. There are no deferred charges, payment details, billing provider integration, payment webhooks or automatic conversion to a paid plan. Do not build a “charge later” path. Academy approval of the waived enrolment replaces the document's payment trigger for the pilot; all household activation, consent, child credentials and academy assignment requirements still apply. Future commercial billing requires a separate instruction and is not assumed here.

## Current implementation and implications

- `src/pages/OnboardingPage.tsx` currently offers player/coach/administrator public signup through `AuthContext.signUp`. PR #73 corrects its misleading responses, but does not implement the new admission architecture. Hold it as a draft/transitional fix until its role in the cutover is reviewed.
- `public.provision_my_profile(jsonb)` currently accepts a role from the onboarding payload and handles optional academy-code joining. Replacing the page alone would leave this API path available; provisioning must require server-issued admission authority.
- `ParentOnboarding.tsx`, `parent-invites.ts` and `send-parent-invite` currently support player-originated invitations to independently authenticated parents. That is a legacy path, not the target household activation mechanism.
- `CoachAddPlayer.tsx` currently creates roster entries from coach-entered details. It must consume academy-approved registrations and assignments instead.
- Draft #70 and fork #3 provide useful academy/purpose consent enforcement and concurrency evidence, but assume independent guardian identities and player accounts. Reconcile them with household authority and staged child registration before any release. Do not treat a shared password as proof of which adult acted; consent records need the named guardian's attestation plus the authenticated household and immutable event history.
- Existing child/parent/coach histories must survive the transition. Do not auto-merge households or reassign child records using names or unverified email matches.

## Implementation sequence and acceptance

1. Define admission states and server authority: owner/academy staff invitation, household eligibility/activation, child registration, consent and squad assignment. Keep minimal registration data separate from development access. Test that callers cannot forge roles, academy IDs, waived-enrolment approval or assignments.
2. Implement staff invitations and remove public coach/admin provisioning. Test recipient verification, expiry, single use, repeat clicks, wrong-role sessions and cross-academy attempts using real database roles and intercepted browser journeys.
3. Implement academy-approved waived enrolment and household activation. Only the authorised academy may approve enrolment; public forms, redirects or client-supplied eligibility flags cannot grant access. Deduplicate enrolment/activation requests and exercise duplicate, delayed and failed requests. One eligible household can have multiple children without duplicate accounts. Collect no payment details and schedule no charges.
4. Implement household consent and child credential creation/recovery. Test the required consent gate, independent child credentials, absence of child email, parent-managed reset, wrong-household denial and withdrawal/enrolment-revocation effects on already issued sessions. Resolve any multi-academy suspension ambiguity explicitly before coding that branch.
5. Implement academy assignment and coach selectors. Test that only eligible children appear, another academy cannot assign/read/write them, reassignment preserves history and departed coaches lose access.
6. Migrate existing users deliberately and replace legacy routes/callers. Test all four roles with two academies, multiple children and shared devices; preserve private/shared feedback boundaries and history. Remaining non-auth observations in the testing inventory stay active.

## Rollout and recovery

All implementation stays fork-first in focused task branches with regression tests. Review schema, callers, identity migration and generated types together. Use disposable databases and synthetic accounts for development. Require independent review and explicit approval for production changes. Retain audit/history data; recover using reviewed forward changes without reopening revoked access. A green transitional signup PR is not evidence that academy-led admission is complete.
