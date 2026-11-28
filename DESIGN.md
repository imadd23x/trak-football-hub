---
version: 1
status: confirmed        # provisional again while the "Assumed: confirm" table has rows
owner: Product (owner of the TRAK-768 design standard)
updated: 2026-11-28
---

# Design Contract

This is the agent-facing entry point for how Trak should look. It says what "good" means for Trak in rules that can
be measured. Tokens, type roles, spacing, corners and shared pieces are **not** repeated here: they live in the design
standard (`docs/design-system/`), and that standard wins on any value.

Build only with the standard's tokens and pieces. Audit against this file and the standard. When neither covers
something users will see, treat it as a **contract gap**: build what fits §1, then propose the rule (see §Audit).
Do not improvise silently.

## §1 Intent

- **Feels:** clear and practical; calm and trustworthy.
- **Never feels:** cluttered.

What that means here:

- **Clear & practical.** A coach mid-session finds the next action at a glance.
  - Each key screen has a declared eye order (§7) and one main action per view state.
  - Tap targets are at least 44 px.
  - Labels name the thing in plain words.
  - Every figure that lines up (dates, counts, scores, minutes) uses `tabular-nums`.
- **Calm & trustworthy.** Parents give consent here, so nothing shouts.
  - White canvas and slate neutrals cover almost all of the screen.
  - Colour appears only with meaning: `brand` means "do this" or "selected", `success` means done, `attention` means
    "needs you", `danger` means an error or a delete.
  - Status is always in words. Colour and icon only add to it (`StatusPill`).
  - Motion is limited to fades of 200 ms or less, explaining a change of state.
  - No banner or alert appears unless the person has something to do.
  - Text contrast is at least 4.5:1.
- **Never cluttered.**
  - The budgets in §8 are hard counts. Going over one is a violation, not a matter of taste.
  - Group with space first: cards 16 px apart, sections 40 px apart (`docs/design-system/spacing-and-corners.md`).
  - Only a box within a card may nest inside another container. Nothing nests deeper.

## §2 References

| Reference | Take this quality | Not this |
|---|---|---|
| The 24 Nov "Season plan (U16)" mockup behind TRAK-768 | White canvas, slate greys, uppercase section labels above airy cards, large tabular figures, status pills with words | Its sample content and names |

New references are recorded by quality only: no product names, no private links (this repository is public).

## §3 Typography

See `docs/design-system/colour-and-type.md` ("Type"): Inter everywhere, plus the type roles (page title, section label,
card title, body, caption, big figure, buttons and pills). Every piece of text maps to one of those roles.

## §4 Space & layout

See `docs/design-system/spacing-and-corners.md` ("Spacing") and the coach frame in `docs/design-system/components.md`.

## §5 Colour roles

See `docs/design-system/colour-and-type.md` ("Colour"). `hard-coded-colours.test.ts` and
`design-standard-tokens.test.ts` enforce it.

## §6 Shape, depth, motion

- Corners: `docs/design-system/spacing-and-corners.md` ("Corners").
- Motion: §1.
- `.trak-dark` islands and the team-kit designer keep their own look and are outside this contract.

## §7 Hierarchy & eye order

The eye order is what a squint at a phone screenshot (390 px wide) should show 1st, 2nd and 3rd. The main action is
the only filled `primary` button in that view state.

| Screen | 1st | 2nd | 3rd | Main action |
|---|---|---|---|---|
| Coach Home `/coach/home` | Today (the next session or match) | Needs you | Squad | The top "Needs you" next step; the other rows' steps are `secondary` |
| Coach assess `/coach/assess` | The player being assessed | The rating inputs | The note to the player | Save the assessment |
| Parent consent `/parent/consent` | What is being agreed to | The choices | Who sees what | Give consent |
| Parent Home `/parent/home` | The child's latest message and band from the coach | The next event | Alerts | none (a reading screen) |
## §8 Discipline budgets

| Count, per view state | Budget |
|---|---|
| Filled `primary` buttons | exactly 1, or 0 on a reading screen |
| Buttons in one card | ≤ 2 |
| Distinct text sizes | ≤ 5, each from a type role in §3 |
| Sections on one page | ≤ 6, each under a `SectionLabel` |
| Status shown by colour alone | 0 |
| `attention` marks in one row | ≤ 1 |
| Hard-coded colours, one-off corners or one-off spacing | 0 |
| Containers nested inside a card | ≤ 1 |

## §9 Components

See `docs/design-system/components.md`. New and changed screens use the shared pieces (`SectionLabel`, `SectionCard`,
`StatusPill`, `NumberBlock`, `DetailsStrip`, page header) and Arc's `Button` variants. They don't use their own classes.

## §Audit (how agents judge a screen)

1. **Measure first.** List the distinct text sizes, weights, colours, spacing values and corners. Count the filled
   `primary` buttons, the sections and the buttons per card. Compute contrast for each text and background pair.
2. **Then squint** at a 390 px screenshot and check the eye order in §7.
3. **Report** in this shape:
   - A verdict line, for example: "FAIL against DESIGN.md v1: 3 violations, 1 gap".
   - A table with the columns `# | Term | Rule (§) | Measured | Required | Fix`.
   - **Gaps:** where this file and the standard are silent, the proposed rule text.
   - **Taste notes:** opinion, labelled, no more than 3, never blocking.
4. **Scope.** This contract governs how things look. What exists on a screen (features, states, copy) comes from the
   issue and `MVP Requirements`. A taste word never justifies adding or rewriting content.

## §10 Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-11-24 | The design standard (TRAK-768): Inter, slate palette, near-black brand, shared pieces | One look by construction |
| 2026-11-28 | Intent: clear & practical, calm & trustworthy, never cluttered | Pilot users are coaches mid-session and parents giving consent |
| 2026-11-28 | Section labels stay uppercase but readable: the standard's 12 px bold, 0.12em, `ink-3` | The 8–9 px labels were below readable size |
| 2026-11-28 | TRAK-768 values win over any value proposed here | One source per value |
| 2026-11-28 | The eye orders and main actions in §7 for coach Home, coach assess, parent consent and parent Home | One clear next step per key pilot screen (TRAK-628) |
| 2026-11-28 | Coach Home's "Needs you": only the top row's step is `primary`, the others are `secondary`; no exception | One main action per view state (TRAK-628) |
| 2026-11-28 | Budgets: ≤ 2 buttons per card, ≤ 6 sections per page, ≤ 5 text sizes per view | Never cluttered, as counts (TRAK-628) |
| 2026-11-28 | Motion is fades of 200 ms or less only; the 0.4 s `fade-in` slide and the error `shake` are out | Calm (TRAK-628) |

## Assumed: confirm

None. An agent that picks a value the owner hasn't given adds a row here (§, assumed value, alternative), and the
status goes back to provisional until the owner confirms it.
