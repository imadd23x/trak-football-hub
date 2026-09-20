# Household admission and academy assignment contract — review draft v1

Status: proposed interface for I-A / K-A / T-V review, September 20, 2026. This is a handoff specification, not implemented functionality, owner acceptance, or production approval. It supplements [the three-owner plan](user-testing-work-allocation-2026-09-20.md). Main rechecked at `4335e8984777b7b704e8706d3fe277352658c9ed`; staff draft #74 at `c910829`; consent foundation #70 at `8467ecd`, read/write cutover fork #3 at `9ced1cd`.

## 1. Why the existing drafts need adaptation

The required order is academy-approved fully waived enrolment → one shared household login → academy-specific consent → child username/password → academy squad assignment. There are no payments, deferred charges or child email requirements.

The current consent draft reverses part of this order. `20260919202324_academy_consent_authority.sql` requires `player_parent_links`, a player profile/DOB and a `squad_players` association before granting consent (lines 206–218). `has_guardian_approval` also depends on those authenticated child records. Consent therefore cannot currently precede account creation and assignment. Its current-decision key is `(player_user_id, organization_id, parent_user_id)`, which assumes each guardian has a different authenticated account. A shared household needs explicit signer attribution without pretending a shared password authenticates an individual adult.

The read/write cutover already supplies useful academy provenance, purpose checks, append-only evidence and withdrawal concurrency tests. Adapt that system; do not introduce a parallel consent flag. Its existing player-owned match-write branch must also be removed for the confirmed coach-only pilot.

## 2. Stable identity before credentials

**Proposed invariant:** reserve a server-generated UUIDv4 when a child registration is approved. That UUID is the stable `child_id` and is later passed as the child's Auth user ID. It is not a squad row ID. No child Auth account, public player profile or development roster row is needed to collect the household's consent.

Supabase documents a custom UUIDv4 `id` for `auth.admin.createUser`; the repository's installed `AdminUserAttributes` also exposes `id?: string`. See [Supabase Auth migration FAQ](https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0). This is documentation/SDK evidence, not verification against our hosted Auth deployment. A synthetic Auth integration test must establish that the returned user ID equals the reservation before consumers rely on it.

Once credentials are activated: `child_id === auth.users.id === profiles.user_id === squad_players.linked_player_id`. Existing `squad_players.id` remains the assessment foreign key, as today. Keep existing player IDs for reviewed legacy adoptions; never mint a replacement identity for an existing child merely to fit the new flow. Do not auto-merge on name, DOB or email.

Private admission records, with RLS and no client table writes:

| Record | Authority and minimum meaning |
|---|---|
| Household | Stable household ID, exactly one active verified parent Auth login, activation/recovery status. Current household access is derived from server records, not editable user metadata. |
| Registered child | Stable UUID, household ID, name and validated DOB; credential state separate from registration state. DOB corrections require a controlled path that reevaluates age/consent. |
| Academy enrolment | Stable enrolment ID, child ID, academy ID, pending/approved/revoked state, revision and approval provenance; approved pilot enrolment is fully waived. |
| Activation/credential operation | Recipient/household/child-bound request and attempt IDs, status and safe recovery evidence. No passwords or raw tokens in stored payloads, logs or audit records. |
| Guardian attribution | Stable signer key, named adult/relationship attestation, authenticated household actor and provenance. It must distinguish historical independently authenticated guardians from shared-household attestations. |

These are responsibilities, not permission to create competing table layouts. I-A owns their SQL definitions and generated client types.

## 3. Intake and household activation

1. Preserve the architecture's parent registration intake: parent name/email, each child's name/DOB and the named academy. An academy-specific public intake form may submit a **pending application** only. It cannot create roles, approve enrolment or reveal other applicants. Academy-entered applications use the same approval contract.
2. Only the current authorised administrator of that academy can approve fully waived enrolment. The server binds the academy and approved child records; no client `approved`, `role`, `organization_id` or payment field grants authority.
3. Approval prepares one recipient-bound household activation with expiry, revocation and explicit replacement. Repeated exact requests return their existing operation; different payloads using the same request ID fail. Delivery accepted, failed and uncertain are distinct; uncertain delivery never triggers an automatic second invitation.
4. New recipients verify email and set the shared household password. Existing authenticated parent recipients confirm the account explicitly; do not overwrite an existing password. A different-role account receives a truthful conflict/recovery path, never automatic role conversion. Account changes during a request invalidate that UI operation.
5. An existing household requesting another academy must identify its existing child through its authenticated household flow. Matching a pending applicant's name/DOB/email alone cannot attach a child or household. No second shared login is created for a second academy.
6. Household activation allows the consent/admission and account-recovery screens. Ordinary development screens remain unavailable until the required approval exists. Minimal registration records are not permission to create coaching data.

Proposed partial-family behavior for review: one child with valid approval can remain usable while a sibling/new academy is pending. Pending children expose only enrolment/consent tasks and no development records. If no child is eligible, the ordinary dashboard stays gated. This must be explicit in the UX tests rather than inferred from an empty roster.

## 4. Adapt the existing consent authority

Consent eligibility comes from the **approved child enrolment and authenticated household authority**, not an already assigned squad or child Auth profile. Use registration DOB with the existing UTC age rules. The server selects the enabled, approved notice for the exact academy; retain notice version/controller, exact purposes, signer attestation, household actor, timestamp and request provenance in immutable events.

Retain these agreed rules:

- Another eligible guardian's approval can keep the named academy's processing active when one withdraws.
- One eligible guardian's parent-visibility choice applies to all currently authorised linked parents for that academy; it does not publish private notes or AI drafts.
- A grant to academy A never grants academy B. Changed notices, removed authority, enrolment revocation and age transitions must reevaluate current access.
- Historical independent-guardian events remain immutable evidence. They are not silently converted to approval for a new academy or newly attested household signer.
- A shared household login establishes the account actor, not which adult used the password. Record the named signer as an attestation with its actual assurance. Do not label that person independently authenticated.

**Review item:** extend current decision identity to a stable guardian/signatory key while retaining the existing `parent_user_id` actor on historical events. I-A will provide the schema evolution and compatibility adapter; T-V must verify two signers' decisions cannot accidentally overwrite each other, replay cannot impersonate another signer, and old authenticated-guardian authority is not silently discarded. No automatic creation of arbitrary signers to manufacture continued consent. The permitted signer-enrolment and correction workflow must be specified in that implementation review.

Keep request UUID/payload matching, expected-event conflict detection, append-only events and the child/academy scope revision. A retry returns the prior outcome plus current eligibility; it cannot reinstate a grant after withdrawal. Withdrawal of existing authority must remain possible even when roster or enrolment access has disappeared.

**Open product decision, already asked of Imad:** if A's last approval is withdrawn while B remains approved, should the child's login continue for B or be suspended globally? Do not infer an answer. Academy A's records must become inaccessible immediately in either case. Hold only the global-login decision dependent implementation; the academy-local denial and registration contract can be reviewed now.

Unknown/future DOB cannot bypass consent. At age 18, guardian authority is no longer a substitute for the adult player's choices; the existing draft's adult optional-purpose work remains an explicit release requirement. Do not silently restrict the agreed platform to minors or let optional recognition/parent sharing default to approved.

## 5. Child username/password and recovery

Use Supabase Auth for passwords and sessions. It supports email/phone password login, not a native username field ([official password sign-in reference](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)). Proposed adapter: private globally unique canonical username → reserved child ID and opaque internal Auth identifier. The child supplies only username/password; no real child email is required or displayed. Agree a username grammar once in I-A's boundary schema; consumers must reuse it.

Credential creation/reset is a server operation authorised by the current household and current enrolment/consent. Bind it to a child and operation ID; rate-limit lookup/login/reset, use generic unauthorised login errors, never log credentials, and do not put service credentials in the browser. Username possession alone grants no authority.

Auth API and Postgres are not one transaction. The adapter must:

- Reserve the child/username and claim the exact operation under database locks.
- Call Auth with that reserved child UUID; check the returned identity, and reject any unrelated conflict rather than adopting it.
- Finalise only after rechecking household/enrolment/consent and the operation attempt. A created-but-unfinalised Auth account has no application access.
- Recover a timeout by inspecting the same claimed operation/identity. Do not create another child, overwrite an unknown account or persist the password for retries. Give an explicit reset/recovery action when the password outcome cannot be proven.
- Handle withdrawal/revocation during creation and password reset. Existing tokens must not bypass the resulting admission or session-generation check. Parent-managed reset must not reset the household password or another child's credentials.

Reuse #74 account-bound request handling and #71 password controls. Parent screens own credential status/recovery; academy roster responses never expose usernames, passwords, Auth transport identifiers or activation tokens.

## 6. K-A consumer and assignment interface

Proposed public RPC names below are reserved for review, not existing APIs. I-A supplies typed contracts and synthetic fixtures before K-A implements consumers.

| Boundary | Writer | Proposed contract |
|---|---|---|
| `get_my_household_admission()` | I-A | Current verified household, children and per-academy enrolment/consent/credential states; no ordinary development payload. Account-scoped query/cache keys. |
| `get_academy_consent_context` / grant / withdraw | I-A | Adapt existing checked wrappers to registered child + academy + signer provenance, preserving request/revision behavior. Do not create an alternative boolean consent endpoint. |
| `list_assignable_academy_children` | I-A | Current academy admin only; cursor-paginated minimum roster data and readiness revision. Exclude pending/revoked/unconsented children. |
| Private assignment eligibility/lock helper | I-A | Revalidate current academy authority, approved enrolment, credentials and effective coaching approval at write time; no client-supplied eligibility. Shared with revocation/consent writers. |
| `assign_academy_children` | K-A | Request ID, coach ID and bounded list of stable enrolment/child IDs + expected revisions. Derive academy from verified current authority; invoke I-A's helper; return typed per-item outcomes. |

Minimum eligible row: `enrolment_id`, `child_id`, `organization_id`, approved display name, agreed age-group/position fields (unknown remains unknown), `eligibility_revision`, and current assignment identifiers where the caller may see them. `player_user_id` equals `child_id` only after credential finalisation. No parent contact details or consent wording in roster lists. `squad_player_id` is a separate output after assignment.

Kostas owns `ClubSquads`, approved/unassigned lists, coach selectors, assignment RPC and assignment-specific migrations. He does not create household/consent tables or a new child identity. Current `ClubHome`/`ClubProfile`/`ClubCoaches` staff-invitation hunks remain I-A-owned until handoff.

Single/bulk assignment must recheck after waiting for locks, return an honest outcome for every requested item and never claim an uncommitted assignment succeeded. Duplicate items and exact request retries must not create duplicate roster rows. Request-ID payload conflicts fail. Publish whether a batch uses one atomic commit or per-item transactions before coding; both must preserve per-item evidence and same-request recovery. UI selection is only a proposal, never eligibility evidence.

I-A and K-A must agree one lock order across child/academy scope, enrolment, household/guardian authority and roster writes. Existing triggers acquire other locks too: review the actual call graph and run native overlapping transactions rather than assuming a sorted loop prevents deadlocks. Test assignment versus withdrawal, removal, coach departure and retry. A replay may report the old committed assignment while reporting that access is now revoked; it must not restore eligibility.

Reassignment must preserve old history and remove departed coach access. Do not overwrite historical academy/coach provenance to move records into a new academy. Existing legacy squad IDs referenced by assessments require an explicit reviewed adoption/mapping, not delete-and-recreate.

**Confirmed pilot rule, September 20:** academy data stays with the academy after coach departure. This includes session plans and calendar events as well as roster/development records, notes and attendance. Former authors have no continuing read/write/export entitlement through an old JWT, account export, reassignment or joining another academy. Preserve historical academy attribution and the authorised academy's operational access; retain private notes without automatically publishing them or widening administrator access. Personal account export remains separate, and consent/retention boundaries still apply. See the [verified gaps and single-writer handoff](../reviews/coach-departure-ownership-2026-09-20.md); existing departure policies alone do not satisfy this rule.

## 7. Cutover surfaces and single writers

- **I-A:** `AuthContext`, `src/components/layout/RouteGuard.tsx`, onboarding/callback/recovery/household routes and libraries; `trak_admission`, `trak_consent`, generated types and shared App integration. Replace public parent/player provisioning in `provision_my_profile`, old parent invitation creation/accept/resend/autolink and `link_player_to_coach` authority. Inspect all callable overloads and triggers, not just the routed page.
- **K-A:** retire coach-created name-only roster admission and its direct-write/API paths; replace `CoachAddPlayer` with the reviewed assignment experience. I-A supplies guards/eligibility where shared. Preserve UC-C02 history, add positive eligible-assignment and negative old-path regressions.
- **K-C:** coach-only match/session writes, manual minutes 0–120, goals/assists 0–10, history/private notes and recovery. Reuse #51 rating keys; fix #76's attacker `2+` mismatch without changing weights.
- **T-D:** retire UC-A02/A03 in its already released separate task, retain player/parent read journeys and band display, integrate shared stats/calendar/export consumers. No new player logging routes.
- **T-V:** SQL registry, actual-role and service/AI bypass tests, household/child deletion/export/storage verification. Coordinate #40/#44/#47 implementation owners instead of duplicating their functions.

Every backend development read/write, privileged RPC, AI request, export and Storage access must use current authority. UI redirects, JWT metadata or Auth bans alone are not proof that already-issued access tokens are denied. Preserve consent-purpose and private/publication boundaries throughout caching and account/academy switching. Old parent/child links cannot independently grant admission after cutover.

## 8. Sequenced implementation and proof

| Stage | Owner / dependency | Observable acceptance |
|---|---|---|
| H0: contract review | Imad publishes; Kostas K-A and Tarek T-V respond with exact conflicting branches/files | Accepted IDs, DTOs, assignment semantics and signer workflow; record unresolved product decision separately. No parallel schemas. |
| H1: registration/enrolment authority | I-A, based on reviewed #74 + reconciled #70/fork #3 | Pending intake cannot self-approve; wrong academy/role denied; approved waived sibling enrolments share one household; retries/conflicts tested. |
| H2: pre-Auth consent | I-A; T-V independent review | Consent succeeds for registered child before Auth/squad, optional false remains false, two signers and two academies, preserved legacy evidence, stale/replay/withdrawal races. |
| H3: credentials and route gate | I-A after H1/H2 | Parent creates username/password with no child email, exact reserved UUID, retry/failure/recovery, shared-device account switch, expired/replaced activation, no access before finalisation. Test actual Auth adapter with synthetic accounts in an isolated environment. |
| H4: assignment and legacy retirement | K-A after accepted interface/fixtures; K-C/T-D consume | Eligible single/bulk assignment, unchanged stable identity/history across roles, direct legacy/manual/API denial, reassignment/departure/races. |
| H5: integrated release candidate | I-R with all owners/T-V | End-to-end owner→academy→coach and academy→household→consent→child→assignment→coach log→player/parent read; withdrawal against an already issued session; deletion/export/AI/storage and CAP-01. |

For SQL: disposable role-aware tests, fresh and released-main upgrade replay, the existing suites, and native concurrent connections that actually overlap. Mutations must demonstrate critical denials/positive controls detect a removed guard. For UI: routed production-build browser journeys, genuine SDK error shapes, truthful loading/error/partial-save states, two households/two children/two academies and refreshed sessions. Tests accompany each fork commit; green local mocks do not establish email delivery, hosted Auth or production readiness.

H0 deliverable is this document and owner reconciliation. It does not block already accepted independent tasks or reopen completed fixes. H1/H2 schema work starts only after the affected-owner boundary review; H3's global-suspension branch additionally waits for Imad's outstanding answer.

## 9. Rollout and recovery

Keep focused fork branches, draft PRs and exact-head independent review. No production merge, Auth mutation, real-child enrolment, email template change or live database operation is authorised by this plan. Before a production request, reconcile the complete dependency graph and supply the tested candidate, forward migration order, notices/academy configuration, legacy adoption manifest, support/restore evidence and synthetic runtime results.

Legacy adoption maps explicit existing IDs and parent authority with reviewable evidence. Ambiguous names/emails stay unresolved; never guess links or fabricate historic consent. Preserve append-only decisions, provenance and history according to the reviewed retention/export/erasure policy.

Before deployment, discarded draft code can be reverted normally. After migrations or invitations exist, recover by stopping new admission and repairing forward while preserving evidence. Do not roll back by restoring public self-enrolment, coach-created children or withdrawn access. Keep already-approved academy access consistent with the resolved multi-academy decision.
