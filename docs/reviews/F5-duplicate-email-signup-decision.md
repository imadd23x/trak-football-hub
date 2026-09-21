# F-5 — a second signup on an existing email: what is actually true, and the one decision

| Document control | Value |
| --- | --- |
| Source | `docs/reviews/player-surface-findings-2026-09-18.md` F-5, from Kostas's manual test |
| Prepared | 19 September 2026 |
| Status | **One decision needed, and one experiment that must run first.** |
| Owner of the decision | Tarek, with Imad on the auth surface |

Kostas observed two things and they were reported as one mechanism:

> *"I created a new player account using an email that I had already used… **It didnt
> override the old account**… Once trying to create the new account it **sent an email
> to the parent that was linked to the old account**."*

The triage explained both with a single chain: a duplicate signup authenticates as
the existing user, so `provision_my_profile` renames that account and
`send-parent-invite` mails its guardian.

**Tracing it end to end does not support the first half, and Kostas's own words
contradict it.** He said the old account was *not* overridden. That observation is
the correct one, and there is a single explanation that fits both halves without
any attacker data reaching the database.

---

## 1. What is verified, by reading the code rather than inferring it

**Onboarding data reaches the database through exactly one channel: `user_metadata`.**

`signUp` puts the pending profile in `options.data`
(`AuthContext.tsx:333-341`), which becomes `user_metadata.trak_onboarding`.
Provisioning reads it from there and nowhere else (`AuthContext.tsx:210`,
`readPendingProfileFromMetadata`).

**The old browser-storage channel is deliberately dead.** `PENDING_PROFILE_KEY`
in `localStorage` is only ever *removed*, never read, with the reason in a
comment: *"This old key had no account owner. Never use it, even if it looks
recent."* Someone already closed the obvious version of this attack.

**Metadata is fetched from Auth, not trusted from the browser.**
`createOnboardingSession` calls `supabase.auth.getUser(accessToken)` and refuses
to continue if the returned user is not the session's user
(`onboarding-session.ts:10-15`).

**It is cleared once provisioning succeeds.** `clearPendingProfile()` PUTs
`{ trak_onboarding: null }` (`onboarding-session.ts:26-39`), and provisioning is
skipped entirely when there is no pending profile.

### What follows

For a stranger's signup to rename a child's account, **Supabase would have to
write that stranger's `options.data` onto the existing user's metadata.** Nothing
in this repository does it, and nothing else can reach `provision_my_profile`.

## 2. The single explanation that fits both of Kostas's observations

An account whose first sign-in never completed still has `trak_onboarding` in its
metadata. A duplicate signup causes Supabase to email the **existing** address. If
that address is opened and the link followed, a session opens for the existing
account, provisioning runs **on that account's own original data**, and
`send-parent-invite` mails **its own original guardian**.

That produces exactly what Kostas saw: **no rename**, because the data used was
never the attacker's; **a guardian email**, because it was the real one, late.

It also means the window is bounded — it exists only between signup and the first
successful provisioning, and closes permanently once metadata is cleared.

## 3. The experiment that settles it — run this before deciding anything

Everything above rests on one behaviour I could not execute here:

> **Does a duplicate-email `signUp` overwrite the existing user's
> `raw_user_meta_data`?**

One minute to answer, and it decides whether F-5 is a latent hardening item or an
active account-takeover:

1. Take a test account that has already completed onboarding. Note its
   `full_name` and `raw_user_meta_data` in the Supabase dashboard.
2. From a signed-out browser, sign up with that email, a different password and a
   different full name.
3. Re-read `auth.users.raw_user_meta_data` for that account.

- **Unchanged** → section 1 holds. Rename, date-of-birth overwrite and coach-linking
  are all unreachable, and the decision in section 5 is the only one needed.
- **Contains the new name** → section 4 is live and this is the most serious open
  item in the product. Stop and fix it before the pilot.

## 4. If metadata *is* overwritten, what is exposed

Stated so the severity is not underestimated a second time. `provision_my_profile`
(`20260917205027_secure_parent_invites.sql:349-372`) would then apply an
attacker's values to an existing child:

| Write | Effect |
| --- | --- |
| `ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name` | The child is renamed. The role guard above only catches a *different* role, so player-over-player passes. |
| `date_of_birth = COALESCE(EXCLUDED.date_of_birth, …)` | **The child's date of birth is replaced.** This is the field `squad_player_consent_required()` reads, so setting an adult date removes the parental-consent requirement for that child. |
| `PERFORM public.link_player_to_coach(v_coach_code)` | The child is added to the roster of **whichever coach's code the attacker supplied**, who can then assess them and read their record. |

Chained, that is: add a child to your own squad, age them out of consent, and
begin recording against them — knowing only their email address. The
date-of-birth and coach-link writes are not in the original triage.

**This is why the experiment comes first.** The difference between the two
outcomes is the difference between a hardening task and stopping the pilot.

## 5. The decision that is needed either way

Supabase deliberately returns the existing user on a duplicate signup rather than
saying "this email is taken", because saying so lets anyone test whether a given
address has an account. On a product whose users are children, that is a real
protection and not a formality.

| | **A. Tell the user the account exists** | **B. Stay silent, remove the harm** |
| --- | --- | --- |
| What the user sees | "An account with this email already exists. Please sign in." Expected, and what Kostas expected. | The generic "check your email" message. Confusing if you have genuinely forgotten you registered. |
| Enumeration | **Given away.** Anyone can test whether a child is registered on Trak. | Preserved. |
| Work | Small: the client already has the branch at `AuthContext.tsx:343`. | Two independent changes, see below. |
| Fits a children's product | Poorly — it publishes membership. | Yes. |

**Recommendation: B**, with the two harms fixed independently of the answer:

1. **Never let a second signup rewrite an existing profile.** `provision_my_profile`
   should refuse when a profile already exists and the pending data did not come
   from that account's own onboarding, rather than `DO UPDATE`. Correct even if
   section 3 shows it is currently unreachable — it is one Supabase behaviour
   change away from being reachable, and nothing warns us if that changes.
2. **Never mail a guardian an address the current signup did not supply.**
   `send-parent-invite` selects the invite by `player_user_id = caller.id` and
   mails whatever is stored. Binding the send to the address the *caller just
   provided* removes the misdirected email regardless of how the session arose.

Both are defensive and neither depends on the experiment's outcome. Kostas is
right that the two mechanisms are independent bugs.

### There is a third option worth naming

**C. Say nothing at signup, and notify the address instead.** Supabase already
emails the existing address on a duplicate signup. If that email said *"someone
tried to create an account with your email — if this was not you, ignore it"*,
the real owner is told, the attacker learns nothing, and nobody is confused for
long. It costs a template change rather than code.

The catch: that template is **not in this repository** — there is no
`supabase/templates/` and no `[auth.email]` block in `config.toml`. Kostas found
the same thing for F-10/F-11/F-12. It is a console task for whoever holds the
project, which makes it cheap but not something a PR can deliver.

---

## What I am not claiming

I could not execute a duplicate signup — no credentials and no browser here — so
section 3 is an experiment rather than a result. Everything in section 1 is read
from the code and cited. Section 4 is conditional and labelled as such.

I have not changed any code. The two fixes in section 5 touch
`provision_my_profile` (a migration) and `send-parent-invite` (an edge function),
neither of which is mine, and both of which Imad's open PRs are adjacent to.
