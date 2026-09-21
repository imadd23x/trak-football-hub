# Strategic Review — Trak Football

Outputs of a strategy workshop run against the Trak codebase and docs on **12 September 2026**, with
the margin and contract modules added on 19 September: where Trak places its bet, a working
prototype of the most critical use case, a stress test of whether anything about the business is
defensible, how it should package and price, and why anyone should trust what its AI writes.

**Read [What has changed since](#what-has-changed-since) first.** The analysis is kept exactly as
delivered, but several facts it rested on have been superseded by the
[September 25 pilot plan](../docs/pilot-readiness-2026-09-25.md).

---

## Contents

Grouped by workshop module. Module 1 is named in the workshop's own material ("your M1 Three-Axis
Scorecard"); the moat exercises follow it in order, each building on the one before. The margin and
contract modules use the workshop's own paths, `03-the-margin/cost-curve.md` and
`04-the-contract/golden-dataset.md`.

### [01-the-bet/](01-the-bet/)

| File | Question it answers |
|---|---|
| [strategy.md](01-the-bet/strategy.md) | What is the strategy in three sentences, and how do we pitch Trak to a CEO as an athlete passport? |
| [three-axis-diagnostic.md](01-the-bet/three-axis-diagnostic.md) | How defensible is Trak on moat, data and platform exposure — and what are the top 10 vulnerabilities? |
| [prototype.md](01-the-bet/prototype.md) | What did we prototype for the most critical use case, and what claim should the pilot attack? |
| [touchline-prototype.html](01-the-bet/touchline-prototype.html) | The prototype itself. Open in a browser; live version at the link in `prototype.md`. |

### [02-the-moat/](02-the-moat/)

| File | Question it answers |
|---|---|
| [moat-stress-test.md](02-the-moat/moat-stress-test.md) | Which axis is weakest, and who exploits it? |
| [eight-moats.md](02-the-moat/eight-moats.md) | Of the eight classic moats, which is actually available to Trak? |
| [data-flywheel.md](02-the-moat/data-flywheel.md) | Does usage make the product better — and which loop is the vulnerability? |
| [threat-board.md](02-the-moat/threat-board.md) | Who attacks, from where, how fast, and how much value is at risk? |
| [90-day-encroachment-plan.md](02-the-moat/90-day-encroachment-plan.md) | What would the strongest attacker do in 90 days, and how does Trak defend? |

### [03-the-margin/](03-the-margin/)

| File | Question it answers |
|---|---|
| [cost-curve.md](03-the-margin/cost-curve.md) | What do customers come for, what is metered, what is sold separately, how is it priced — and where does AI cost break the margin? |
| [margin-calculator.md](03-the-margin/margin-calculator.md) | What is Trak's gross margin per player, and what breaks it — AI cost, usage, or scale? |

### [04-the-contract/](04-the-contract/)

| File | Question it answers |
|---|---|
| [golden-dataset.md](04-the-contract/golden-dataset.md) | How do we test the agent's output, how does the coach see its confidence, and what reliability do we promise? |
| [confidence-ux.md](04-the-contract/confidence-ux.md) | What does the coach see at each confidence tier, and what can they control? The course tool's output and how the tool works. |
| [reliability-contract-builder.md](04-the-contract/reliability-contract-builder.md) | The course's worked reliability contract, and how its builder works. Trak's own contract is section 5 of golden-dataset.md. |

`00-Makis` is an existing placeholder in this folder and was left untouched.

---

## Headline findings

- **No moat today.** Nothing scores above 2 / 5 across the eight moats. The M1 diagnostic scored
  Contextual Moat 2, Data Advantage 2, Platform Exposure 3.
- **One defensible position is available: Regulatory × Network** — the only record of a young
  athlete's performance and conduct that a school can lawfully hold and another institution will
  accept. The moat is who accepts the certificate, not the software.
- **The data flywheel scores 5 / 20.** The weakest loop is Correction. The one move: persist
  `source_text`, `drafted_band`, `signed_band` and `coach_id` on every assessment — with the GDPR
  legal basis for model improvement designed in *before* the first row.
- **The sharpest attacker is Veo**: a coach assessment stapled to footage the camera already
  captured, shipped free to an installed base in 6–9 months. Veo's 90-day plan out-bites Trak's
  defence.
- **Touchline — Claude drafts, the coach signs.** The prototype's central idea is that an
  AI-authored assessment destroys believability the same way a self-fabricated one does.
- **Package as Leader / Filler / Killer:** the player passport and coach-signed record is what
  customers come for; agent-built session records — the coach judges, the agent compiles — are
  priced per session but billed as a season pass; the trial application pack is sold separately.
- **Priced for squad coverage, paid by parents through the academy.** Penetrate, not Maximize: a
  $100 season pass ($10 a month, 20% of the ~€500 academy fee) on the academy's own invoice, with
  only parent-chosen extras billed per unit. On illustrative costs, margin is 75.7% at 100 players
  and ~78 paying players cover a $200 platform bill — but AI cost can rise only ~2.3× at pilot
  scale before margin drops below 70%, so cost control and routing to cheaper models are the
  discipline. The $55-a-month option was replaced: it cost more than the academy fee and metered
  parents for the coach's activity.
- **Trust comes from the coach's signature and the source, not accuracy.** Trak has no evals
  today, and `player-feedback` already writes AI text to children with no filter on numbers. The
  contract module sets a 10-row golden dataset (4 adversarial, including prompt injection and a
  safeguarding disclosure), three confidence tiers where no tier signs for the coach, and a
  reliability contract: fidelity ≥ 92%, invented claims < 1%, safety leaks zero and checked on
  every live draft.

---

## What has changed since

Checked against [docs/pilot-readiness-2026-09-25.md](../docs/pilot-readiness-2026-09-25.md) and
the repository on 19 September 2026. [CLAUDE.md](../CLAUDE.md) now marks `docs/pm/STATE.md` and
`docs/features-outstanding.md` — both used as inputs to this analysis — as historical.

### Superseded

| The analysis assumed | The current plan says | Affects |
|---|---|---|
| Greece first | **UAE first, Greece on the same build** | strategy, threat board |
| No parental-consent capture | Backend-enforced guardian consent below 18 in both countries, with purpose choices and withdrawal (P2); only minimal roster setup before approval | diagnostic #5, eight moats, threat board, 90-day plan |
| No terms or privacy policy | Drafts of terms, privacy policy and an academy agreement are in scope (P8, P9) | same as above |
| Backups never restore-tested | A restore rehearsal with recorded duration is a deliverable (S5) | diagnostic #8 |
| 9 test files for 162 source files | 29 test files for 198 source files, plus a harness suite | diagnostic #8 |
| Character axis as defensible ground | The character module is **explicitly out of scope** for September 25 | moat stress test, eight moats, 90-day plan |

### Confirmed by the team's own decisions

| The analysis concluded | The current plan says |
|---|---|
| The coach must sign before an AI draft counts (Touchline) | AI feedback is invisible to children until a coach approves it (T2, verification U6) |
| Cross-club isolation is deliberate and blocks a data network effect | Cross-academy isolation is a named deliverable (K1, verification U7) |

### Still open

- **No billing yet.** Billing is out of scope for September 25. The pricing policy has parents
  paying a season pass through the academy's invoice; whether academies will collect it is untested.
- **No real-child pilot yet.** September 25 is a synthetic-account demonstration; real-child
  admission is a separate gate with its own requirements.
- **No AI evals.** No golden rows, judge or prompt/model version record exist; the contract module
  lists what to do before September 25.
- **GDPR data export** — the portability the passport depends on — does not appear in the
  September 25 scope.
