# Trak — Legal Questions for a UAE Pilot

*Prepared for a meeting with UAE counsel. Written 18 September 2026.*

| Document control | Value |
| --- | --- |
| Companion to | `docs/lawyer-meeting-brief.md` (10 July 2026, written for a **Greek** lawyer) |
| Relationship | That brief's questions still need asking. This one asks them for the UAE and **corrects the facts**, which have changed materially since July. |
| Status | Questions, not answers. Nothing here is legal advice, and no statement about UAE law is made anywhere in this document. |

---

## 0. Read this first: what changed since the July brief

The July brief is a good document and most of it still stands. Three of its
factual premises no longer hold, and one of them sits underneath its most
important question.

| July brief says | Actually true today |
| --- | --- |
| *"players log matches and **daily wellness**"*, *"**daily mood entries**"*, *"soon behavioural self-reflections"* | **Wellness was deleted on 1 September** (`20260901000007_drop_wellness_logs.sql`). No mood, energy, sleep or free-text wellbeing data is collected anywhere in the product. The table was verified empty before it was dropped. `player_goals` was removed earlier for the same stated reason. |
| *"A pilot is planned in **Greece**"* | The first pilot is in the **UAE**, the week of 25 September. |
| *"a character-building feature for children is **in design**"* | Not in the build. What does exist is AI-written feedback a child reads, **and a live AI chat the child can hold with the model** — see section 4, and read it before relying on anything about AI in this brief. |

**Why the first row matters more than the others.** The July brief asks whether
mood and behavioural entries are special-category data and whether a DPIA
follows. A lawyer answering that question from the July brief would be
answering about data this product does not hold. The special-category exposure
that prompted the question was removed deliberately, and that is a materially
different risk profile to present.

**One question in the July brief was never answered, and the product shipped
without the answer.** Section 4:

> *"Coaches can add a child to a roster (name, age) before the child or parent
> has an account — is that lawful, and if not how do we restructure it?"*

That was asked on 10 July. On 12 September a parental-consent gate shipped that
does not cover that case, and says so in its own header as a known limitation
flagged for legal review. Section 3 below sets out exactly what it does and
does not reach, with the evidence. **This is the question to settle first.**

---

## 1. Context

- **Trak** is a mobile-first web app for developing young footballers. Coaches
  log sessions and assess players on six metrics; players log matches; parents
  get read-only visibility. There is no video, no GPS hardware, no public
  ranking, no scouting marketplace and no advertising.
- **The pilot is in the UAE**, with a football academy, starting the week of
  25 September 2026.
- Hosting and processing are outside the UAE: **Supabase** (database and auth),
  **Vercel** (web hosting), and an **AI gateway operated by Lovable** which
  routes prompts to **Google Gemini**.
- Existing legal work is **EU-shaped**: `Legal/PROPOSED-SOLUTION-EU-MINORS-ONBOARDING.md`
  (7 September) proposes academy-as-controller / Trak-as-processor and is
  explicitly marked *"approve as a design direction, not as legal clearance."*
  Nobody has approved it. It is scoped *"EU academy-based onboarding."*
- **The first question for this meeting is whether any of that transfers.**

> **Discuss:** Which instrument governs this pilot? Our deck cites **UAE
> Federal Decree-Law 26 of 2025** as the relevant children's-data regime. We
> have not verified that this is the right instrument or that we have
> characterised it correctly, and we are not in a position to. Please tell us
> what actually applies, including any free-zone regime (DIFC, ADGM) if the
> academy or our entity sits in one.

> **Discuss:** Is there a **digital-consent age** in UAE law equivalent to the
> GDPR Article 8 threshold? Our code currently hard-codes **15**, reasoned
> entirely from Greek law, with a source comment saying so. It is wrong for
> this market by construction, and we need the right number — or to be told the
> concept does not apply and something else does.

---

## 2. What the system actually holds about a child

Supplied as fact, verified against the code rather than described from memory,
because counsel cannot advise on a system they have to take on trust.

**Collected about a child with an account** (`player_details`, `profiles`):
full name, date of birth, nationality, position, shirt number, age group,
current club, email address.

**Created about a child by adults** — this is the substance of the product:

| Data | Table | Written by |
| --- | --- | --- |
| Six-metric assessments (work rate, technical, physical, tactical, attitude, coachability) plus an overall rating | `coach_assessments` | Coach |
| Free-text coach notes about the child | `coach_assessment_notes` | Coach |
| AI-written development feedback the child reads | returned live by an edge function; **not stored, and not approved by anyone** — see section 4 | AI |
| Recognition awards | `recognition_awards` | Coach |
| Match records and session attendance | `matches`, `session_attendance` | Coach or player |
| Guardian consent records | `parental_consents` | Parent |

**Photographs are collected.** A child can upload a profile picture from the
settings screen (`avatars` bucket, 5 MB, images only, one file per user). The
bucket was created public in April and set to private on 26 May; a user may
only write to their own path. We flag it explicitly because it is the only
image of a child in the system and it is easy to overlook.

**Not collected:** health data, mood, sleep, injury, biometrics, location,
video, messaging between users, and any public profile or ranking.

**Who can read a child's record today:** their own coach; the academy
administrator; a linked parent; and the child. Cross-academy isolation is
enforced — verified on reads between two real academies in the live database,
and on writes against a replayed one.

> **One fact counsel should have, because it is about honesty rather than
> architecture.** `coach_assessment_notes` was created in April as a coach-only
> table, and the coach-facing wording said the notes were private. In May a
> policy was added letting a player read that table so the feedback feature
> could use it. That did not only change future behaviour — it made notes
> **already written under the privacy promise** readable by the player. Any
> coach who has used the app since May has written notes they were told were
> private and which their players can read. No child in the pilot is affected
> yet; the existing notes belong to earlier users. We are deciding separately
> what happens to them, and would welcome a view.

> **Discuss:** Is the six-metric behavioural assessment of a child — attitude,
> coachability — a sensitive category under the applicable UAE regime? Under
> GDPR it is not health data, which is why the wellness deletion mattered. We
> do not know how it is treated here.

---

## 3. Guardian consent: what is built, and the precise gap

**What is built, and it is the hard part:** consent records are append-only and
versioned. Granting again supersedes rather than edits; withdrawal closes a
record rather than deleting it. Each record stores what was agreed
purpose-by-purpose, the exact wording shown, the notice version, the threshold
applied and the child's age at the time. The history is reconstructable.

**Where the gate applies, it works.** A coach cannot assess or give an award to
an under-age child with no active consent, and can as soon as consent is
recorded. Both directions are verified.

**The gap.** The gate establishes a child's age by following the roster row to
a signed-up account with a date of birth. A child a coach **typed in** has no
account, so there is no date of birth, so the check passes and the assessment
is written. The coach's add-player screen collects a name, a position, a shirt
number and an age **band** (`U12`) — there is no date-of-birth field.

Our engineering note argues this is acceptable because such a row is the
academy's own record of its own squad. **The reason we are not relying on that
argument** is that the row does not stay the academy's own: when the child
later signs up — the ordinary flow, and what the pilot is for — their account
adopts that same roster row, and every assessment written while nobody could
check consent becomes part of their record and readable by them. Writes are
blocked correctly from that moment on; what is already there is not.

All of the above is demonstrated, not asserted, in
`supabase/tests/consent_coverage.sql`.

> **Discuss:** Is a coach creating and assessing a record about a named child,
> before any parent is involved, lawful here? If the academy's own squad record
> is treated differently, does that treatment survive the record transferring
> into the child's personal account?

> **Discuss:** **What establishes parental responsibility?** Today a parent
> receives an email invitation and accepts it. Nothing verifies that the
> recipient is a parent or guardian. Our own EU analysis says
> *"authentication alone does not establish legal authority."* What is
> sufficient here — and is academy-assisted verification, where the academy
> already holds registration paperwork, an acceptable route?

---

## 4. Suppliers and cross-border processing

> **Discuss:** Does UAE law restrict where this data may be processed, and what
> must be in place for each supplier? Concretely:

| Supplier | Role | What it receives |
| --- | --- | --- |
| Supabase | Database, authentication, file storage | Everything in section 2, including profile photographs |
| Vercel | Web hosting | Request traffic |
| Lovable AI gateway → Google Gemini | Generates coach feedback and coach assistance | See below |
| Sentry | Error monitoring, production only | Error traces |

**Exactly what reaches the AI gateway**, because this is the sharpest question
and a vague answer is worse than none: the child's **first name only**, their
position, six metric scores, an overall rating, and **the coach's free-text
note about them, verbatim**. Not their surname, date of birth, email or
nationality.

> **Discuss:** Is a coach's written observation about a named child, sent to a
> third-party model outside the UAE, permissible — and does it need its own
> consent purpose separate from coaching records? Our consent model already
> supports separating them; we need to know whether it must.

**Two things about the AI that we want stated plainly rather than discovered.**

**No adult approves what the AI says to a child.** The feedback is generated
and shown to the child directly. A coach does not see it first. We consider
this the most serious item in this brief and it is being changed — the work is
written and waiting to merge — but it is the state of the product as this
document is written, and our sales deck already claims *"the coach reviews
every word."* That claim is not true yet.

**A child can hold a live conversation with the model.** The feedback screen
sends the child's chat messages to Gemini with their assessment as context. An
open-ended exchange between a child and a model cannot be pre-approved by a
coach, which is why our own release gate and the pending change both switch it
off. It is on today.

> **Discuss:** Given the above, is there anything that must be in place before
> a child uses this at all — as opposed to before the pilot scales?

> **Discuss:** Must a child be **told** the feedback they are reading was
> written by AI? EU AI Act Article 50 requires disclosure; we do not know the
> UAE position, and we have not confirmed the product says so clearly today.

---

## 5. The pilot agreement

> **Discuss:** **Who is controller and who is processor** between Trak and a
> UAE academy? Our EU analysis proposes academy-as-controller, Trak-as-processor
> for coaching records, with Trak separately controller for billing and account
> security — and warns that contract labels cannot override actual conduct.
> Does that split hold here?

> **Discuss:** What must the **academy agreement** contain as a minimum? We
> have a specification for one — instructions, confidentiality, authorised
> staff, subprocessors, transfers, rights assistance, breach escalation,
> retention, audit, termination, and who verifies parental authority — but
> **no draft exists.** An academy cannot sign a specification.

> **Discuss:** **Who collects the parental consents** — the academy, as part of
> registration it already does, or Trak in-app? This changes the product.

---

## 6. Operating legally

> **Discuss:** Do we need a **UAE legal entity** to run a paid pilot with a UAE
> academy, or can a foreign entity contract in? What about a free-zone entity,
> and does the choice change the data-protection analysis?

> **Discuss:** **Terms and privacy policy.** None exist. What is the minimum
> set before real children use this, in which language, and must they be
> UAE-specific or can one set serve both markets?

> **Discuss:** **Retention.** No retention period is set for anything —
> accounts, assessments, invitations, consent records, audit evidence or
> backups. What must we commit to, and to whom?

> **Discuss:** **Rights requests and breach.** There is no named person, no
> published contact for a parent with a problem, and no 72-hour-equivalent
> procedure. What is required here, and what is the notification deadline?

---

## 7. What we are asking for

1. **Which law applies**, and whether the existing EU analysis transfers or
   must be redone.
2. **The consent question from section 3** — the one asked in July and not
   answered. It blocks the pilot and it is the only item on this list that
   changes the database schema depending on the answer.
3. **Whether the AI behaviour in section 4 is acceptable for a child at all**,
   given that nothing an adult has read reaches them first and a live chat is
   open. We believe we know the answer and are already fixing it; we want to
   know whether it is a blocker or a defect.
4. **The right age threshold**, or confirmation that the concept does not apply.
5. **A pilot agreement we can put in front of an academy**, from the
   specification we have.
6. **The minimum document set** — terms, privacy policy, retention, breach
   contact — with a do-now versus do-later split and rough cost.

We would rather be told the pilot cannot start on the current timeline than
start it on an assumption. If something here must be fixed before a child signs
up, the engineering side of it can move quickly; what we cannot do is decide
which things those are.
