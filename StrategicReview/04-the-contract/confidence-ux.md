# Confidence UX Designer, Module 4

*Session: 19 September 2026, second run. Trak's run of the course's Confidence UX Designer, taken from the
tool's own "Copy as Text" output. The tool says its output mirrors the Confidence UX Design section
of [golden-dataset.md](golden-dataset.md); section 2 there adds the workflow paths for
each tier.*

---

## Tool output — Trak

## Confidence UX Design

**Approach:** Tiered confidence with a citation under every band and a human-in-loop trigger. Confidence is not the model's opinion of itself: the drafter must quote the coach's words behind each band, code checks each quote is really in the input, and the score is verified fields ÷ drafted fields. Safety flags bypass the score. Only the coach sees it, and no tier signs for the coach.

**Confident (>90%):** Full record, full rewrite: the agent turns the coach's fragments into the finished record and fuses it into the passport draft. Each band shows the coach's quote it came from. Direct copy, no hedging: "Built from what you said. Check and sign." One tap to sign, or edit first. Never auto-signed; an unsigned draft stays invisible to the player and parent (T2).

**Uncertain (50-90%):** Lighter rewrite: the coach's own words stay verbatim in the note and only verified bands are pre-filled. Each unverified band shows as a ? chip with two or three band options, next to the quote it might come from. Softer copy: "You said 'lost his man at corners' — which band for Tactical?" Sign stays disabled until every ? is chosen. The AI asks; it does not guess.

**Not confident (<50%):** No draft, and say why. Safeguarding disclosure: nothing drafted, the note kept off the record, the academy's safeguarding route shown, and a human always reviews. Instruction in the note, demeaning language or a character grade: no draft, the flag named, and the input sent to Trak's review queue. Unclear player: "Which Youssef?" Nothing to build from: attendance only, "Add a line?" The manual form is always there.

**User control surface:** 

Every draft has five buttons: "accurate", "wrong band", "not what I said", "wrong player", "too harsh". Those labels, and every band change, save source_text, drafted_band, signed_band and coach_id, which feed the weekly gold-set audit and prompt review. Corrections improve the dataset and prompts; training a model on children's records waits for the GDPR legal basis. Thresholds are fixed child-safety floors, not a coach setting. Children and parents never see confidence, only "Signed by Coach Andreas · 14 Oct · built from the coach's notes."

- Users see AI reasoning / drivers
- Users correct & override outputs
- Corrections feed back into the model / dataset
- Users adjust the confidence threshold _(not yet)_

> **"Not yet" is the tool's fixed wording for an unticked control.** For Trak it means **never**:
> the thresholds are a child-safety floor, not a preference. The Specifics paragraph above says so.

---

## How the tool works

Worked out on 19 September by filling the course's tool, capturing its "Copy as Text" output and
changing one field at a time. The page's script could not be read directly. Described in our own
terms.

**Five fields:** approach, the three confidence tiers, and the user control surface.

| Field | Inputs | How it appears in the output |
|---|---|---|
| Approach | Three chips (*show uncertainty*, *tiered confidence*, *human-in-loop trigger*) plus a sentence | The sentence, if one is written. If not, the selected chips joined with " / ". |
| Confident · >90% | Free text: what the UI shows and what the AI may say | `**Confident (>90%):** …` |
| Uncertain · 50 to 90% | Free text | `**Uncertain (50-90%):** …` |
| Not confident · <50% | Free text | `**Not confident (<50%):** …` |
| User control surface | Four toggles plus an optional Specifics paragraph | Specifics first, then the toggled-on controls as a list, then toggled-off controls marked *(not yet)* |

An empty tier prints as *(not set)*. The tool autosaves in the browser. The tier cut-offs (90% and
50%) are fixed by the tool, and Trak uses the same ones.

**The four controls, and Trak's answer:**

| Control | Trak | Why |
|---|:-:|---|
| Users adjust the confidence threshold | **No** | Safety floors for a child's record are not a user setting. |
| Users see AI reasoning / drivers | Yes | Each drafted band shows the coach's phrase it came from. |
| Users correct & override outputs | Yes | The coach cycles bands, edits and deletes before signing. |
| Corrections feed back into the model / dataset | Yes | The four-column correction capture feeds the weekly gold-set audit. |
