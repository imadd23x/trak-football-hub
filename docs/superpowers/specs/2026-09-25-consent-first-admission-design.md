# Consent-first admission (J2 guardian invitation, J3 child activation)

Status: proposed 25 September 2026. Revised 26 September after Kostas's and
Tarek's reviews (both MERGE AFTER): no cascade on consent evidence, G2 in the
backend (#150), a named roster withdrawal, and the loader rails.
Decision: Imad, 25 September 2026 (TRAK-11, option B): build J2 and J3 as
MVP Requirements states them. The guardian is invited when the child is
admitted, the guardian consents before the child has an account, and only
then is the child invited.

Linear: TRAK-11 (J3), TRAK-9 (J2), TRAK-51 (delivery), TRAK-8 (J1 parent).

## Why this needs a design

Four facts on main `644caf2` and prod, read-only, 25 September:

1. Consent belongs to the child's account. `parental_consents.player_user_id`
   is `NOT NULL`, and `record_parental_consent`,
   `player_has_parental_consent(p_user_id)` and the G1 helpers all start from
   it. A guardian cannot consent for a child who has no account yet.
2. Nothing is sent at admission. `admit_roster_child` (#128) and
   `scripts/load-roster.mjs` write rows only. The one sender,
   `send-parent-invite`, runs as the child and mails the invitations the
   child's own signup created.
3. Slice 3 (#144) lets a rostered child create an account before any
   consent. That is stricter than before (roster only) but not J3.
4. G1: an unlinked roster row is writable without consent until #123
   (TRAK-14). No roster load on prod before #123 is live.

`send-parent-invite` delivers through Supabase Auth
(`auth.admin.inviteUserByEmail`, or a magic link for an existing account).
That already gives a one-use link with an expiry, so J3's "one-use
invitation, resend, expiry" needs no token table of our own.

## The flow after this work

1. The operator loads a child (`admit_roster_child`). Trak emails every
   roster guardian an invitation to sign up as a parent (J2).
2. A guardian signs up. Slice 3 already admits a parent whose confirmed email
   is on `roster_guardians` and claims those rows.
3. Parent home lists that roster child as waiting for approval, even though
   the child has no account. The guardian consents.
4. On the first active consent, Trak emails the child at the roster
   `child_email` an invitation to create their account (J3).
5. The child signs up. `provision_my_profile` admits them only with a
   roster match (slice 3) and active consent for that roster child, then
   carries the consent over to the new account.

A child aged 18 or over at admission (`consent_threshold_age()` is 18) needs
no guardian consent: step 4 happens at step 1. Every pilot child is under 18.

Accounts created before this work keep today's child-first path unchanged.
None of their consent rows move.

## Design, by phase

Each phase is its own PR with red-first tests and the full `ci.yml` job on
the tree merged with main. Phases 1 and 2 are database-only. The UI in
phase 4 can't ship before them.

### Phase 1: consent for a roster child before the account exists (Imad)

- `parental_consents` gains `roster_child_id uuid NULL`, a plain uuid with no
  foreign key, like `player_user_id` and `parent_user_id`. Consent is
  evidence and outlives the rows it names: `roster_children` cascades from
  `squad_players` and `organizations` (#128), so a foreign key with a cascade
  would silently delete consent records. What happens to consent evidence on
  erasure is a retention decision for counsel (TRAK-22), not a side effect of
  a key. `player_user_id` becomes nullable, with
  `CHECK (player_user_id IS NOT NULL OR roster_child_id IS NOT NULL)`.
  Readers that filter by `player_user_id` are unaffected: a null matches
  nothing. Whatever one-active-consent-per-guardian-and-child rule exists for
  `player_user_id` gets a matching partial unique index on
  `(roster_child_id, parent_user_id)`.
- New `record_roster_consent(p_roster_child_id, p_relationship, p_purposes,
  p_notice_version, p_consent_text)`, SECURITY DEFINER, for `authenticated`:
  - The caller must be a claimed guardian of that child
    (`roster_guardians.parent_user_id = auth.uid()`).
  - The child must be under the threshold, using the roster's date of birth.
  - The same purpose rule as `record_parental_consent` applies
    (`coaching_records` required).
  - It stores `player_age_at_consent` and `threshold_age` the same way.
  - It writes `p_relationship` to that guardian's
    `roster_guardians.relationship`, which #128 created to be confirmed by the
    guardian at consent, not trusted from the file.
- `get_children_awaiting_consent()` also returns roster children the caller
  guards that have no account and no active consent. The row carries
  `roster_child_id`, the child's first name and their age.
- When slice 3's `provision_my_profile` claims the roster row for the child,
  it sets `player_user_id` on that child's roster consents in the same
  transaction. From then on every existing reader, G1 policy and withdrawal
  path (TRAK-13, #112) works unchanged.
- Withdrawal before the child has an account: new
  `withdraw_roster_consent(p_roster_child_id)`, SECURITY DEFINER, for
  `authenticated`, with the same guardian check as `record_roster_consent`.
  It sets `withdrawn_at` on the caller's active roster consent for that
  child and deletes nothing. Phase 2 then refuses the child's signup. After
  carry-over, the existing `withdraw_parental_consent(p_player_user_id)`
  applies unchanged.

Tests (new suite, in `--all`):

- A guardian consents for an account-less roster child.
- A guardian of another child is refused, and so is an unclaimed guardian
  email.
- An adult child is refused (no consent needed).
- The consent carries over on the child's signup.
- A consent withdrawn before signup stays withdrawn after carry-over.
- `withdraw_roster_consent`: a guardian of another child is refused.
- Removing the roster row leaves the consent row in place.
- The existing consent suites stay green.

### Phase 2: a new under-18 child needs consent to sign up (Imad, on #144 and #150)

Slice 3's player branch adds one condition: when the roster child is under
the threshold, there must be an active, unwithdrawn roster consent with
`coaching_records`. Otherwise it raises `'Your parent or guardian needs to
approve first'` (42501), and `AuthContext` shows it the way slice 3 shows
"Your academy hasn't added this email yet".

Tests:

- Signup is refused before consent and after withdrawal.
- Signup is allowed after consent.
- An 18+ roster child is allowed without consent.
- An existing account repeating signup is unaffected.

### Phase 3: the two invitations (Imad; the loader hook is reviewed by Kostas)

- One edge function, `send-roster-invites`, with two entry points:
  - Operator (service role; the loader calls it after each successful
    `admit_roster_child`): invite every guardian of that roster child. The
    redirect is the parent onboarding route.
  - Guardian (caller JWT): invite the child of a roster child the caller has
    an active consent for. The redirect is the player onboarding route. The
    parent consent screen calls it right after `record_roster_consent`
    succeeds, and a "Send again" button calls it later.
- Delivery uses the same Supabase Auth calls as `send-parent-invite`
  (invite, or a magic link for an existing account).
- For resend and audit, `roster_guardians` and `roster_children` gain
  `invited_at timestamptz` and `invite_count integer`. No email addresses or
  provider responses go into logs. Both tables keep RLS on with no app-role
  grants: the function checks the guardian first, then writes these columns
  with its own service-role client. No grant is added.
- The loader (Kostas's decision, 25 Sep): per child, automatically, during
  the load, with these rails:
  - It calls the operator entry point right after each successful
    `admit_roster_child`, and never for a skipped row, so a resumed load
    never re-sends.
  - A failed send doesn't undo or stop the admission. It's printed by CSV
    line number, with no addresses, like today's errors.
  - The dry run prints how many guardians would be emailed before `--apply`.
  - `--no-invites` loads without emailing anyone, for practice and rehearsal
    loads. A synthetic roster always uses it.
- A wrong guardian address: the operator corrects it on `roster_guardians`,
  then calls the operator entry point for that one child to invite again.
- The email names the child's first name, the academy and the purpose, and
  carries the safe-sender line (J2).
- Delivery timing (under 60 s at Gmail and Outlook, not in spam) is TRAK-51,
  measured with approved inboxes after this phase.

Tests:

- Handler unit tests for both entry points: a non-guardian is refused, and
  a guardian without active consent can't invite the child.
- The loader calls the function once per admitted child and never for a
  skipped row. `--no-invites` calls it zero times, and a failed send leaves
  the admission in place.

### Phase 4: screens (split between Tarek and Imad)

- **Tarek (G2 reservation):** player onboarding for a rostered child drops
  the guardian-email step. Guardians come from the roster, never from the
  child. The backend half is Tarek's #150 (TRAK-18, stacked on #144), which
  lands before this phase:
  - `create_parent_invite` refuses a rostered child (claimed, or matched by
    confirmed email before the claim) any address the roster doesn't name as
    their guardian (42501).
  - `provision_my_profile` ignores a rostered child's `parent_email` unless
    the roster names it.
  - The roster's own guardian address stays allowed, so today's invitation
    email keeps working until phase 3 replaces it.
- **Imad:**
  - Parent home and the consent screen list account-less roster children as
    waiting and call `record_roster_consent`.
  - After consent: "We've emailed {first name} an invitation to join", with
    "Send again".
  - The player's refusal copy from phase 2.

Routed tests:

- A parent sees and approves an account-less child.
- The child invite is requested once.
- A rostered child's signup has no guardian step.

## Boundaries

- Always: fail closed. An unreadable consent state means no signup and no
  invite.
- Always: never store child or guardian emails in logs, Slack or Linear.
- Ask first: any change to how existing (pre-roster) accounts consent.
- Ask first: sending real email to anything other than approved test inboxes.
- Never: let a child choose or change a guardian email (G2), on screen or
  through the API. A rostered child's guardians come only from
  `roster_guardians`. The negative API test is
  `supabase/tests/g2_roster_guardian_authority.sql` (#150): a rostered child
  can't invite an adult of their choosing, directly or through the signup
  payload, and that adult can't link or consent.
- Never: invite a child before active consent (unless 18+).
- Never: a foreign key or cascade that can delete a consent record.

## G1 interaction

With #123 an unlinked roster row stays closed to coach writes. A consented
child who hasn't activated yet can't be assessed until they sign up. That's
acceptable for the pilot: the invitation goes out the moment consent is
given. A later change can let `squad_player_consent_required` read the roster
consent for unlinked rows if coaches need to record before activation.

## Decided in review (Kostas and Tarek, 25–26 September)

1. The child invitation goes automatically on the first consent.
2. Both guardians are invited at admission, and either can consent (the
   first consent is enough, today's rule).
3. `load-roster.mjs` invites per child during the load, with the rails in
   phase 3 (Kostas's call).
