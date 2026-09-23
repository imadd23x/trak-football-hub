# 03 — The Margin: Cost Curve

*Session: 19 September 2026. **Every figure here is an illustrative assumption, not a measurement.**
Billing is out of scope for September 25 ([pilot plan](../../docs/pilot-readiness-2026-09-25.md)),
so this is the packaging, pricing and cost design for after the pilot.*

---

## Packaging decision

| Leader | Filler | Killer | Killer usage % | Bundle or add-on |
|---|---|---|---|---|
| **Player passport and coach-signed record** | **Agent-built session records** | **Trial application pack** (ages 16–18) | **~15%** of players · **~2%** of AI cost | **Add-on** |

**Leader — the feature they come for.** A believable record of the player: the coach's assessments
and feedback, the record they build, the parent view, and the passport — including the transfer
passport a player takes to a new club.

**Filler — nice add, bumps ARPU.** After each game or training the coach confirms attendance, gives
feedback and sets areas to work on; the agent turns that into a session record, fuses it with the
player's data and updates the passport. Priced per session, billed as a season pass.

**Killer — sell separately or die.** A structured profile and passport bundle for players applying
to academy trials or scholarships. A minority need it; bundling it would raise the price for every
player to serve roughly one in seven; and a school will not pay for a trial-application service for
every pupil. Sold separately, per pack.

### The 70% rule, applied

> *If Killer usage is >70%, it is probably an add-on.*

- **On the Killer, it doesn't trigger.** The trial pack is used by ~15% of players and drives ~2% of
  AI cost. It is an add-on for a segment reason, not a cost reason — the rule is a sufficient
  condition for an add-on, not a necessary one.
- **On the Filler, it does.** Session records are produced for every active player and carry ~72%
  of AI cost — the cost to watch is the feature every player uses, not the one few buy. The rule
  would meter it. With parents paying, metering fails: **the coach, not the parent, decides how many
  sessions are recorded**, and a usage cap would stop a child's record mid-month. So the Filler is
  priced per session but billed as a season pass, and a fair-use cap — two records per session — is
  the cost control instead of the meter.

### One change from the earlier pricing recommendation

The **transfer passport pack** was previously priced at 20 credits. It moves into the Leader,
covered by the season pass. The [threat board](../02-the-moat/threat-board.md) found player-owned
portability to be one of only two things no attacker takes; charging for it at the moment a player
changes club paywalls the moat at the exact moment it is meant to work. Bundling it costs about
**€0.09 per player-season** on average.

### Pricing rules this model assumes

1. **The parent pays, never the player.** Players are 13–18. Parents pay through the academy's
   season invoice, and directly only for extras they choose.
2. **Paying never changes the record.** No payment touches bands, assessments or coach notes.
3. **No child loses core development help because a family can't pay.** The academy can waive a
   child's pass, and an unpaid season freezes the record read-only — it is never deleted.
4. **Each workflow is a consent purpose** the guardian has switched on (P2).
5. **Offers go to the guardian, never to the child.**

---

## Pricing model

| Current pricing | Proposed AI pricing | Model |
|---|---|---|
| **None** — Trak has never charged; billing is out of scope for September 25 | **$10 per player per month**, paid by parents as a **$100 season pass on the academy's invoice**; trial application pack **$4**, bought by the guardian | **Hybrid** |

### 1. Strategy: Penetrate

**What we optimise: paid squad coverage** — players with an active season pass ÷ players on the
squad. Target: 100%. Not revenue per player.

- **The coach works at squad level.** A coach can't run Trak for some players and not others; partial
  coverage breaks the coach's workflow, and coach drop-off is already a pilot kill criterion.
- **Density is the moat.** The passport's value grows with every club and school that accepts it
  ([eight moats](../02-the-moat/eight-moats.md)); a player whose teammates aren't on it carries a
  half-empty network.
- **Margin allows it.** At $10 a month the model stays Healthy at pilot scale (below), so price can be
  traded for coverage.
- **The alternatives are free.** Veo bundles and Spond is free; the price must never be the reason an
  academy picks them.

**Guardrails:** gross margin ≥ 70% at scale; season pass ≤ 20% of the academy fee; price between a
quarter of and the full labour value of the work.

### 2. Unit of work

**A session added to the player's passport** — each game or training the coach records (attendance,
feedback, areas to work on), compiled by the agent into the record and passport. Priced per
session, billed per season: $100 ÷ ~160 sessions a season ≈ **$0.63 per session**. Parents aren't
metered on it, because they don't control how many sessions are recorded.

### 3. Structure

| | |
|---|---|
| **Base** | **$10 / month per player**, billed as a $100 pass for a 10-month season |
| **Usage** | **$4 per trial application pack** — the only thing billed per unit, and only when a guardian buys it |
| **Included** | Every session record, up to two per session (fair use); the transfer passport |

**Labour test.** A session record replaces about five minutes of someone writing up a player after
a game or training. At ~16 sessions a month and an illustrative $20 an hour, that is ~$27 of work
per player per month. $10 is about 38% of it — not a giveaway, and well within the work's value. The
$55 option below was about twice the labour value at one record per session.

**Proof.** None yet — nobody has paid Trak. What would justify the price, and what the pilot has to
show: parents open the passport after most sessions (the parent role is retired if under 20% of
invited parents ever open the app), and every session a player attends produces a record.

### How parents pay

1. **Through the academy, not a card at Trak.** The season pass is a line on the academy's own season
   invoice; the academy collects it and pays Trak per enrolled player. Every player on the squad is
   covered, parents pay the way they already pay, and Trak sends one invoice per academy instead of
   hundreds of card charges. The collection clause belongs in the academy agreement being drafted
   (P9).
2. **Payment rides on consent.** The guardian who approves the child's account and chooses its
   purposes (P2) is the paying parent. No record is built before that approval.
3. **One bill per guardian, a line per child.** Parent accounts already hold several children (P3).
4. **Non-payment never deletes a record.** An unpaid season freezes the passport read-only and
   exportable. The child keeps what exists.
5. **Withdrawing consent stops the pass** from the next month, with unused months refunded through
   the academy.
6. **Extras are the guardian's decision alone.** The trial application pack is bought by the
   guardian, charged to the guardian, and never offered to the child.
7. **Local prices:** AED in the UAE, € in Greece, set at parity with the $ list price.

**If an academy won't collect:** the guardian pays the season pass directly. Coverage then has to be
tracked squad by squad, because the coach's workflow depends on it.

### Price test

Test by academy, not by family — families in one squad talk to each other.

| Monthly price | Season pass | Share of ~€500 academy fee | Margin, 100 players | Margin, 1,000 players | Players for 70% margin |
|---:|---:|---:|---:|---:|---:|
| $5 | $50 | 10% | 51.7% · Caution | 87.3% | ~186 |
| **$10** | **$100** | **20%** | **75.7% · Healthy** | **93.6%** | **~78** |
| $15 | $150 | 30% | 83.8% · Healthy | 95.7% | ~49 |

### Conditions to test

1. **Academies agree to collect.** The whole policy rests on the season pass sitting on the
   academy's invoice.
2. **Parents see the value.** The proof metrics above.
3. **Every session gets recorded.** A parent who paid $100 for a record the coach doesn't update will
   want the money back — the coach input behind each record is now a refund risk.
4. **The agent compiles; it doesn't judge.** The evaluative words come from the coach. If the agent
   writes its own feedback, each record needs a coach's approval before the player sees it (T2).

### Tool block — the recommended policy

- Strategy posture: Penetrate
- Pricing model: Hybrid (base + usage)
- Unit of work metered: Trial application pack, bought by the parent
- Base fee ($/month): 10
- Price per unit: $4
- Estimated units/user/month: 0.015
- Implied revenue/user/month: $10.06

### Option considered first: $55 per player (Maximize)

- Strategy posture: Maximize
- Pricing model: Hybrid (base + usage)
- Unit of work metered: Summarise Game, Trainings and feedback per game and training.
- Base fee ($/month): 30
- Price per unit: $0.5
- Estimated units/user/month: 50
- Implied revenue/user/month: $55.00

**Why it was replaced:**

- **Willingness to pay.** $550 over a 10-month season is more than the ~€500 a year parents pay the
  academy ([REQUIREMENTS.md](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/9114f4c/REQUIREMENTS.md)); the season pass is 20% of it.
- **The meter billed parents for the coach's activity,** and a cap would have stopped a child's record
  mid-month.
- **Labour test:** at one record per session, $55 was about twice the value of the work.
- **Who pays the base:** a guardian-paid base left a child whose family couldn't pay with no record.
  The academy now collects, can waive a pass, and an unpaid season freezes the record instead.

---

## Cost model

### Assumptions

| Input | Value |
|---|---|
| Billing unit | Per player; parents pay through the academy's season invoice |
| Season pass | $10 a month — $100 for a 10-month season |
| Session records | Included — ~16 a month (one per session); fair use up to two per session |
| Trial application pack | $4, bought by the guardian; 15% of players buy one a season |
| Currency | $ and € at parity — the unit costs are too rough for exchange rates to matter |
| Season | 10 months |
| Squad | 15 players, 1 coach |
| Coach cadence | 4 Touchline drafts per player per month; 8 session plans per coach per month |

**Unit AI cost per delivered output** — to be replaced with measured cost per invocation:

| Workflow | Role | Unit cost |
|---|---|---:|
| Touchline assessment draft | Leader | $0.02 |
| Coach session plan (`coach-assistant`) | Leader | $0.05 |
| Transfer passport pack | Leader | $0.30 |
| Agent-built session record | Filler | $0.02 |
| Trial application pack | Killer | $0.60 |

The session record is priced as a single model call. The agent's real run — read the coach's input
and the player's data, write the record, update the passport — makes several calls and will cost
more; the curve below shows how little headroom a penetration price leaves.

### Per player per month

| Output | Count | AI cost |
|---|---:|---:|
| Touchline drafts | 4.00 | $0.080 |
| Coach session plans (share) | 0.53 | $0.027 |
| Transfer passport packs (average) | 0.03 | $0.009 |
| Agent-built session records | 16.00 | $0.320 |
| Trial application packs (average) | 0.015 | $0.009 |
| **AI cost** | **20.58** | **$0.445** |

Revenue: $10 season pass + $0.06 trial packs (average) = **$10.06**. AI cost is **4.4%** of revenue.

### Where the AI cost goes

| Role | AI cost per player per month | Share of AI cost |
|---|---:|---:|
| Leader | $0.116 | 26.0% |
| Filler | $0.320 | 72.0% |
| Killer | $0.009 | 2.0% |

---

## The curve

Revenue is **flat** per player — the season pass. AI cost **rises** with every session record. At a
penetration price, the gap between them is the whole margin.

How far AI cost can rise, with the $200 a month non-AI placeholder from the
[margin calculator](margin-calculator.md):

| AI cost multiplier | ×1 | ×5 | ×10 |
|---|---:|---:|---:|
| AI cost per player | $0.44 | $2.22 | $4.45 |
| Gross margin, 100 players | 75.7% | 58.0% | 35.9% |
| Gross margin, 1,000 players | 93.6% | 75.9% | 53.8% |

AI cost can rise only about **2.3×** at 100 players, and about **6.3×** at 1,000, before margin
falls below 70%.

Three consequences:

1. **Cost control is the discipline — that is what Penetrate means.** Measure the agent's real cost
   per session record first; route what can go to a cheaper model (the calculator's scenario lab).
2. **The fair-use cap is the cost control.** Two records per session bounds the Filler; at the cap,
   margin at 100 players is 72.5%.
3. **Anything metered must be parent-initiated.** Work whose volume the coach or the schedule
   controls belongs in the season pass, bounded by fair use.

---

## Not in this model

- **Non-AI costs:** hosting (Supabase, Vercel), monitoring (Sentry), email (Resend), support. The
  [margin calculator](margin-calculator.md) adds them as a placeholder — $2.00 of $10.06 per player
  at 100 players, the largest cost line at this price.
- **Payment processing:** the academy collects the season pass; card fees fall mainly on the $4
  extras, where a fixed per-transaction fee takes a large share.
- **The AI gateway.** Three edge functions still route through Lovable's gateway on
  `LOVABLE_API_KEY`; per-run cost depends on its pricing until they are re-pointed.
- **Coach time.** Not a cash cost, but a record can't exist without it — ~240 coach inputs a month
  for a 15-player squad.

## Measure first

1. **Cost per agent-built session record** — tokens and $ per record, across the whole multi-step
   run. Then `coach-assistant`, `parse-schedule` and `player-feedback`.
2. **Whether academies will collect, and at what price** — the price test above.
3. **Real sessions per player** per month.
4. **Trial pack uptake** among 16–18 year olds, which confirms or kills the Killer.
