# Decisions required before a real child signs up

| Document control | Value |
| --- | --- |
| Purpose | Turn section 8 of the EU minors proposal into answerable decisions |
| Source | `Legal/PROPOSED-SOLUTION-EU-MINORS-ONBOARDING.md` (7 Sept, PROPOSED) |
| Prepared | 18 September 2026 |
| Status | **Awaiting decisions.** Nothing here is legal advice. |

The proposal ends *"approve this as a design direction, not as legal clearance."*
Nobody has approved it, so every decision below is still open, and several of
them are already being answered implicitly by code that has shipped.

Each row states what the document says, **what the code actually does today**,
what the team has assumed in the meantime, and what changes depending on the
answer. Where the evidence supports a recommendation, one is given, so this can
be argued with rather than merely filled in.

---

## A. The two that block everything else

### A1. Is the academy the controller and TRAK the processor?

**The proposal already answers this** (section 3): academy as controller for
coaching records, TRAK as processor acting on documented instructions, with
TRAK separately controller for billing and account security. It warns that
*"contract labels cannot override actual conduct"* and that joint
controllership under Article 26 applies if both parties determine purposes.

**The pilot plan still lists this as undecided.** It has been answered in the
repo since 7 September and nobody has approved or rejected it.

**Recommendation: approve as written.** It matches how the product behaves —
the academy decides who its coaches are, what they assess and how long records
are kept.

**What changes if approved:** the academy agreement becomes a processor
agreement with a defined instruction set, and P2's consent model hangs off the
academy rather than the child's own country.
**Decides:** Tarek and Kostas, with counsel confirming.

### A2. Which countries and exact age bands launch first?

**Document:** restrict the pilot to *"named, legally reviewed markets"* with
*"versioned country/age rules"*, and explicitly: **"Do not treat 'under 18' and
'below the Article 8 threshold' as interchangeable categories."**

**What the code does today:**
- `consent_threshold_age()` returns a hardcoded `15` with the comment
  *"Greece. GDPR default is 16; member states may lower to 13."*
- `CONSENT_THRESHOLD_AGE = 15` duplicated in `src/lib/consent.ts:13`
- **`organizations` has no country column.** There is nowhere to record which
  market an academy is in, so a per-market rule cannot be implemented without a
  schema change first.

**What the team assumed:** under-18 for both UAE and Greece.

That is *more protective* than Greece's 15 and is not unlawful. But the
document's warning is that a blanket under-18 gate can create a false
impression the other under-18 obligations are handled, and it is not the same
question as the Article 8 threshold. **This is a decision being made by default
rather than deliberately.**

**What changes:** whether `consent_threshold_age()` becomes per-academy (needs
a country column) or stays a single value; whether the first market is UAE,
Greece, or both.
**Decides:** counsel on the thresholds; Tarek on the market order.

---

## B. Decisions that change what gets built

| Question | Document's position | Code today | If yes | If no |
| --- | --- | --- | --- | --- |
| **Collect injury, mood or sleep?** | Article 9 health data; separate conditions, access controls and DPIA scope | Not collected | Separate consent purpose, stricter access, wider DPIA | Keep out of pilot — the document's own recommendation |
| **Academy SaaS, direct-to-family, or both?** | Changes controller/processor analysis entirely | Both paths exist: players self-register *and* coaches add them — and **consent only reaches the first**, see B-bis | Must resolve, because it changes A1 | — |
| **Media, messaging or public sharing?** | Changes safeguarding, DSA and UK scope | None exists | Significant new safeguarding work | Deferred, recommended |
| **AI recommendations enabled?** | Requires use-case classification and decision safeguards | **Yes, live.** AI drafts feedback; T2 (#40) adds coach approval before a child sees it | Needs classification and supplier review | — |
| **What establishes parental responsibility?** | *"Authentication alone does not establish legal authority"* | Email invitation only. Nothing verifies the recipient is a guardian | Academy-assisted verification, per the document | Current state is not defensible for real children |
| **What can guardians see as children mature?** | Needs national-law and child-rights assessment | Parent sees bands, matches, assessments; private notes excluded | — | — |
| **Which suppliers receive identifiers or prompts?** | Determines contracts, transfers, retention | Supabase (hosting/DB), Vercel (hosting), Lovable AI gateway → Gemini. **Child assessment data is sent to the AI gateway in prompts.** | Processor contracts and transfer safeguards needed for each | — |

The AI row and the supplier row are the two where the code has already answered
the question and the paperwork has not caught up.

### B-bis. The consent gate reaches accounts, not children

Proven on a replayed database in `supabase/tests/consent_coverage.sql`
(`npm run test:db -- --consent-review`), fourteen assertions with both
controls.

`squad_player_consent_required()` establishes a child's age by following
`squad_players.linked_player_id` into `player_details.date_of_birth`. A roster
row a coach typed in has no linked account, so the function returns `false` and
the assessment is written. The coach's add-player screen collects a name, a
position, a shirt number and an age *band* (`U12`) — **there is no
date-of-birth column on `squad_players` at all.**

`20260912000001_parental_consent.sql` states this in its own header and argues
the unlinked row *"is the academy's own paper record of its own squad."* That
is a defensible position and it was reasoned deliberately.

**What the test shows is that the record does not stay the academy's own.**
When the child later signs up and links — the ordinary pilot flow —
`link_player_to_coach()` adopts that same roster row, and every assessment
written while nobody could check consent becomes part of the child's account
and readable by them. Writes from that moment on are correctly blocked; the
ones already there are not. The gate is a check at the moment of writing, not a
property of the record.

The same assessment text is what `player-feedback` sends to the Lovable AI
gateway, which is the supplier row above.

**What changes:** if the academy's own record is accepted as out of scope, this
needs writing down explicitly and the linking behaviour needs an answer of its
own. If it is not, the fix is a schema change — collect a date of birth at
add-player — not a policy change, and it has to be estimated as one.
**Decides:** counsel on the position; Imad on the schema (P2).

---

## C. Operational blockers the document names itself

| Item | State | Owner |
| --- | --- | --- |
| **DPIA** | Not started. The document calls minors + longitudinal evaluation a strong high-risk indicator | Tarek, with counsel |
| **Academy agreement** | Requirements specified in section 3; **no draft exists** | Counsel, from that checklist |
| **Retention periods** | None set for accounts, health, media, invitations, audit evidence or backups | Tarek + academy |
| **Breach process** | No named person, no 72-hour procedure | Tarek |
| **Rights requests** | `delete_my_account()` exists but **fails for club admins** (F6) | Kostas for the defect; Tarek for the process |
| **A named person and inbox for a parent with a problem** | Does not exist | Tarek |

---

## D. What is genuinely fine

Worth stating so the list above is not read as "nothing works":

- Consent records are **append-only and versioned**, which is the hard part and
  a real head start.
- The consent gate blocks assessments and awards **where it applies**, and it
  is verified to do so, including that it opens again once consent is recorded.
  How far it applies is B-bis, and that is a real limit on this line.
- Cross-academy isolation is enforced and verified on reads between two real
  academies, and on writes against a replayed database.
- AI feedback will reach a child only after a coach approves it, once #40 lands.
- No public profiles, no rankings, no scouting marketplace, no advertising —
  the pilot boundaries in section 1 are already respected by the build.

---

## E. The gap nobody has raised

The proposal is scoped *"EU academy-based onboarding."* **The first paid market
is the UAE.** UAE Decree-Law 26 of 2025 is named in the deck as a moat, and
there is no analysis of it anywhere in this repository.

So the legal thinking exists, carefully, for the wrong jurisdiction — the same
shape as `consent_threshold_age()` returning Greece's 15 in a UAE-first
product. Either the pilot starts in Greece, or this needs UAE counsel before an
academy signs anything.

**That is the single question I would put in front of a lawyer first.**
