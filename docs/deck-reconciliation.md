# Deck reconciliation — `Trak_Overview_Light.pptx`

**For Chris.** Every claim on slides 3, 4 and 6 checked against what the code
actually does, at `upstream/main` commit `1fcb923`, on 18 Sept 2026.

Deck checked: `Trak_Overview_Light.pptx`, modified 15 Sept 2026 00:02 — the most
recent of seven similarly-named files. Note that `Trak_Overview Final.pptx` is
**not** the final one; it is a day older and a different lineage. If you are
editing a different file, stop and tell me, because none of the line numbers
below will match.

Three verdicts are used:

| Verdict | Meaning |
|---|---|
| **True** | Verified in the code. Safe to say to an academy today. |
| **Not yet** | Untrue as the build stands. Either reword, or land the named task first. |
| **Unverifiable here** | Not a claim about the software. Someone else has to own it. |

---

## Slide 3 — THE SOLUTION

### 01 "The coach logs each player's performance based on six metrics" — **True**

Exactly six sliders: Work Rate, Tactical, Attitude, Technical, Physical,
Coachability (`src/pages/coach/CoachAssessPage.tsx:313-318`). There is an
enforced use-case test covering it (UC-C04). Say this freely.

### 02 "AI turns free-text coach notes into an age-appropriate action. The coach reviews every word." — **Not yet**

The second sentence is untrue today. There is no approval step anywhere in
`supabase/functions/player-feedback/index.ts` or `PlayerFeedback.tsx`; generated
text reaches the child directly.

This is the single claim on the deck I would most want changed before an academy
meeting, because it is the one a safeguarding lead will test. **Task T2 makes it
true** — until T2 ships, either drop the sentence or say "the coach will review
every word" as a roadmap statement, clearly marked.

*Updated 18 Sept.* T2 is now **built and not yet merged** (#40). When it lands,
this becomes the strongest claim on the slide rather than the weakest:

- The AI produces a **draft** into `ai_feedback_drafts`, a table a player has no
  grant on at all — unapproved text is unreachable structurally, not because a
  policy is written correctly.
- A coach reviews and edits every field, then publishes through
  `publish_player_feedback()`, which re-checks ownership, requires the coach
  role, and **refuses entirely when parental consent is required and absent**.
- The player screen reads only the current published revision.
- 16 database assertions cover it, including that a child reads no drafts by any
  route and that a withdrawn guardian stops the child reading what was already
  published.

One consequence to be aware of before repeating the slide: **the child-facing AI
chat is off.** A live conversation cannot be approved in advance by a coach, so
it cannot coexist with "every AI message a child sees was approved by their
coach first". If the deck or a demo shows a player chatting with an AI, that is
no longer the product.

Until #40 merges, the sentence is still untrue in production.

### 03 "The player receives feedback; AI turns it into an actionable plan" — **True, conditional on 02**

The mechanism exists and works. But as written it describes text a coach has not
approved, so it inherits the problem above.

### 04 "Development narrative, not a ranking. Visibility without interference." — **True on the substance, with one caveat**

"Not a ranking" is true: there is no league table, no child-versus-child
comparison anywhere in the product. That is a real differentiator and it is
honestly stated.

The caveat is "visibility without interference" — see the private-notes problem
below, which affects what parents and players can currently see.

### 05 "Academy sees consistency — coverage, coaching standards and safeguarding evidence across every squad" — **Not yet**

The academy dashboard currently picks an **unordered** assessment and labels
players who have never been assessed as **"Steady"** (`src/pages/club/ClubHome.tsx`).
So the coverage view does not merely lack data — it actively reports a
reassuring answer for players nobody has looked at. Do not demo this screen as
evidence of coverage until **K7** lands.

"Safeguarding evidence" is partly real: consent records are append-only and
versioned. But the threshold is hard-coded to age 15 for Greece
(`src/lib/consent.ts:13`) and the first market is the UAE. **P2** addresses it.

### 06 "A longitudinal, permissioned development record the academy owns" — **Not yet, and this is the risky one**

*Updated 18 Sept, after K1/K2 shipped and U7 was run. Still not yet — but for a
narrower reason than before, and the honest wording has changed.*

When this was written, coach write policies checked the coach's *role* rather
than *ownership* (**X2**), and cross-academy isolation had never been exercised
against a second academy. Both have moved:

- **K1 and K2 are deployed**, along with F2–F5 from the departure audit.
- **U7's read direction ran against the live project.** Signed in as a
  Rehearsal FC coach, asking for City FC *by organization id*: zero rows on
  `squad_players`, `coach_assessments` and `organizations`, with a working
  control returning 21 of their own. That is the strong form — "what happens
  when I ask for the other academy?" rather than "what do I get?".
- **U7's write direction and U8 ran on a disposable database.** A coach from
  academy B cannot assess, alter, delete, rename or log a match against academy
  A's player, and cannot create a roster row inside another academy. A departed
  coach reads and writes nothing. Verified by an owner/outsider differential:
  the identical `UPDATE` succeeds for the owning coach and leaves the row
  untouched for the outsider.

**That is still not enough to say "permissioned development record" to an
academy**, and the reason is worth stating rather than glossing. The live run
covered one direction, two of three coaches, one age group, and reads only. The
write direction was proven on a replayed database, not the production one.

The claim that *is* supported, and which never needs retracting:

> Isolation is enforced and verified on reads between two real academies.

That is true, checkable, and does not promise more than has been tested. Use it
until the live write direction has been exercised too.

### "No video hardware, no GPS vests, no public rankings, no scouting marketplace" — **True**

Nothing in the repo does any of these. Good claim, keep it.

---

## Slide 4 — GAP ANALYSIS

### The competitor grid — **Unverifiable here**

The five clusters, who owns what, and the threat ratings are market research, not
statements about our code. I cannot check them and have not tried. Whoever did
the research should confirm they still hold.

One note on wording: *"No competitor page reviewed combines coach appraisal, AI
over qualitative coach notes, and structured development plans visible to
parents"* is carefully hedged — "no competitor page **reviewed**" — and that
hedge is doing real work. Keep it exactly as written; it is defensible as
phrased and would not be if shortened to "no competitor combines".

### "Admin is already free… Trak must sell the development record, not the calendar" — **Unverifiable here, but consistent with the build**

The product genuinely is the development record rather than a scheduling tool.

### "Child-data rules are tightening. UAE Decree-Law 26 of 2025 and EU AI Act Art. 50. Handled early, this is the moat, not the tax." — **Not yet**

"Handled early" is the problem. As the build stands, child-data handling is
**Greece-shaped**: one hard-coded threshold of 15, reasoned entirely from Greek
law, in a product whose first paid market is the UAE. That is the opposite of
handled early for the market this slide is about.

The architecture is genuinely good — consent records are append-only and
versioned, which is the hard part and a real head start. So the honest version is
closer to *"built for it from the start"* than *"handled"*. **P2** closes the gap.

On **EU AI Act Art. 50** specifically: that article is about transparency —
disclosing to a person that they are receiving AI-generated content. I could not
confirm from the code that a child is clearly told the feedback they are reading
was written by AI. Worth someone checking before this claim is made to a
regulator-minded buyer.

---

## Slide 6 — WHO WE ARE / WHAT HAPPENS NEXT

### The three bios — **Unverifiable here**

Nothing to check in code. You and Kostas can confirm your own.

### "September 2026 Greece soft test — closed cohort, no public sign-up" — **Not yet, as stated**

The product does not enforce this. Sign-up routes are open; anyone reaching the
site can create a coach, player or club account. If the cohort is closed by
*not sharing the link*, that is a distribution control, not a product control,
and the sentence overstates it. Either reword to "invited cohort", or someone
needs to gate sign-up.

### "Fixed squads, verified guardian permissions, written go/no-go gates" — **Reword one word**

- *Fixed squads* — fine.
- *Written go/no-go gates* — true, Gates 1 and 2 exist and are written down.
- ***Verified* guardian permissions** — overstated. A guardian consent record is
  captured, stored append-only and versioned, which is genuinely good. But
  nothing **verifies** that the person granting consent is the guardian. Any
  email address can be entered. "Recorded guardian consent" is accurate and
  still sounds strong; "verified" invites a question we would fail.

### "Measures coach habit, player comprehension and parent trust" — **Partly**

`pilot_telemetry` and the `pilot_scorecard` views exist and are real. They
measure **coach habit** well — activation, coverage, whether coaches kept
logging. That is the important one and it is genuinely built.

**Player comprehension** and **parent trust** are not measured by anything I can
find. They would need to be asked, not instrumented. Either narrow the claim to
coach habit, or say the other two are gathered by interview.

Also note `pilot_config.org_id` is not yet set (**S3**), so the scorecard
currently reports across the whole database rather than the pilot cohort.

---

## One thing not on these slides that you should know

While checking slide 3's safeguarding claims I found this, and it is worse than
the pilot plan records it as.

`coach_assessment_notes` was created in April 2026 as a **coach-only** table. The
migration says so in a comment: *"Coaches can read/write their own notes only.
Players & parents have NO access."* The coach-facing copy promising that notes
stay private was **true when it was written**.

In May 2026, `20260524000001_player_feedback_rls.sql` added a player `SELECT`
policy to that same table so the feedback feature could read notes. That did not
only change future behaviour — **it made every note already written under the
privacy promise readable by the player**, retroactively.

The pilot plan describes this as "there is no genuinely private field" (X9). That
understates it. There *was* one, and it was opened without the promise being
changed. Any coach who has used the app since May has written notes they were
told were private and which their players can read.

This belongs to **K9** (Kostas) and **P4** (Imad), not to me, and I have not
touched it. But it changes the shape of the fix: this is not "build a private
field", it is "decide what happens to notes already written in confidence". That
is a judgement call about real people's words, and it should be made
deliberately rather than as a side effect of adding a column.

---

## Summary for the deck

Status as of 18 Sept. Two rows have moved; the other six have not.

| Slide | Claim | Action |
|---|---|---|
| 3 | "The coach reviews every word" | **Built, not merged** (#40). True once it lands. Until then, cut it. |
| 3 | "Academy sees consistency / coverage" | Don't demo that screen until K7 |
| 3 | "Permissioned record" | **Still don't say it.** Say "isolation is enforced and verified on reads between two real academies" |
| 4 | "Handled early" (child-data) | Soften to "built for it from the start" until P2 |
| 4 | EU AI Act Art. 50 | Check a child is told the text is AI-written |
| 6 | "No public sign-up" | Reword to "invited cohort" |
| 6 | "Verified guardian permissions" | Reword to "recorded guardian consent" |
| 6 | "Player comprehension and parent trust" | Narrow to coach habit, or say how |

Two claims found since this was first written, neither on slides 3, 4 or 6, both
worth knowing before any of this is said out loud:

- **A coach who signs up without an academy code is linked to no academy.** The
  academy dashboard cannot see that coach or any player they add. Demonstrated
  by a failing end-to-end test, and it reproduces on every such signup.
- **A one-letter misspelling costs a player their entire assessment history.**
  Roster adoption matches on an exact name, so "Mohammad" versus "Mohammed"
  lands the player on an empty row while the coach's row keeps the assessments,
  linked to nobody. Also demonstrated by a failing test.

Neither is a deck claim, but both would surface within minutes of an academy
using the product, which makes them a reputational risk to anything said here.

Everything else on slides 3, 4 and 6 is either true in the build or is a market
claim outside the code.

---

## Open: the pilot has a success metric it cannot measure

Not a slide claim, but it belongs here, because it is the thing an academy will
eventually be told the pilot proved.

`docs/superpowers/specs/2026-07-27-trak-pilot-mvp-design.md` sets the pilot's
headline measure:

> Q4 metric: ≥60% of athletes log weekly, unprompted.

**Athletes cannot log.** `/player/log` and `/player/logchoose` were removed on
21 April 2026 by commit `3c12cbb`, an automated commit titled "Changes", with no
rationale recorded. `PlayerLogForm` (228 lines) and `PlayerLogChoose` (46) went
with them. The spec is dated 27 July — three months *after* the deletion — and
still describes athlete logging as a product pillar in two places:

- **P1. The athlete owns the record.**
- **P4. The loop must close. Coach assesses → athlete sees → athlete logs →
  coach sees.**

UC-A02 tests it, is Tier 1 and Tier 2, and has failed since the harness existed.

**The database never stopped supporting it.** `matches` still carries "Players
can insert own matches", along with update, delete and read policies for the
athlete's own rows, and `logged_by_role` exists to tell a self-log from a
coach-log. Only the screens went. Restoring is UI work, not an architecture
change — which makes this a genuine choice rather than a forced one.

Two honest resolutions, and they lead to different pilots:

1. **Coach-logged is the product.** Then P1, P4, UC-A02 and the Q4 metric are
   all stale and need rewriting, and the pilot needs a different measure of
   whether it worked — coach habit, which `pilot_scorecard` already tracks.
2. **Athlete logging is still the product.** Then a Tier 1 capability is missing
   and the headline metric is measuring a screen that does not exist.

**Status: parked by Tarek on 18 Sept** until the merge queue is clear and `main`
is green, on the grounds that neither path is safe to start while thirteen PRs
sit unmerged. Recorded here so the decision is deliberate rather than forgotten.

The spec also still carries, from July: *"Needs restating by Kostas before any
external conversation."*
