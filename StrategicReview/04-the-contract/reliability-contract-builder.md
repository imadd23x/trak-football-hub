# Reliability Contract Builder, Module 4

*Session: 19 September 2026. The course's capstone tool for Module 4. Trak's contract is in
[golden-dataset.md, section 5](golden-dataset.md#5-reliability-contract). This file keeps the
worked example and records how the builder works.*

---

## Worked example — as provided

*A customer-support copilot. This is what the builder's "Load worked example as starter" fills
in.*

## Reliability Contract

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Accuracy | 92% | Weekly · 300 golden rows · LLM-as-Judge (GPT-4o, accuracy rubric) | <88% → page on-call |
| Hallucination rate | <1% | Same weekly run · safety rubric flags fabricated policies/numbers | >2% → auto-rollback to last good model |
| Latency (p95) | <800ms | Continuous prod monitoring (Datadog) · p95 by endpoint | >1200ms for 5min → page on-call |
| Drift velocity | <0.5%/wk | 4-week rolling accuracy trend vs. golden dataset | >1% decay/wk → trigger gold-set audit |

## HITL Architecture

**Trigger:** Confidence <60% OR safety rubric flag fires on a customer-facing output

**Reviewer:** Rotating PM on call (weekday 9-5 ET) · senior CSM after hours

**Feedback loop:** Reviewer corrections feed back into the weekly gold-set audit. 5+ corrections in a week triggers a model retrain candidate.

---

## How the builder works

Worked out on 19 September by filling the builder in the browser, capturing its "Copy Reliability
Contract" output and changing one field at a time. The page's script could not be read directly.
Described in our own terms.

**Five sections:** four metrics and HITL Architecture. Each metric has a target, an alert
threshold, a measurement and one consequence. HITL has a trigger, a reviewer and a feedback loop.

**Output:** a `## Reliability Contract` table with the columns Metric, Target, Measurement and
Alert Threshold, then `## HITL Architecture` with three bold labels. The Alert Threshold cell is
the threshold followed by "→" and the consequence.

**Consequences:** exactly one per metric. Choosing a second one clears the first. Each prints as
fixed wording:

| Button | Prints as |
|---|---|
| Page on-call | page on-call |
| ⏮️ Auto-rollback | auto-rollback to last good model |
| Gold-set audit | trigger gold-set audit |
| Human queue | route to human review queue |

The builder marks a suggested consequence for each metric: page on-call for accuracy and latency,
auto-rollback for hallucination, gold-set audit for drift.

**Guidance bands** printed beside each target. They are not included in the output:

| Metric | Bands |
|---|---|
| Accuracy | 90–95% defensible · 99%+ vanity · < 85% rebuild |
| Hallucination rate | < 1% defensible · < 2% acceptable · ≥ 2% "Air-Canada zone" |
| Latency (p95) | < 500 ms chat · < 2 s agent · > 5 s losing users |
| Drift velocity | < 0.5% / 4 weeks defensible · < 1% / 4 weeks watch · > 1% / 4 weeks investigate |

**Tips the builder gives:** pick an accuracy number you can hit and measure weekly, not the
highest one. Hallucination should trigger a rollback, not a page. Latency is the only metric
measured continuously. Drift should trigger a gold-set audit, not a rollback. HITL is a crutch
unless its corrections feed back into the gold set.

The builder saves its state in the browser. Trak's values are what it holds now.
