# M1 — Three-Axis Diagnostic

*Session: 12 September 2026. Scored against the repository as it stood that day. Some inputs have
since changed — see the [README](../README.md#what-has-changed-since).*

Score each axis 1–5, name an attacker, and name the single biggest vulnerability in one line.

| Axis | Score |
|---|:---:|
| Contextual Moat — workflow depth × switching cost | **2 / 5** |
| Data Advantage — proprietary × compounding | **2 / 5** |
| Platform Exposure — encroachment risk × pivot speed | **3 / 5** |

---

## Contextual Moat — 2 / 5

**Rationale.** The coach workflow is real but shallow — six sliders and a three-field session log,
minutes per week. Switching cost is effectively zero: Trak deliberately owns no registration,
payments or scheduling, which is precisely the admin gravity that keeps clubs on LeagueApps and
SportsEngine. There are no integrations, no contracts (nobody has ever paid), and no data that
can't be abandoned between seasons. The intended moat — a record that accrues to the athlete
across ~10 club transitions — is a promise that only pays out after years of density that has not
yet begun accumulating.

**Named attacker.** **Hudl** — already inside academies, already owns the match-evidence workflow,
and can attach a rating and a shareable player card to clips it already holds. Second: the club's
own Google Form plus WhatsApp, which is free and good enough.

## Data Advantage — 2 / 5

**Rationale.** *Proprietary* scores genuinely high — longitudinal coach-authored assessments of
minors across six dimensions, plus self-rating-versus-coach alignment, is unscrapeable and
unpurchasable. *Compounding* scores near zero, and that is what sinks the axis: the rating engine
is hand-tuned static modifiers (baseline 6.5, a win is +0.3) that **do not learn from a single row
collected**, so the ten-thousandth match makes the product no better than the tenth. Worse, the
asset is legally self-limiting — minors' behavioural data under GDPR data minimisation, parental
consent and right to erasure means the corpus is punched full of holes by design.

**Named attacker.** **Hudl / Veo** on volume; more dangerously, **a national federation or a
multi-site academy chain**, either of which can mandate its own record and own the dataset
overnight.

## Platform Exposure — 3 / 5

**Rationale.** The best axis, and only because pivot speed rescues it. Real exposure: three edge
functions (`coach-assistant`, `parse-schedule`, `player-feedback`) still call the **Lovable** AI
gateway on `LOVABLE_API_KEY` — a company Trak no longer hosts with, for whom that gateway is not a
core business line — and all minors' data sat with US processors with no entity, DPA or DPIA
behind it. Mitigating: it's a PWA, so no app-store gatekeeper takes 30% or holds a veto; Supabase is
portable Postgres; the three functions are small enough to re-point at a first-party model in
days.

**Named attacker.** **Lovable** (gateway repricing or withdrawal) on infrastructure;
**Instagram / TikTok** on attention, where the highlight-reel "career record" already lives for
free.

---

**Top vulnerability:** *A coach-authored record nobody pays for, no institution is bound to, and no
athlete has a daily reason to open — the moat only arrives after years of density that haven't
started.* **Confidence: High.**

---

## Top 10 vulnerabilities

| # | Vulnerability | Why it bites |
|---|---|---|
| 1 | **Revenue thesis is entirely untested** | No one has ever paid; no decision on whether club, coach or parent is the payer. Billing doesn't exist. |
| 2 | **The athlete has no reason to open the app between matches** | The character module — "the athlete's only active role" — was unbuilt and gated on the psychologist review. "Player-first" is, in practice, coach-first. |
| 3 | **The validating evidence doesn't exist** | No named pilot club or school, and no 13–18 year old has described this pain in their own words. |
| 4 | **Coach labour is a single point of failure** | The record only exists if unpaid, part-time coaches keep assessing weekly. The kill criterion (≥50% stop by week 4) is written; no incentive design prevents it. |
| 5 | **Legal gate blocks revenue, not just polish** | No entity, no terms, no privacy policy, no parental-consent capture or audit trail, no DPIA — with minors' behavioural data on US processors. |
| 6 | **Proprietary data that doesn't compound** | Static algorithm, no feedback loop. Data accumulates as cost and liability, never as product advantage. |
| 7 | **Switching cost ≈ zero** | No admin workflow, no integrations, no contract. A club walks at season end and loses nothing. |
| 8 | **Trust is one authorization bug deep, and precedent exists** | A player could fabricate their own assessments — the flaw that destroys the only thing being sold. Test coverage was 9 test files for 162 source files (~6%), and backups had never been restore-tested. |
| 9 | **The "passport" isn't actually portable** | GDPR data export is unbuilt, there's no open format, and no institution has agreed to accept it. "Global" outruns football-only, one country, one unnamed club. |
| 10 | **No distribution whatsoever** | The business-model matrix scores "attract attention" as *Nothing*. Coaches don't search for assessment software and have no budget line. |

**The pattern across all three axes:** a trustworthy product with no business around it, and the
defensibility being pitched is time-dependent — it needs density that can only come from first
solving 1, 3, 4 and 10.
