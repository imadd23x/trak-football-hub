# S3 — what the scorecard says about athlete logging

Decision note for Kostas. Everything here is queried from the live database, not
from the view definitions.

**This corrects my own earlier characterisation.** I had recorded S3 as *"
`pilot_match_coverage` has zero player-logged rows, so the Q4 metric reads 0%
permanently."* The second half is wrong. The metric reads **66.3%**. The first
half is right, and is sharper than I had it.

---

## What the metric actually reads

`pilot_match_coverage` — scorecard metric 2, target `>=70% logged`:

| | |
|---|---|
| expected rows (fixture × linked player) | **98** |
| logged | **65** |
| **overall coverage** | **66.3%** |

Per week, which is how `pilot_scorecard` aggregates it:

| week | fixture date | expected | logged | coverage |
|---|---|---|---|---|
| 1 | 2026-07-22 | 14 | 10 | 71.4% |
| 2 | 2026-07-29 | 14 | 11 | 78.6% |
| 3 | 2026-08-05 | 14 | 11 | 78.6% |
| 4 | 2026-08-12 | 14 | 11 | 78.6% |
| 5 | 2026-08-19 | 14 | 11 | 78.6% |
| 6 | 2026-08-26 | 14 | 11 | 78.6% |
| **7** | **2026-09-05** | **14** | **0** | **0.0%** |

So six weeks clear the 70% bar and the seventh is empty. **Week 7's fixture is
5 September — in the past, not pending**, so that zero is a real gap rather than
a fixture that has not happened yet. Nobody logged anything against it.

Worth noting the aggregation matters to the answer: **per week, six of seven
pass. Taken as one number, 66.3% fails.** `pilot_scorecard` reads it per week.

---

## The finding, which survives

**Every logged row in the pilot was logged by a coach. None by a player.**

Confirmed two independent ways:

```
within pilot_match_coverage      coach 65   player 0   (not logged) 33
matches joined to pilot coaches  coach 71   player 0
```

`matches` does contain 11 `logged_by_role = 'player'` rows — but they run
2026-02-15 to 2026-07-14 and belong to players outside the pilot roster. **Inside
the pilot, the count is zero.**

So the metric named "match coverage" is being satisfied **entirely by coaches
logging on players' behalf**. That is a legitimate thing to measure, and it is
what the view is written to measure — `logged` is `m.id IS NOT NULL`, with no
condition on who logged it. The view is not broken.

**The problem is what the number is used to claim.** If the pilot's proposition
includes athletes recording their own matches, this metric does not evidence it
and cannot be made to: it would read the same if no athlete ever opened the app.

---

## The decision

Three options. This is a product call, not an engineering one, which is why
nothing is changed here.

**1. Leave it, and describe it accurately.** Metric 2 is "was this fixture
recorded at all", which is a real operational question — it tells the academy
whether its record is complete. Requires only that the runbook and any deck
stop implying it measures athlete engagement. **Cheapest, and honest.**

**2. Split it.** Keep coverage as-is, add a sibling that reads
`logged_by_role = 'player'` over the same denominator. Two numbers: *is the
record complete* and *are athletes using it*. One view, no schema change. Today
the second would read **0%**, which is the point of having it.

**3. Redefine metric 2 to require player logging.** Then the scorecard reads 0%
for all seven weeks and keeps reading 0% until athlete logging is actually used.
Accurate against a stricter claim, and it turns a passing metric into a failing
one six days before the pilot.

I would take **2**. It costs one view, it makes the existing number defensible
rather than quietly overstated, and it puts the uncomfortable figure on the board
where a decision can be made about it — instead of leaving it inferable only by
someone who reads the view definition.

**What I am not doing:** picking. Metric 2 is in `pilot_scorecard`, which feeds
the academy-facing report, and changing what a customer-facing number means is
not mine to decide unilaterally.

---

## Week 7 — investigated, and it is a defect in the metric

I first recorded this as "either the calendar entry is stale or a logging path
stopped working, I have not investigated which". It is neither.

**`pilot_match_coverage` counts unpublished draft calendar entries as fixtures.**

The `fixtures` CTE is:

```sql
FROM public.coach_calendar_events e
JOIN public.pilot_coach_ids() pc ON pc.coach_user_id = e.coach_user_id
WHERE e.event_type IN ('match', 'tournament')
```

There is **no `published` filter**. Weeks 1–6 are twelve events, all
`published = true`, all with real opponents, two coaches each. Week 7 is two
events dated 5 September, both by a single coach, both:

| | |
|---|---|
| `published` | **false** |
| `opponent` | **null** |

They are half-finished drafts. No match was played, so nothing could be logged
against them — and `matches` confirms it: nothing at all on 5 September, the
last rows in that window being 26 August and 1 September.

The product already treats unpublished events as invisible — `PlayerHome`'s
calendar query filters `.eq('published', true)`. The metric does not.

### What it costs

Splitting the same query by `published`:

| fixtures | expected | logged | coverage |
|---|---|---|---|
| **published** | 84 | 65 | **77.4%** |
| unpublished drafts | 14 | 0 | 0.0% |
| *as the view currently reports* | *98* | *65* | *66.3%* |

So a coach's two unfinished drafts are the entire difference between the
scorecard reading **77.4%, above the 70% target**, and **66.3%, below it** — and
they alone produce the 0.0% week.

### ⚠️ Read this before agreeing with me

**This fix moves a customer-facing number in our favour**, from failing to
passing. That is the direction that deserves the most suspicion, not the least,
so I am flagging it rather than presenting it as a win. I have not changed
anything.

The argument that it is a defect and not a convenient reinterpretation: the view
is named `pilot_match_coverage` and its comment says *"Target: >=70% logged"* —
an unplayed draft with no opponent is not a fixture by any reading, and counting
it means the academy's number can be moved by a coach opening the calendar and
not finishing. The counter-argument worth hearing is that a draft may represent a
real fixture someone forgot to publish, in which case the miss is genuine and the
current number is right.

**The fix, if agreed, is one line** — `AND e.published` in the `fixtures` CTE —
in a new migration against `20260901000005`. It touches `pilot_scorecard`, so it
wants a second pair of eyes for the reason above, and I would want the same
suspicion applied to it that I am applying myself.
