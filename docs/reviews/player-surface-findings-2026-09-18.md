# Player surface — findings from Kostas's manual test, 18 September 2026

Kostas tested the player profile end to end and reported twelve observations. This
triages all twelve: what is confirmed against the code or the live database, what
is not, who owns each, and what the fix costs.

**Nothing here was fixed when this was written.** Every item on the player surface
belongs to Tarek, and this was written while he and Imad were offline. The document
and its companion tests were the whole deliverable, so that his next pass would be
one pass instead of twelve investigations.

> **19 September update.** @t-bones29 took F-1, F-4 and F-6 in #55 and they are
> now on `main`. He also corrected two things here, both of which stand: there
> was a **fifth** band ladder I had missed (`categoryScoreToBand()` in
> `matchDetailHelpers.ts`, live on the player's match-detail screen, where a 4
> read "Developing" against "Mixed"), and **one of my F-1 assertions was checking
> the wrong construct** — it grepped for band hexes and matched the brand accent
> `#C8F25A`, which is also the Exceptional colour, so a grep cannot tell them
> apart. He was right not to contort the file to satisfy it; the assertion is
> corrected instead. F-5's mechanism is corrected below. **F-2 turns out to be
> fixed by Imad's #48** and is not mine to do; **F-3 is not**, and is mine once
> #48 merges.

Where a root cause is stated it was read from the code or queried from the live
database. Where it is not, the row says so rather than guessing — five of the
twelve are not diagnosed here and are listed as openly as the seven that are.

---

## Confirmed, with mechanism

### F-1 · Band words and colours contradict each other between two screens

> *"Latest coach assessments on home page shows all ratings on 'mixed' with orange
> colours whereas on profile page under performance trend the colours are blue and
> show 'steady'."*

`PlayerProfilePage.tsx:71` defines its own `scoreToBandLabel()` rather than using
`scoreToBand()` from `src/lib/rating-engine.ts`. The two ladders disagree:

| score | `scoreToBand` (canonical) | `PlayerProfilePage.scoreToBandLabel` |
|---|---|---|
| 9+ | Exceptional | **Standout** |
| 8 | Standout | Good |
| 7 | Good | Good |
| 6 | Steady | Steady |
| **5** | **Mixed** (orange `#fb923c`) | **Steady** (blue `#60a5fa`) |
| 4 | Mixed | Mixed |
| 3 | Developing | Mixed |
| 2 | Developing | Developing |
| 0–1 | Difficult | **Developing** |

A score of **5 is "Mixed"/orange canonically and "Steady"/blue on the profile**,
which is exactly the contradiction reported. The local copy also knows only five
of the seven bands — it has no `Exceptional` and no `Difficult` — so a 9.5
assessment reads "Standout" on the profile and "Exceptional" everywhere else.

**Why every category read 5.** The six slider columns are
`integer NOT NULL DEFAULT 5` (`20260327034734`). An assessment a coach saved
without moving the sliders genuinely is all fives. So the data was right and both
screens were describing it, differently.

CLAUDE.md: *"never use hardcoded colour strings outside of the `BANDS` config."*
Counted as the fourth copy of that map when written — the others being
`src/lib/clubMock.ts`, `src/lib/matchDetailHelpers.ts`, and one in
`CoachHomePage.tsx` removed the same evening.

**There were five.** @t-bones29 went looking for the rest and found
`categoryScoreToBand()` in `matchDetailHelpers.ts` carrying its own *thresholds*,
not just its own colours — a 4 reads "Developing" there against "Mixed"
canonically, and a 3 reads "Difficult" against "Developing". Live on the player's
match-detail screen, so the same child reads differently depending on which
screen they open. Fixing only the copy reported here would have left it.

**Owner:** Tarek. **Cost:** deletion — use `scoreToBand` + `BANDS`. The other two
copies should go the same way.

### F-2 · The name saves but the screen keeps the old one

> *"Name updates after refreshing the page."*

`Settings.tsx:102` writes `profiles.full_name` and toasts "Name updated". It never
calls `refreshProfile()`, so the `AuthContext` profile still holds the previous
name and every screen reading `profile.full_name` shows the stale value until a
reload re-fetches it. `handleAvatarChange` in the same file *does* call it
(`:196`), so the pattern is present and was simply not applied here.

Second defect in the same eleven lines: the `.update()` has no `.select()`
read-back, so a zero-row update — an absent profile row, an RLS denial — reports
"Name updated" having written nothing. That is the twenty-second instance of
"absence of an error treated as evidence of success" found on 18 September.

> **19 September: already fixed, and not by me.** @t-bones29 reviewed #48 and
> **#48 is the fix** — a better one than this finding asked for. It adds the
> `.select()` read-back, throws `'Name save was not confirmed'` on a zero-row
> update, calls `refreshProfile()`, and renders the value the database returned
> rather than the local draft. Both of my F-2 assertions pass against it. I do
> not owe this one; it needs #48 merged and nothing else.

**Owner:** was Kostas (`Settings.tsx`) — **superseded by Imad's #48**.
**Cost:** nil, already written.

### F-3 · The profile photo cannot be updated

> *"I cant update my photo on my profile."*

Confirmed independently of this test, and Kostas's test is the execution that was
missing. The `avatars` bucket is `public = false` (verified in `storage.buckets`;
made private on 26 May). `Settings.tsx:183` calls `getPublicUrl()`, which produces
a URL only a public bucket serves, and `:191` **persists that dead URL to
`profiles.avatar_url`** — so it outlives the session and four profile screens
render it as a broken `<img>`. The toast says "Profile photo updated" because the
upload itself genuinely succeeds; only the URL is unusable.

Live scale: the bucket holds **one** object and `profiles` has **one** non-null
`avatar_url`. Not "every avatar since May" — there has only ever been one.

> **19 September: #48 does NOT fix this**, and it is worth stating so it is not
> marked done when #48 lands. @t-bones29 confirmed `getPublicUrl` survives at
> `Settings.tsx:228` on that branch and line 230 still persists the dead URL —
> #48 scopes that write to the right account, it does not make the URL work.

**Owner:** Kostas. **Sequencing:** he calls it unblocked; I would still take it
*after* #48 merges rather than alongside it. #48 is open, `mergeable_state:
clean`, and touches this exact region — Tarek's own line numbers come from its
branch, not from `main`. Editing the same function in a second open PR is the
collision shape that has cost us #34/#44, #44/#51 and #44/#42 in two days, and
this one is avoidable by waiting for a merge that is ready now.

**Cost:** not a one-liner. A signed URL expires, so storing one in `avatar_url`
trades a URL that never works for one that stops working. Doing it properly means
storing the object path and signing at render time: four render sites across all
four roles.

### F-4 · The Evolution Card shares as plain text

> *"I tried sharing evolution card on messages and it showed a text with everything
> in writing."*

Two share implementations exist and only one produces an image.

`PlayerPassport.tsx` captures the card with `html2canvas`, converts it with
`canvas.toBlob(..., 'image/png')`, and calls
`navigator.share({ files: [file], ... })` — an image.

`PlayerEvolutionCard.tsx:468` calls `navigator.share({ title, text })` — **no
`files` key at all**, so the OS share sheet has nothing but a string to hand to
Messages.

**Owner:** Tarek. **Cost:** moderate — port the `html2canvas` capture from
`PlayerPassport`, including its transform handling (`PlayerPassport.tsx:77` removes
a CSS transform before capture, which the Evolution Card will need too).

### F-5 · A second signup on an existing email emails the first account's parent

> **CORRECTED 19 September, after @t-bones29 traced it (#56). The mechanism
> below was asserted, not traced, and the observation it was built on
> contradicts it.**
>
> Kostas's report says, in his own words: *"**It didnt override the old
> account**… Once trying to create the new account it sent an email to the
> parent that was linked to the old account."* **The triage explained the
> guardian email with a rename that the reporter explicitly said did not
> happen**, and nobody — me least of all — reconciled the two. That is the
> failure this document criticises elsewhere: characterising a mechanism
> without following it.
>
> Tarek's trace: onboarding data reaches `provision_my_profile` through exactly
> one channel, `user_metadata.trak_onboarding`. The browser-storage channel is
> dead by design — `PENDING_PROFILE_KEY` appears twice in the whole codebase,
> its declaration and a `removeItem`, and is never read. So a stranger's data
> can rename a child **only if Supabase writes that stranger's `options.data`
> onto the existing user's metadata**, which is an assumption neither of us has
> tested.
>
> His alternative fits both halves of the report without a rename: an account
> whose first sign-in never completed still holds its own `trak_onboarding`.
> The duplicate signup makes Supabase mail the *existing* address; following
> that link opens a session for the existing account, provisioning runs on
> **that account's own original data**, and the invite goes to **its own
> original guardian**. No rename, one guardian email, late.
>
> **I could not settle it from the database.** `trak_onboarding` is cleared
> once provisioning succeeds, and it is absent on all 12 live accounts, so
> there is nothing to read back. Tarek's experiment is the right test and it
> needs the console: sign up again with a *completed* account's email, a
> different name, then read `auth.users.raw_user_meta_data` for that account.
> Unchanged → the rename is unreachable. Contains the new name → it is worse
> than either of us said, see below.
>
> **What is not in doubt:** the guardian of an existing account received an
> email triggered by someone else's signup attempt. That half is Kostas's
> direct observation and it stands.
>
> The original text follows, with its unverified claim marked.

> *"I created a new player account using an email that I had already used… It didnt
> override the old account… Once trying to create the new account it sent an email
> to the parent that was linked to the old account."*

**The most serious item on the list, and it is a safeguarding issue rather than a
UX one.**

Supabase deliberately returns the **existing** user for a duplicate-email signup,
to prevent email enumeration. So `auth.uid()` is the *old* account for everything
that follows, and two things happen that should not:

1. **The existing account is renamed — ⚠️ UNVERIFIED, see the correction
   above.** This depends on Supabase writing the second signup's `options.data`
   onto the existing user's metadata, which has not been tested.
   `provision_my_profile` (`20260611000001`) does:
   ```sql
   INSERT INTO public.profiles (user_id, role, full_name, nationality)
   VALUES (...)
   ON CONFLICT (user_id) DO UPDATE
     SET full_name = EXCLUDED.full_name, ...
   ```
   The second signup's name overwrites the first account's. The role guard above
   it (`IF v_existing_role <> v_role THEN RAISE`) only catches a *different* role,
   so player-over-player passes.

2. **The first account's parent is emailed.** `send-parent-invite`'s handler
   selects invites `WHERE player_user_id === caller.id` (`handler.ts:76`) and mails
   `invite.parent_email` (`:106`). `caller.id` is the old account, so it finds the
   old account's invite row and mails **that child's guardian** — a person who has
   nothing to do with whoever just attempted the signup. Live: 8 invite rows across
   8 players.

So someone who knows a child's registered email can cause an email to reach their
guardian without ever proving control of the address — and, *if* the metadata
branch turns out to be reachable, rename the account too.

**@t-bones29 found two further writes on that same conditional branch, and they
are worse than the rename.** The same `ON CONFLICT DO UPDATE` also writes
`date_of_birth` — `COALESCE(EXCLUDED.date_of_birth, player_details.date_of_birth)`,
so a supplied date overwrites a stored one — and `date_of_birth` is the field
`squad_player_consent_required()` reads. And the same call runs
`link_player_to_coach()` with whatever coach code the signup supplied. Together:
add a child to your own squad, age them past the consent threshold, and begin
recording against them, knowing only their email address. Neither write was in
my original finding.

**This is why the experiment comes before the decision.** If the branch is
unreachable, only the product question remains. If it is reachable, the severity
is not "a confusing signup".

**The fix is a product decision, not an engineering one**, which is why nothing is
changed here. The tradeoff:

- **Tell the user an account already exists** — what Kostas expected, and what most
  products do. It trades away the email-enumeration protection: anyone could then
  test whether a given child's email is registered. For a product whose users are
  minors that is a real cost, not a free win.
- **Stay silent but stop the damage** — keep enumeration protection; never rename an
  existing profile from a second signup, and never send a parent invite to an address
  the *current* signup did not supply. The user sees the generic confirm-email
  message.

Either way the two mechanisms above need separating: the rename and the misdirected
email are independent bugs and the second is worse.

**Owner:** needs Kostas + Tarek + Imad. Touches `provision_my_profile` (migration),
`send-parent-invite` (edge function), and `AuthContext`.

### F-6 · Nothing validates date of birth against the selected age group

> *"I was able to sign up as a player born in 2000 playing for the team U19+."*

`OnboardingPage.tsx` collects `date_of_birth` (`:223`) and `age_group` (`:226`) as
**independent fields** — the age group is a free `<select>` over `AGE_GROUPS` with
no cross-check.

Worth stating precisely, because the reported case is the least alarming one: a
player born in 2000 is 26, and "U19+" plausibly *means* 19-and-over, so that
specific pairing may be correct. The defect is that **no pairing is checked at
all** — a child born in 2010 selecting U19+, or one born in 2000 selecting U12,
passes identically. The second direction is the one that matters, because
`squad_player_consent_required()` follows `date_of_birth`, and an age band that
contradicts it is a signal nobody is reading.

**Owner:** Tarek (onboarding), with a product call on whether the age group should
be derived from the date of birth rather than chosen.

---

## Not diagnosed

### F-7 · The passport "loads wonky"

> *"As a player trying to save the player passport loads wonky."*

Not reproduced. `PlayerPassport.tsx` manipulates a CSS transform around the
`html2canvas` capture (`:77`, `:158–178`), which is the usual source of a visible
flicker or a mis-sized capture, but "wonky" could describe several different
things. **Needs:** what it looked like, and on which device.

### F-8 · AI answers are not complete sentences

> *"On coach's feedback chat, when asking questions the answers i get back are not
> complete sentences."*

**Checked and the obvious cause is not present.** The usual culprit is an SSE
stream whose final buffered chunk is never flushed; `PlayerFeedback.tsx:424–430`
handles this correctly — it calls `sse.flush()` on `done` before breaking. There is
also no `max_tokens` cap on `coach-assistant` (`index.ts:229`), so the response is
not being cut by a limit we set.

That leaves the model's own output, the upstream gateway closing the stream early,
or "not complete sentences" meaning terse rather than truncated. **Needs:** an
actual transcript — the question asked and the answer received.

### F-9 · No idea what an evolved card / "series 2" looks like

A product question rather than a defect. **Needs:** Kostas and Tarek.

### F-10, F-11, F-12 · Auth email templates and the reset link

> *"Confirming email has a white template, resetting password has a black template."*
> *"…land on a page which says verifying your reset link. Never loads."*
> *"Confirm email should have a message saying Welcome NAME."*

The auth email templates are **not in this repository** — there is no
`supabase/templates/` directory and no `[auth.email]` template block in
`supabase/config.toml`. They are managed in the Supabase dashboard, so none of
these three can be fixed in a pull request; they are a console task for whoever
holds the project.

The reset link failing to load is the one that may also be code. Kostas noted it
resolved on the third attempt after pressing reset three times, which is consistent
with each new link invalidating the previous one — the earlier tabs would then sit
on "verifying" forever. That is expected behaviour for one-time tokens, but the
page should say so instead of hanging. **Needs:** confirmation of whether a single,
never-reused link also hangs.

---

## Summary

| | Finding | Confirmed | Owner | Blocked by |
|---|---|---|---|---|
| F-1 | Band ladder diverges between screens | yes | Tarek | **fixed in #55** — and there was a *fifth* ladder I missed |
| F-2 | Name save does not refresh the profile | yes | ~~Kostas~~ | **fixed by #48** — both assertions pass |
| F-3 | Profile photo URL is unusable | yes | Kostas | **not** fixed by #48; take it once #48 merges |
| F-4 | Evolution Card shares text, not an image | yes | Tarek | **fixed in #55** |
| F-5 | Duplicate signup emails the wrong parent | **partly — rename UNVERIFIED** | all three | Kostas's console experiment, then a product decision |
| F-6 | DOB and age group never cross-checked | yes | Tarek | **fixed in #55**; age fix rides #38 |
| F-7 | Passport "loads wonky" | no | Tarek | needs detail |
| F-8 | AI answers incomplete | no | Kostas | needs transcript |
| F-9 | What "series 2" looks like | n/a | product | — |
| F-10–12 | Auth email templates, reset link | partly | whoever holds the console | not a code change |

Companion tests: `src/__tests__/player-surface-findings.test.ts`. They are
**tripwires read from source, not executed journeys** — they assert that the
specific defective construct is gone, and they are gated behind
`npm run test:findings` so CI stays green. A permanently red `main` teaches people
to ignore the colour.

Eight assertions, all currently failing, each naming its finding. The failures are
substantive rather than path errors: F-1 prints the divergent ladder it actually
read, `[9, 7, 5, 3]` against the canonical `[9, 8, 7, 6, 4, 2]`.

**A limit worth stating.** A test that fails is only half the proof; it also has to
pass once the defect is fixed, or it may be asserting something unreachable. That
was verified for **F-2 only** — the fix was applied to `Settings.tsx`, both
assertions turned green, and the file was reverted. `Settings.tsx` is mine. The
assertions for F-1, F-4, F-5 and F-6 were **not** verified in the green direction,
because doing so means editing Tarek's files and the brief for this pass was to
touch none of them. Whoever fixes those should expect to adjust the assertion's
wording if it proves to be checking the wrong construct.
