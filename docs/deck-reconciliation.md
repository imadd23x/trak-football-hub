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

"Permissioned" is the claim academies are actually buying, and it is the one
claim nobody has tested. Coach write policies check the coach's *role*, not
*ownership* of the referenced player, session or academy (**X2**). Cross-academy
isolation has never been exercised against a second academy in the database.

I would not say "permissioned" to an academy until **K1 passes and U7 has been
run with two real academies**. Everything else on this list is a wording problem.
This one is a promise about their data.

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

| Slide | Claim | Action |
|---|---|---|
| 3 | "The coach reviews every word" | **Cut or mark as roadmap** until T2 |
| 3 | "Academy sees consistency / coverage" | Don't demo that screen until K7 |
| 3 | "Permissioned record" | **Don't say it** until K1 + U7 pass |
| 4 | "Handled early" (child-data) | Soften to "built for it from the start" until P2 |
| 4 | EU AI Act Art. 50 | Check a child is told the text is AI-written |
| 6 | "No public sign-up" | Reword to "invited cohort" |
| 6 | "Verified guardian permissions" | Reword to "recorded guardian consent" |
| 6 | "Player comprehension and parent trust" | Narrow to coach habit, or say how |

Everything else on slides 3, 4 and 6 is either true in the build or is a market
claim outside the code.
