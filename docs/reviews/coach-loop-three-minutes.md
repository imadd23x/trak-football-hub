# The three-minute loop: where the 8–10 minutes actually goes

| Document control | Value |
| --- | --- |
| Prepared | 19 September 2026 |
| Gate 1 box | *"Add players, assess six, log a match — under 3 min"* |
| Measured | 8–10 minutes, by Tarek, on a real phone |
| Status | **Not an engineering problem.** The bar measures two different things at once, and one of them only happens once. |

This is a structural count, not a timing. I cannot run a phone. What I can do is
count what the screens actually require, which nobody has, and that turns out to
answer the question.

---

## 1. The navigation is already optimal — that is not where the time goes

The obvious suspect is a coach walking back and forth between a squad list and an
assessment form. That is not what happens, provided they use `/coach/quick-assess`:

- It loads the whole squad in one query, sorts **unassessed first**, and steps
  through with an index. No navigation between players.
- It pre-fills each player's sliders from their **previous** assessment, so a
  repeat pass only moves what changed.
- Per player the coach taps **Next** (save and advance) or **Skip**.
- Adding players has the same property: `CoachAddPlayer` saves and stays, and the
  age group persists between saves.

**And it is discoverable.** The routed coach home renders a full-width accent CTA
straight to it whenever `playerCount > 0`. This is not a case of the fast path
existing and being hidden — I checked for that specifically, because this
codebase has already produced two of them.

So the flow design is fine. The cost is elsewhere.

## 2. Count the interactions and the bar answers itself

Every metric is an `<input type="range" min=0 max=10 step=1>` — a **drag**, not a
tap — and there are six per player.

| Step | Deliberate actions |
| --- | --- |
| Add 6 players | ~18 field interactions (name, position, shirt × 6; age group persists) plus ~70 keystrokes |
| Assess 6 players | **36 slider drags** + 6 Next taps = 42 |
| Log a match | a further form |
| **Total** | **60+ actions and ~100 keystrokes** |

In 180 seconds that is **under three seconds per action** — including deciding
what a child's work rate actually was. It is not reachable by making anything
faster, because nothing here is slow. There are simply that many decisions.

## 3. The bar conflates one-time setup with the recurring loop

This is the substance of it.

*"Add players"* happens **once per squad, ever**. *"Assess six"* happens **after
every session, all season**. They are in the same sentence and the same
stopwatch, and only the second one is what the business model rests on — the
pilot's success metric is coach habit, which is the repeat loop, not the setup.

Tarek's 8–10 minutes included creating the squad from nothing. **The number that
matters to the pilot is a coach on week three, whose players already exist and
whose sliders pre-fill from last week, assessing six.** That is 36 drags and 6
taps with no typing, and nobody has measured it — because the Gate 1 sentence
does not ask for it.

**Recommended:** split the box in two.

- *Setup:* a coach can get a squad of six into the product in one sitting. No
  time bar; it happens once and it is not the habit.
- *The loop:* assessing six players after a session, on a squad that already
  exists, in **under 3 minutes**. This is the number to defend, and the only one
  that should carry a stopwatch.

If the 3-minute bar must cover the loop as it stands, the cost driver is the 36
drags. A tap-to-choose-a-band control — seven bands, one tap — would replace each
drag with a tap. That is a real design change and I am not proposing it lightly;
I am saying it is the only lever of that size, and that a faster query or a
slicker transition is not.

## 4. A separate defect found while counting

On a first assessment there is no previous one to pre-fill from, so all six
sliders initialise to **5** (`CoachQuickAssess.tsx:51-56`), and the columns are
`NOT NULL DEFAULT 5` besides.

**A coach who taps Next without touching anything records six 5s**, which is
stored and displayed as a deliberate judgement that this player is average on
every metric. It is indistinguishable from a real assessment that says exactly
that.

Kostas hit the downstream half of this last night — *"the reason everything read
5"* — and correctly concluded the data was right and the screens disagreed. This
is the upstream half: some of those 5s may never have been chosen by anyone.

It is the same shape as the rest of this week — **absence of input recorded as
input** — and it matters more here than usual, because the output is a claim
about a child that their parent can read.

Worth deciding rather than patching: either a metric must be touched before the
assessment counts, or an untouched metric is stored as "not assessed" and the
band screens keep saying "Not assessed", which they already know how to do.

Coach surface, so Kostas's to take or leave.

---

## What I did not do

Time anything. Everything above is counted from the components — the slider
count, the input types, the pre-fill behaviour, the save-and-advance mechanic and
the entry points are all cited. **The 8–10 minutes remains the only real
measurement anyone has**, and the split in section 3 needs a second one to
confirm it: the same six players assessed again, a week later, on a squad that
already exists.
