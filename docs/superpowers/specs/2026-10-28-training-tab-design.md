# Training tab: technical design

TRAK-293 is the product spec and wins on behaviour; its five sub-issues (TRAK-294 to TRAK-298) are the build order.
This file says how it is built: tables, read rules, routes and screens. A slice that changes a decision here updates
this file in the same PR.

## Objective

Each training gets a plan and one loop: Logistics (from the schedule) → Plan → Who's here → Notes (optional). The
plan is built from Trak's Drill Library, fitted to the squad, and the coach can reuse a past plan. View is the plan
read at the pitch side; Run it left the loop (TRAK-309). A training closes on its own once it has ended with its
register taken (Kostas, 28 Oct). Everything sits behind the `training` academy switch. With the switch off, Trak
behaves exactly as before. (TRAK-395 brought this file up to date with what's live on 9 Nov.)

## Decisions this rests on

- TRAK-293's decisions (Kostas, 27 Oct), unchanged.
- **Training replaces Library in the nav** where the switch is on. The old FA Library (`/coach/trainings/...`, with
  Play It Right) stays as it is for academies with the switch off. Since TRAK-394 nothing in Training links to it, and
  players keep Play It Right on their Trainings page. Nothing is deleted.
- **Coach only.** No player, guardian, other coach or academy admin reads a drill or a plan in this build, so there
  are no copy tables (unlike Games).
- **No coach-made drills for the pilot** (Kostas, 8 Nov). Every drill is a Trak Library drill; a coach bookmarks one,
  never changes it.
- **Times are the academy's.** Coming up and Last week compare instants (`starts_at`, `ends_at`), which the database
  sets on the academy's clock (TRAK-175). A training with no time lasts its whole day, as TRAK-230 locks it.
- **Not built** (TRAK-293): Build it with Trak, Homework, Value of the month, the objectives nudge, "What this session
  covers", the weekly check-in. Their data doesn't exist yet.

## Tables

Every new table: RLS on; nothing granted to `anon`; `authenticated` gets only the operations a rule below backs.
Every text field has a length limit.

| Table | Key | Holds | Slice |
|---|---|---|---|
| `coach_drills` | `id` | The coach's own single drills: name (≤80), usual minutes (5–60), how it works (≤1000), what you'll tell them (≤500), and the five details (≤120 each). **Empty and unused since 8 Nov** (no coach-made drills for the pilot); kept for that later feature. | 294 |
| `training_plans` | `event_id` | One plan per training event (`coach_calendar_events(id) ON DELETE CASCADE`), and its coach. | 295 |
| `training_plan_practices` | `event_id, position` | The plan's practices in order (positions 1–12): name, minutes, how it works, what you'll tell them, the five details (drills' limits), where it came from (`own`, `drill`, `library`, `trak`) and the drill (`ON DELETE SET NULL`) or Library session it came from. A practice is a copy: changing or deleting a drill never changes a plan. TRAK-391: `trak_level` (0–7, a Trak drill only), the Library drill's Easier / Harder level as the coach set it; null for every other practice and every older plan. `save_training_plan()` writes it; drafts carry it in `body`. | 295, 391 |
| `coach_drill_bookmarks` | `coach_user_id, drill` | The Library drills a coach bookmarked (My drills): the drill's Library id (1–40) and when. See Drill Library below. | 390 |

## Read and write rules

**The coach** reads, adds, changes and deletes their own rows (`coach_user_id = (select auth.uid())`). Writes also
pass restrictive rules, as events do: `is_coach()` and the academy's `training` switch on (`feature_on('training')`).
Reads don't need the switch, so switching Training off hides the tab without losing anyone's drills or plans.

From 295, a plan's event must be the coach's own training, not cancelled, and a practice can name only the coach's
own drill. A plan is saved whole by `save_training_plan(event, practices)` (1 to 12 practices, all or none), so a
half-saved plan can't exist. It runs as the coach (`SECURITY INVOKER`), so the rules above apply unchanged, and says
in words why it refuses (not your training, cancelled, no practice, more than 12). Practices are replaced whole on
each save, so the coach gets select, insert and delete on them, never update. Drafts (`training_plan_drafts`) are the
coach's own, saved by Save as draft.

Nobody else reads these tables.

## Routes and screens

| Route | Screen | Slice |
|---|---|---|
| `/coach/training` | Sessions, laid out like Matches: the Next training card (where it is in its loop and its one next action), Upcoming trainings in a row (four, the rest one tap away), Notes asked on the card after a training | 294, 339 |
| `/coach/training/past` | Past trainings, with their plans; Use this plan copies one into a training coming up | 297, 339 |
| `/coach/training/drills…` | The Drill Library (see below) | 387–394 |
| `/coach/training/:eventId/plan` | Plan session: the plan's parts one step each, then Review | 340, 392 |
| `/coach/training/:eventId` | The plan (Review once saved): Edit one part, × to remove (with Undo), Add a part, the loop strip | 295, 341 |
| `/coach/training/:eventId/here` | Who's here: the register, then each Library drill refitted to the players who came | 342, 393 |
| `/coach/training/:eventId/view` | View: the plan at the pitch side, big type, when each practice starts. `/run` redirects here | 298, 309 |

**Plan session** (TRAK-340, `src/pages/coach/training/Planner.tsx`). A plan is a list of parts (Trak's five: Dry
warm-up, Passing & movement, Rondo, Functional drills, Game; or the shape the coach saved last time; extra parts: Set
pieces, Finishing, Cool-down or one the coach names). The coach goes through them one step each, then Review, and saves
the plan whole; Save as draft keeps it for later. Each part offers three Library drills and See more; Your session,
beside it, is the whole session at a glance. How the drills are chosen: see Drill Library below.

**The loop** (TRAK-298, TRAK-309). Each step comes from what exists, so nothing new is stored: Plan is a saved plan;
Who's here is the register taken (the event's completed session, TRAK-138), opened with the existing `TakeRegister`
(published, not cancelled, started); the training closes on its own once it has ended with its register taken.

A drill sent from its page, or a copied plan, travels in the planner's own history entry: changing between phone and
laptop width lays the coach's pages out again, and the planner must come back with it. Saving replaces that entry with
the plan, so Back never reopens the planner to add it twice.

Every route is inside `ParkedScreen unless="training"`, so with the switch off the screen shows "Coming soon" and
every write handler stops at `useParked()`.

Code: `src/pages/coach/training/`, `src/components/coach/training/`, `src/lib/training/`.

## Drill Library (TRAK-384, built 8–9 Nov)

The Library is the Drills tab and feeds Plan session. It was built in 11 steps (TRAK-385 to TRAK-395). The engine is
`src/lib/training/library/`, with no screens:

- **Drills** (`drills.ts`) live in the app, not the database: a coach can only bookmark a Trak drill, never change
  it. Each id starts with `lib-`, so an old plan's `trak_drill` (`w1`, `p1`… from `shelf.ts`) never finds a Library
  drill. An id never changes once a plan can name it.
- **The real library** (TRAK-388, Kostas's pick list, 9 Nov; read through 10 Nov): 54 drills, from Trak's 45 built-in drills (`shelf.ts`)
  and the useful FA sessions, merged and rewritten in our own words (no FA text). Kept drills also take the merged
  drills' old names as search words. Retired drills (`RETIRED`: Copy your partner, Follow and copy; and, merged on 10
  Nov, Steal the ball, Win it back in five, Cross and attack the box) are never listed,
  searched or offered, but `libraryDrill(id)` still finds them for saved plans. Set pieces wait until after the pilot;
  the FA's under-12 games and six-week programmes are left out. Steve checks the wording after the pilot (Kostas,
  9 Nov); the pages don't say it's unchecked.
- **Kinds** (`kinds.ts`): Get ready (Dry warm-up and, from TRAK-388, Cool-down), then Technical, Skill and Game
  related, each with its drill types. Each drill fits one of the session's parts (`partFor`: Dry warm-up → Dry
  warm-up, Cool-down → Cool-down, Technical → Passing & movement, Skill → Rondo, a small-sided game → Game, other Game
  related → Functional drills).
- **Fit** (`fit.ts`): a drill fitted to any number of players at one of 8 levels gives the five details (area,
  numbers, targets, direction, conditions). Every drill starts at level 4 of 8. Easier / Harder goes to the next
  level that really changes something and says why; Players today refits at the same level. Each drill names a
  template (how it takes its players); a few options tune one (TRAK-388): `long` pairs are 20–40 m apart, `solo` gives
  everyone a ball and no partner, `group` fixes the numbers in each turn (1 v 1), and a shooting drill's own rule
  replaces the serve. The 10 Nov read-through: fewer players in a turn get a proportionally smaller area (1 v 1 is
  about 20x15 m), a three-team game gets 2.5 times a rondo's room, and a position practice leaves at most about three
  waiting.
- **Search** (`search.ts`): by name, type, other names coaches use, topics and the fitted numbers, with "4 v 4" =
  "4v4" and one spelling slip allowed (two in long words).
- **Pitch picture** (TRAK-386): `pitch.ts` lays a fitted drill out to scale on a 640 × 420 canvas, with roles, not
  colours; `components/coach/training/library/DrillPitch.tsx` draws it in the fixed pitch colours
  (`lib/fixed-colours.ts` `PITCH`). `full` is the whole canvas with the size line and a one-line description for
  screen readers; `card` zooms onto the drill and is hidden from screen readers, as the card says it in words.
  `PitchKey` says what each colour means. Drills played in turns draw the players who are on. Long gaps are drawn
  shorter so they fit; the size line still says the real gap. Known gap: Sweep behind the line uses the shooting
  picture until it gets its own.
- **Drills tab** (TRAK-387): `/coach/training/drills` is the Library home (Find a drill, My drills, All drills, the
  three kinds, then Change any practice, Individual work and Goalkeeping); `drills/kind/:kind` a practice page, `drills/all` All
  drills (`?show=` a kind, Individual or Goalkeeping), `drills/mine` My drills (bookmarks, TRAK-390), `drills/d/:id` a
  drill's page. Searches and filters
  sit in the address (`?q=`, `?type=`, `?show=`), so Back returns to them. Every picture is fitted to the squad picked
  at the top (the whole roster on All), kept to 8–20 players, at level 4 of 8. Code: `src/pages/coach/training/
  DrillLibrary.tsx`, `src/components/coach/training/library/DrillCard.tsx`, paths in `src/lib/training/library/paths.ts`.
- **A drill's page** (TRAK-389): kind, type and "Also called" (3 other names); Players today (8–20) refits the drill;
  the picture and key; Easier and Harder move to the next level that changes something and say what changed and why,
  greyed out at the end; the five details, the changed ones marked; why, how to play, watch for; Another drill (the
  next of the same type). Players, level and the last change are kept in the page's history entry, so the page laid
  out again (phone ↔ laptop) or opened with Back comes back the same.
- **Add to training** (TRAK-391): on a drill's page, a pop-up "Add <drill> to which training?" lists the trainings
  coming up (the squad picked at the top, or all), each with day, time and Not planned / Draft / Planned. Picking one
  opens Plan session at Review with the drill as a new part at the end (Kostas, 8 Nov): of the draft if there is one,
  else the saved plan, else the coach's usual shape. Its part is `partFor`'s, with that part's
  usual minutes; its five details are the fitted ones in words, at the players and level set on the page, so View and
  Home's Today card show it unchanged. Nothing is saved until the coach saves. Already in that plan: said, not added
  twice; a plan of 12 parts: said, not cut. Once a training coming up holds the drill (plan or draft), the button
  reads "Added to <day>" and opens that plan, with "Add to another training" under it. The planner's state is
  `{ addLibrary: { drill, players, level } }` (replaces TRAK-296's `addDrill`). Code:
  `src/components/coach/training/library/AddToTraining.tsx`, `fromLibrary` / `libraryPart` in `src/lib/training/parts.ts`.
- **Bookmarks** (TRAK-390): My drills is the Library drills a coach bookmarked. `coach_drill_bookmarks`
  (`coach_user_id`, `drill` = the Library id, 1–40 characters, `created_at`; one row per coach and drill): only the
  coach reads, adds or takes out their own; adding and taking out need the training switch (restrictive rules),
  reading doesn't, so switching off keeps them; nothing to change, so no update grant. A bookmark sits in every card's
  corner and as Add to My drills / In My drills on a drill's page, with a short message each time; a failed save puts
  it back and says so. The Library home counts them; My drills groups them by kind. A bookmark for a drill no longer
  in the Library is ignored.
- **No coach-made drills** (Kostas, 8 Nov): New drill, the list of the coach's drills and Add to the next training
  left the Drills tab; migration `20261109000000_drill_library_clean_start.sql` deleted the hand-written drills, every
  plan that used one, and any draft that did. `coach_drills` stays, empty. Plan session's Write your own and My drills
  filter left in TRAK-392.
- **Plan session uses the Library** (TRAK-392): everything else in Plan session stays (Kostas, 8 Nov); only the drills
  change. A part's drills are the Library drills that fit it (`libraryFor`, by `partFor`), fitted to the training's
  squad (8–20 players; 15 when unknown) at the standard level. Set pieces, Finishing (no Library drills of their own)
  and a part the coach named pick from every drill and have no usual. The three choices are team drills:
  the usual (most used lately), else the starter drill (the part's first team drill), then those used lately, then the
  rest; the picked one always shows. Tags: Your usual, Last used, Starter drill, In My drills. Each Library choice has
  View drill: a pop-up with the picture, Easier / Harder and what changed, the five details, why / how / watch, then Use
  this drill (or Done for the picked one); its level is saved with the plan (`trak_level`). See more drills lists the
  part's drills by drill type, then Individual and Goalkeeping, with the Library's search and All / You've used. Write
  your own, the My drills filter, `useDrills` / `useAddDrill` are gone. A plan saved before keeps its drills as saved
  (Trak drill, My drill, Library tags). Adding a drill from its page that the plan already holds (now often the starter
  drill) updates that part to the level set, rather than adding it twice. Shared drill pieces:
  `src/components/coach/training/library/DrillInfo.tsx`.
- **Who's here refits Library drills** (TRAK-393): once the register is saved, a Library drill is fitted again with the
  Library's own fitting (`fit`) for the players who came, at the level saved with the plan (`trak_level`; the standard
  level when there's none), and compared detail by detail with what was planned: "No change", or each detail that
  changes ("Numbers: 15 players, 6v2 and 5v2 to 11 players, 6v2 and 3v2."). Use it takes all five fitted details;
  Save today's plan saves them, so View shows the set-up for those here. Library drills are drawn for 8 to 20 players:
  fewer than 8 here and the coach picks another drill; more than 20 fit as 20. A drill from an older plan keeps the
  TRAK-342 advice (`setupFor` / swaps). Home's Today card stays a list of practices and minutes (Kostas, 29 Oct: keep
  it simple), so it shows no set-up. Code: `adapt()` in `src/lib/training/turnout.ts`.
- **Change any practice** (TRAK-394): `drills/change` (`?part=`, `?eg=`). Steve's five things that shape every practice,
  each with his example: pick a set-up and the picture (`practiceLayout`), what changes and the key follow it;
  Conditions shows his three rules. Steve checks the answers after the pilot. Words and layouts:
  `src/lib/training/library/practice.ts`; drawn by `PitchPicture` in `DrillPitch.tsx`. The old FA Library's tiles left
  the Drills tab with this step.
- **Coach-made drill code** (TRAK-395): the helpers for writing and checking a coach's own drill (`drillProblem`,
  `cleanDrill`, `detailCount`, their search, "Save to My drills") are gone. `DRILL_LIMITS`, `DRILL_DETAILS` and
  `blankDrill` stay: they are a practice's limits and fields. A practice saved as `drill` before 8 Nov still reads
  "Your drill".

## Switching it on

The operator runs one line (see `20261028020000_training_drills.sql`):

```sql
INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'training');
```

Deleting the row switches it off at once.
