# Audited correction of a roster email (J3, G5)

Status: proposed 1 October 2026, for Imad's approval, then a non-author
review (Kostas, as the operator, or Tarek).
Linear: TRAK-11 (J3 acceptance: "concierge correction records actor and
time"), TRAK-16 (G5: "correction is controlled and auditable").

## Why

MVP Requirements J3: "If an address is wrong, Trak corrects it by hand and
records who changed it and when." G5: no message about a child goes to the
wrong adult.

On main `07bdc3f` (read 1 October) there is no way to do that. Nothing
changes `roster_guardians.email` or `roster_children.child_email` after the
load, there is no audit table, and `docs/pilot-runbook.md` doesn't cover a
wrong address. Today a correction would be hand-written SQL with no record.

A guardian is linked to a child by their **confirmed email matching the
roster email** (`rg.email = v_email` in the claim functions). So the roster
email is the key to the child. Changing it is a security action, not a typo
fix.

## What we build

1. **`public.correct_roster_email(p_roster_child_id uuid, p_kind text,
   p_old_email text, p_new_email text, p_corrected_by text, p_reason text)`**:
   `SECURITY DEFINER`, executable by `service_role` only (the operator).
   `p_kind` is `'guardian'` or `'child'`. It refuses, with a plain error:
   - an unknown child, or an old email that isn't on that child (no matching
     by name);
   - **a guardian who has already signed up** (`parent_user_id` set) or **a
     child who has already signed up** (`player_user_id` set). Someone has
     claimed the address, and moving a claimed account is an incident for
     the founders, not a correction;
   - a child with no email (TRAK-84 username children; out of scope);
   - a new email that is malformed, or the same as the old one after
     normalising;
   - a new email already on that child: a guardian address can't equal the
     child's or another guardian's, and the child's can't equal a guardian's;
   - a blank `p_corrected_by` or `p_reason`.
2. **In one transaction** it normalises and saves the new email, clears
   `invited_at` (so the next `--reinvite` reaches the new address; the
   `invite_count` history stays), and writes one audit row.
3. **`public.roster_email_corrections`** (audit): `id`, `roster_child_id`,
   `kind`, `roster_guardian_id` (null for a child), `corrected_by`,
   `corrected_at` (`now()`), `reason`, `old_email_sha256`,
   `new_email_sha256`, `was_invited` (an invitation had already gone to the
   old address). RLS on with no policies, so only `service_role` reads it.
   It stores **hashes, not the addresses** (SHA-256 of the normalised
   address, hex): the current row holds the new address, and the hash proves
   which old value was replaced without keeping a wrong person's address.
   Rows cascade with the roster child, like every roster reference, so erasing
   a child erases their corrections too.
4. **`scripts/correct-roster-email.mjs`**, the same rails as the loader:
   `--roster-child <uuid> --kind guardian|child --old <email> --new <email>
   --by <name> --reason <text>`, a dry run by default, `--apply` to write,
   the secret key and `TRAK_CONFIRM_HOST` guard. It prints ids and counts,
   never addresses. **It sends nothing.** It prints the next step: re-invite
   that child.
5. **Runbook:** a "Wrong address" section in `docs/pilot-runbook.md`, with
   the dry run, apply and re-invite steps. If `was_invited` is true, an
   invitation reached the wrong adult: record it on Linear as a G5 near-miss.
   After the correction, that address can no longer claim the child.

## Tests (red first)

Database (the existing `test-db` harness, under real roles):

- corrects an uninvited guardian: new email saved, audit row has the actor,
  time and reason, and `invited_at` is null;
- corrects an invited guardian: `was_invited` is true and `invited_at` is
  cleared;
- **G5 negative:** after the correction, an account at the old address
  can't claim the child through the existing claim path;
- refuses a linked guardian, a signed-up child, a wrong old email, a
  collision, a no-email child, and a blank actor or reason;
- refused for `anon` and `authenticated` (permission denied); the audit
  table can't be read by them.

Script (vitest): argument parsing, the dry run writes nothing, no address
appears in the output.

## Boundaries

- **Always:** `service_role` only; one transaction; no addresses in logs,
  Slack or Linear; a new migration (never edit an existing one).
- **Ask first:** sending the invitation automatically after a correction.
  The default is no: the operator re-invites as a separate, visible step.
- **Never:** move an account that has already been claimed; delete Auth
  users; change consent rows.

## Order and coordination

- Migration `20261001120000_roster_email_correction.sql`, after #205
  (`20260930090127`) and Kostas's planned `20261001100000` (#201). It
  creates new objects only and redefines nothing those touch.
- New files only, apart from one new runbook section, so no overlap with
  #201/#202/#204 (`scripts/load-roster*`). Announce in
  #coding-agents-at-work before writing the migration.

## Done when

- The tests above fail on main and pass with the change. The full `ci.yml`
  test job passes on the tree merged with current main.
- On prod after deploy: the function exists, only `service_role` can execute
  it (`has_function_privilege`), and the audit table has RLS with no
  policies.
- Kostas runs one dry run on prod against a synthetic rehearsal row.
