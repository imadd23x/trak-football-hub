# What Friday's demo would lose if it ran today

| Document control | Value |
| --- | --- |
| Prepared | 19 September 2026, against `main` at `06684bb` |
| Gate | *"Demo: U1–U10 together, two academies, four roles and two phones… **Every shown capability must pass; unresolved failures remove that capability from the demonstration.**"* |
| Method | Each item checked against the code on `main`, not against notes or PR descriptions |

The plan's own rule is the useful frame: a failing item does not fail the demo,
it **removes that capability from it**. So this lists what comes out.

**Six days to the 25th. Nothing below needs new code that has not already been
written — it needs merges and two console actions.**

---

## First: there are three different "Gate 1"s, and the team is tracking the wrong one

- `docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md` defines **Gate 1**
  as eight security jobs and says *"Gate 1 is not cuttable."*
- `docs/pilot-readiness-2026-09-25.md` defines a **Demo gate** (U1–U10) and a
  separate **real-child gate** (seven bullets).
- The eleven-box checklist that has been quoted in `#coding-agent-reviews` all
  week — including by me — **is in neither document.** I have been tracking a
  list I assembled, and presenting it as the gate.

That is worth correcting before anyone plans Friday against it. The rest of this
document uses the two definitions that are actually written down.

## The demo gate, item by item

| | Capability | State on `main` | What closes it |
| --- | --- | --- | --- |
| **U1** | UAE coach adds five players, assesses three, logs a match — facts, errors, **timing** | ⚠️ facts and errors largely fixed; **timing unresolved** | see #60 — the bar measures setup and loop together |
| **U2** | Player adopts a roster row with prior assessments, no duplicates or lost history | ⚠️ works on an exact name; a misspelling silently loses history | #45 (tells the player), #34 (duplicate-link race) |
| **U3** | Ages 17/18 GR/AE, missing age, consent grant/withdrawal/**purposes**; **direct API bypass denied** | 🔴 **fails, three ways** | see below |
| **U4** | Parent accepts a second child and switches across six screens | ⚠️ unverified by me | #49, #50 |
| **U5** | Player/parent cannot retrieve private notes by direct query | 🔴 readable until K9 lands | #44 |
| **U6** | AI draft unreadable before approval; coach approves; child reads approved version | 🔴 **no approval step exists on `main`** — zero `player_feedback` tables | #40 |
| **U7** | Academy B cannot read or mutate academy A, including guessed IDs | ✅ **passes** — verified both directions, live and replayed | done |
| **U8** | Removed/transferred coach loses former-academy access | ✅ **passes** | done |
| **U9** | Offline/failed shows retry; token refresh preserves forms; wrong-account races | ⚠️ offline done (#30); account races in #48 | #48 |
| **U10** | All four roles delete; retained/orphaned data **and avatar handling** | 🔴 club admin cannot delete; **avatars unresolved** | #34 or #44 for deletion; **F-3 has no PR** |

**Two of ten pass outright. Three fail. Five are written and waiting to merge.**

### U3 is the one to look at, because it is the child-safety item

*"consent grant/withdrawal/**purposes**; direct API bypass attempts denied"* — all
three clauses fail, and each is evidenced on a replayed database in #53:

1. **Purposes are never checked.** `player_has_parental_consent()` is
   `EXISTS(… withdrawn_at IS NULL AND superseded_by IS NULL)`. A consent record
   with **every purpose false** opens the gate. The UI prevents it by disabling
   a checkbox; `record_parental_consent` is granted to `authenticated`, so the
   checkbox is the only thing enforcing it.
2. **Unlinked roster rows are ungated.** A coach-typed child has no date of
   birth, so the gate cannot evaluate them and permits the write.
3. **Records predating consent survive.** When the child later links, everything
   written while nobody could check consent becomes part of their record.

"Direct API bypass attempts denied" is the clause that makes this fail rather
than pass with caveats: all three are reachable by calling the RPC directly.

## The real-child gate — unchanged, and none of it is engineering

| Requirement | State |
| --- | --- |
| K1/K2/P1 reviewed by Makis, deployed, verified live | Not started |
| Guardian approval **and purpose enforcement**; unresolved DOB cannot bypass | 🔴 U3 above |
| Signed academy agreement, controller + retention decisions | No draft exists; #52 turns it into answerable decisions |
| Verified deletion for all roles, **incl. consent evidence and avatars** | 🔴 club admin; avatars unresolved |
| Restore rehearsal **evidence and duration** | Not started |
| Correct pilot org/cohort/window; telemetry verified from UI | `pilot_config.org_id` unset |
| **Named support owner and working parent inbox** | Does not exist |

## The July security Gate 1, since it says it is not cuttable

| Job | State |
| --- | --- |
| RLS on the five identity tables, with a test proving A cannot read B | ✅ U7/U8 |
| RLS integration harness in CI with three authenticated roles | ✅ `npm run test:db` at `ci.yml:45` |
| Age gate at 15 from the DOB collected | ⚠️ exists; reaches less than it appears to (U3) |
| Parental consent record, timestamped, auditable | ✅ append-only and versioned |
| Account deletion **and data export** | ⚠️ deletion 3 of 4 roles; 🔴 **export does not exist** — see below |
| Privacy policy, DPIA, controller decision | 🔴 none exist |
| Password minimum server-side; **leaked-password protection** | ⚠️ character policy is enforced server-side (evidenced in `password.ts`); **leaked-password protection unverifiable from the repo** |
| `/goals`, `/dashboard` no longer bypass `RouteGuard` | ✅ `/goals` gone, `/dashboard` guarded. **`/settings` is unguarded on `main`** — #48 fixes it by self-guarding the component |

### Data export is absent, not untested

The Gate 1 line is *"GDPR Art. 17 and 20 **both** work end to end."* Article 17,
erasure, exists and is tested. **Article 20, portability, is not implemented at
all.** There is no `export_my_data` RPC, nothing in any migration, nothing in
`src/`, and nothing on any open branch — I searched every remote branch, not
just `main`. The only `export` matches in the codebase are TypeScript keywords.

This has never appeared on anyone's task list, in either gate document, or in
`#coding-agent-reviews` all week. It is a legal requirement for the same regime
that makes the consent work necessary, and the September plan's real-child gate
does not name it either — which is how it stayed invisible.

**Leaked-password protection** is the other unknown, and it is a console
setting rather than a gap: nobody has recorded whether it is on.

---

## What actually moves this

1. **Merge.** U5, U6, U9, U10 and half of U2 are written and sitting in the
   queue. Five of ten demo items are a merge away, not a change away.
2. **Two console actions.** Rotate the burned credentials (after #59, or the
   seed restores them), and confirm leaked-password protection.
3. **Three decisions.** Imad on #34/#36/#37 vs #44; counsel on U3's purposes
   question; Tarek on a named support owner.
4. **Two things with no owner and no PR:** F-3, the avatar URL, which U10 and
   the real-child gate both name explicitly; and **GDPR Article 20 data export**,
   which exists nowhere and is named only in the July spec.

## What I did not verify

U4 across its six screens — I have not exercised the parent flow, and #49/#50
are Imad's evidence for it rather than mine. Every other row is cited from the
code on `main`, including the export search, which covered every remote branch
rather than just `main`.

The U1 timing is **counted, not measured**. The 8–10 minutes remains the only
real measurement anyone has, and #60 argues it is measuring the wrong thing.
