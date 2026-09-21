# Margin Calculator, Module 3

*Session: 19 September 2026. Two runs of the same calculator: the workshop's worked example, kept as
provided, and Trak's own numbers taken from the [cost curve](cost-curve.md). Trak's figures are
illustrative assumptions, not measurements.*

---

## Workshop example

*As provided — these are the calculator's "Typical SaaS + AI" preset. Arithmetic checked: every
figure is correct.*

### Inputs
- Avg requests/user/month: 500
- Blended cost/request: $0.02
- Revenue/user/month: $80
- Non-AI COGS/user/month: $5

### Current Margin
- AI COGS/user: $10.00
- Total COGS/user: $15.00
- Gross margin: 81.3% ($65.00/user)

### Stress Test
| Scenario | AI COGS | Margin |
|----------|---------|--------|
| 3x Cost  | $30.00 | 56.3% ($45.00) |
| 2x Usage | $20.00 | 68.8% ($55.00) |

---

## How the calculator works

Rules worked out on 19 September by setting inputs on the course's M3 calculator and reading the
outputs; every rule below matched every probe exactly. Described in our own terms.

**Inputs, per user per month:** requests (R), blended cost per request (C — tokens plus infrastructure
overhead), revenue (P), non-AI COGS (O).

| Output | Formula |
|---|---|
| AI COGS | R × C |
| Total COGS | R × C + O |
| Gross margin | (P − total COGS) ÷ P |
| Gross profit | P − total COGS |

**Stress test.** Revenue and non-AI COGS stay flat. *3× cost shock* multiplies AI COGS by 3; *2×
heavy users* multiplies it by 2.

**Verdict bands.** Both verdicts use the same cut-offs:

| | ≥ 60% | 40–60% | < 40% |
|---|---|---|---|
| Current margin | Healthy | Caution | Danger |
| Stress verdict — judged on the 3× margin | Survives both | Survives, but thin | Fails |

The tool's wording for the bottom stress band says margins go *negative*, but it fires whenever the
3× margin is below 40%, even while still positive.

**Scenario lab.** Three sliders — cost multiplier (0.25–5×), volume multiplier (0.5–10×), and
**cascading**: the share of requests routed to a cheap model (0–95%).

> AI COGS = R × C × cost multiplier × volume multiplier × (1 − 0.9 × cascading share)

The cheap model is priced at **10% of the main model**, and it rises with the cost multiplier too.
Non-AI COGS does not move with volume.

---

## Trak

"User" is one player — the billing unit. A request is one **delivered AI output**: a Touchline draft,
an agent-built session record, a pack. Pricing and derivation are in the [cost curve](cost-curve.md):
a $10 a month season pass paid by parents through the academy, every session record included (~16 a
month), and a $4 trial pack bought by the guardian. $ and € at parity.

### Inputs
- Avg requests/user/month: **20.58**
- Blended cost/request: **$0.0216**
- Revenue/user/month: **$10.06** — $10 season pass + $0.06 trial packs, average
- Non-AI COGS/user/month: **$2.00** — *placeholder:* $200 a month of platform cost (hosting,
  database, monitoring, email) spread over 100 players

### Current Margin
- AI COGS/user: **$0.44**
- Total COGS/user: **$2.44**
- Gross margin: **75.7% ($7.62/user)**

### Stress Test

Revenue held flat in every row, as the calculator does — and here it really is flat, because the
season pass doesn't change with usage. Computed from unrounded inputs.

| Scenario | AI COGS | Non-AI COGS | Margin | Verdict |
|----------|--------:|------------:|--------|---------|
| Pilot, 100 players | $0.44 | $2.00 | 75.7% ($7.62) | Healthy |
| 3x Cost | $1.33 | $2.00 | 66.9% ($6.73) | Healthy |
| 2x Usage | $0.89 | $2.00 | 71.3% ($7.17) | Healthy |
| 10x Cost — agentic | $4.45 | $2.00 | **35.9% ($3.61)** | Danger |
| 1,000 players | $0.44 | $0.20 | 93.6% ($9.42) | Healthy |
| 1,000 players, 10x Cost | $4.45 | $0.20 | 53.8% ($5.41) | Caution |

**Calculator stress verdict**, judged on the 3× margin (66.9%): **survives both** scenarios — but a
10× agentic cost puts pilot scale in Danger.

### Records per player: the input that moves cost

Revenue is fixed by the season pass, so more records per player only add cost.

| Session records per player per month | Margin, 100 players |
|---|---:|
| 16 — one per session | 75.7% |
| 32 — the fair-use cap, two per session | 72.5% |
| 50 — above the cap | 68.9% |

### What the calculator shows

1. **At $10 per player, pilot scale is Healthy (75.7%) but has little headroom.** AI cost can rise
   only ~2.3× before margin drops below 70%; at 10× it is in Danger.
2. **About 78 paying players cover a $200 monthly platform bill** at a 70% margin — one or two
   academies.
3. **Routing to a cheaper model is a requirement at this price, not an option** — see below.
4. **The fair-use cap protects the margin.** Past two records per session, margin falls under 70%.

### Scenario lab: routing to a cheaper model

At 10× AI cost, sending 70% of requests to the cheap model lifts margin from 35.9% to **63.8%** at 100
players (Danger to Healthy) and to **81.7%** at 1,000. The session record carries ~72% of AI cost, so
it is where routing matters — once measured cost shows whether a cheaper model can build the record
without losing quality.

### Replace first

1. **Cost per agent-built session record.** The multi-step run — tokens and $ per record.
2. **Non-AI COGS.** Replace the $200 a month placeholder with real invoices for hosting, database,
   monitoring and email. At this price it is the largest cost line.
3. **Sessions per player.** The pilot's real count per month.

**Breakeven check:** paying players needed for a 70% margin = monthly platform cost ÷
(0.30 × revenue per player − AI COGS per player) = $200 ÷ ($3.02 − $0.44) ≈ **78 players**.
