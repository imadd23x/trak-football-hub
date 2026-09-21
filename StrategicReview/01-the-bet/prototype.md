# 01 — The Bet: Touchline

*Prompt-a-starter run. Date: 2026-09-12.*

The use case chosen is the **coach post-match assessment** — not because it is the most
visible, but because it is the one the kill criteria already point at. If ≥50% of pilot coaches
stop assessing after week 4, the triangle thesis dies and nothing downstream (band, parent view,
passport, character axis) has anything to stand on. Coach effort is the single point of failure,
and it is unpaid.

---

## The prompt

```text
Build an end-to-end experience for an AI post-match assessment product called Touchline.

Who: A volunteer/part-time academy coach after a U15 match — JTBD: "When the final
whistle goes and I have 12 players and a car park to clear, help me leave a written,
believable record of how each kid played and behaved, so I don't skip it."

Core value: 20 seconds of plain spoken English becomes a full six-category
assessment the coach edits and signs.

First screen: One player card, a box with the coach's own words in it,
a running timer. Nothing else.

AI moment: Coach taps Draft → Claude returns six category bands, a note written
to the player, a separate character observation, and flags for anything said that
isn't observable.

Output: A signed assessment in under 30 seconds, and a note the player will read.

Clean UI. Dark theme. One page. No login.
```

---

## Capture

| | |
|---|---|
| **What I built** | Touchline — a one-screen coach flow. The coach types or dictates how a player went in plain words; Claude drafts six category bands, a player-facing note, a character observation on a separate axis, and challenges any phrase the coach can't point at. The coach adjusts the bands by tapping, edits the note, and **signs**. A timer runs from first keystroke to signature. |
| **Prototype link** | https://claude.ai/code/artifact/2d1a5e33-2d92-4274-93b6-a17c568e7608 |
| **Bet to test next** | A coach will produce a *better* assessment in 30 seconds by talking than in 3 minutes of sliders — better meaning more specific, more evidenced, and more likely to still be happening in week 8. |
| **Tool used** | Claude Code (Opus 5) → published Artifact |
| **AI model/anchor** | Claude via the artifact `sample` capability; anchored on Trak's own constraints — the fixed 7-band vocabulary, no numbers in any output, no red, developmental language, character described and never rated |
| **Named attacker** | **Hudl.** It already sits inside academies, already owns the match-evidence workflow, and can staple a generated player note onto footage it holds. Our only defensible ground is the *signature* — a record a named coach authored, not one a model produced. |

---

## The attackable claim

> **A coach-signed assessment drafted from 20 seconds of speech is more believable than one
> built from sliders, and takes a tenth of the time.**

Attack it on any of these:

1. **Speed may not be the binding constraint.** Coaches may skip assessments because they don't
   want to write a judgement down about a child, not because the form is slow. If so this
   prototype solves the wrong problem and the 30-second number is vanity.
2. **The signature may be theatre.** If coaches sign every draft unread, Trak has automated the
   fabrication risk it just spent a security review closing — the same failure as a player
   writing his own assessment, wearing a coach's name.
3. **Drafting may flatten the coaches apart.** Six coaches describing six different kids could
   converge on the same three bands and the same house voice, which destroys exactly the
   signal a parent is paying attention for.
4. **It needs a model in the loop for every assessment.** That is a per-assessment cost on a
   product with no price and no payer decided, routed today through a gateway we don't own.
5. **Nothing here is hard to copy.** The prompt is the product. The moat, if there is one, is
   the accumulated signed record — which we do not have yet.

## What to watch in the pilot

- Median time from open to signature, and the share of drafts **edited before signing** — an
  edit rate near zero means claim 2 is true and the feature is dangerous.
- Band spread across coaches vs. the current slider baseline (claim 3).
- Week-8 assessment rate against the ≥50% week-4 drop-off kill criterion. That number is the
  only one that settles the bet.

## Known gaps in the prototype

Deliberately not built: voice capture (typed text stands in for speech), any Supabase write,
squad or multi-player flow, auth. The character axis shows one value from the draft Character
Profile — the content itself is still gated on the sports psychologist review.
