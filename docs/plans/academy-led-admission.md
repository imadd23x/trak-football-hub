# Academy-led admission — controlling signup requirement

Decision: Imad's September 20 clarification makes the section **“Trak Architecture for Academy, Coach, Player, and Parent Sign Up”** in `trak_use_cases_and_testing.md` authoritative for signup and invitations. Conflicting observations elsewhere in that document must not drive implementation. This supersedes the earlier decision to defer the payment/household/child-username architecture. Unrelated testing observations remain in scope.

## Required flow

1. Platform owners provision academy administrators and send single-use activation links. There is no public administrator self-registration.
2. Academy administrators invite coaches by email. Activation uses an expiring, single-use token bound to the recipient, role and academy. A coach cannot self-select an academy or join by a shared code.
3. An academy enrolment/payment page collects the parent's name/email and children's names/DOBs. A verified successful payment webhook establishes eligibility and provisions one household account, then sends its single-use activation link. The household uses one shared login, as requested. Public parent/player self-registration is replaced.
4. The household must complete the consent gate before accessing the ordinary dashboard or creating a child's login. The parent creates a child username/password; a child email is not required.
5. The academy assigns eligible, consented children to coaches. Coaches select stable player identities from their assigned academy roster; arbitrary name-only development profiles are not admitted.
6. Consent withdrawal or payment lapse suspends the affected child's access. This must apply to existing sessions and backend operations, not only the sign-in screen. Preserve records and decision history according to the separately reviewed retention requirements.

## One immediate product question pending

The pilot was previously free, while the now-controlling architecture requires payment before household activation. Imad has been asked whether the pilot should use an explicitly academy-approved, fully waived enrolment through the same activation/consent flow, or require an actual successful payment. Neither is assumed approved while the answer is pending. Implementation of payment-dependent admission waits for that answer; recipient-bound staff invitations, household/child boundaries and roster design can proceed independently.

The reference to Stripe is an example, not a selected provider, merchant account or charge authorization. No real charges, provider changes or production migrations are authorized merely by this document.

## Current implementation and implications

- `src/pages/OnboardingPage.tsx` currently offers player/coach/administrator public signup through `AuthContext.signUp`. PR #73 corrects its misleading responses, but does not implement the new admission architecture. Hold it as a draft/transitional fix until its role in the cutover is reviewed.
- `public.provision_my_profile(jsonb)` currently accepts a role from the onboarding payload and handles optional academy-code joining. Replacing the page alone would leave this API path available; provisioning must require server-issued admission authority.
- `ParentOnboarding.tsx`, `parent-invites.ts` and `send-parent-invite` currently support player-originated invitations to independently authenticated parents. That is a legacy path, not the target household activation mechanism.
- `CoachAddPlayer.tsx` currently creates roster entries from coach-entered details. It must consume academy-approved registrations and assignments instead.
- Draft #70 and fork #3 provide useful academy/purpose consent enforcement and concurrency evidence, but assume independent guardian identities and player accounts. Reconcile them with household authority and staged child registration before any release. Do not treat a shared password as proof of which adult acted; consent records need the named guardian's attestation plus the authenticated household and immutable event history.
- Existing child/parent/coach histories must survive the transition. Do not auto-merge households or reassign child records using names or unverified email matches.

## Implementation sequence and acceptance

1. Define admission states and server authority: owner/academy staff invitation, household eligibility/activation, child registration, consent and squad assignment. Keep minimal registration data separate from development access. Test that callers cannot forge roles, academy IDs, payment status or assignments.
2. Implement staff invitations and remove public coach/admin provisioning. Test recipient verification, expiry, single use, repeat clicks, wrong-role sessions and cross-academy attempts using real database roles and intercepted browser journeys.
3. Implement idempotent enrolment and household activation after the pilot decision. Authenticate webhook signatures and deduplicate event/enrolment IDs; a return URL alone cannot grant access. Exercise duplicate, delayed, out-of-order and failed requests. One eligible household can have multiple children without duplicate accounts.
4. Implement household consent and child credential creation/recovery. Test the required consent gate, independent child credentials, absence of child email, parent-managed reset, wrong-household denial and withdrawal/payment-lapse effects on already issued sessions. Resolve any multi-academy suspension ambiguity explicitly before coding that branch.
5. Implement academy assignment and coach selectors. Test that only eligible children appear, another academy cannot assign/read/write them, reassignment preserves history and departed coaches lose access.
6. Migrate existing users deliberately and replace legacy routes/callers. Test all four roles with two academies, multiple children and shared devices; preserve private/shared feedback boundaries and history. Remaining non-auth observations in the testing inventory stay active.

## Rollout and recovery

All implementation stays fork-first in focused task branches with regression tests. Review schema, callers, identity migration and generated types together. Use disposable databases and synthetic accounts for development. Require independent review and explicit approval for production changes. Retain audit/history data; recover using reviewed forward changes without reopening revoked access. A green transitional signup PR is not evidence that academy-led admission is complete.
