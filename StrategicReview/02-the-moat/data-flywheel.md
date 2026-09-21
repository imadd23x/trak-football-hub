# Data Flywheel Scoring

*Session: 12 September 2026.*

Four loops, scored 1–5. The weakest loop is where competitors attack.

| Loop | Score | Reading |
|---|:---:|---|
| **Correction** — do users fix AI outputs, and is that captured and reused? | **1 / 5** | No capture anywhere. The three live edge functions — `coach-assistant`, `parse-schedule`, `player-feedback` — emit output a coach accepts or ignores, and nothing records which. Not a thumb, not an edit diff, not an accept rate. |
| **Preference** — does the product learn individual or team preferences? | **1 / 5** | Stateless by construction. The rating engine is fixed constants identical for every coach, club and age group. `coach-assistant` injects squad context per call and retains nothing after it — context-stuffing, not learning. |
| **Domain Context** — does usage in one area improve adjacent areas? | **2 / 5** | One real link: the assistant's system prompt reads low assessment scores and proposes a session targeting that category. Assessment → session planning is genuine cross-domain transfer — but one hop, one direction, hand-written in a prompt. Nothing flows back. |
| **Network** — does each new user make it better for everyone? | **1 / 5** | Isolated, deliberately — RLS partitions every club. Coach A's assessments cannot lawfully inform Coach B's drafts. |

**Total: 5 / 20.** Not a flywheel — a conveyor belt. Data goes in; nothing comes back out to make
the next output better.

---

## Weakest loop: Correction

Three loops tie at 1. Correction is the vulnerability, because it is the only one where Trak holds
a structurally privileged position *and is actively throwing it away.*

The Touchline flow generates, on every assessment: the raw coach language, the model's proposed
band, **the band a named human actually signed**, and the edit delta on the note. That is a
labelled training pair with a human authority stamp — the kind of data most AI companies pay
annotators for. The prototype creates it and drops it.

**Where the attack lands.** Veo ships Player Report. Every coach correction on their platform is
captured *against footage*, so their labels carry evidence Trak's don't. Two seasons in, their
drafts are calibrated to real coach behaviour across thousands of academies, and Trak's are still
the hand-tuned constants from the April spec. They win on the thing that improves while Trak
stands still — and the window is open only while they have no coaches assessing.

**Second-order cost: Preference can't exist without Correction.** One coach's "Good" is another's
"Standout." A record that claims to be believable *across* coaches requires per-coach calibration,
and the only source of calibration signal is the correction data not being kept. That makes this
a correctness problem, not an optimisation.

---

## The one move

Persist four fields on the assessment write path: `source_text`, `drafted_band`, `signed_band`,
`coach_id`. One migration, no new UI, no model work. It converts every assessment from a
disposable record into a labelled pair, takes Correction from 1 to 4, and yields Preference
(per-coach calibration curves) from the same rows.

**Do the legal basis first, not after.** Reusing minors' assessment data to improve a model is a
*separate purpose* under GDPR from producing that child's record; consent for one does not cover
the other. Write it into the consent architecture and the DPIA before the first row lands —
retrofitting it means discarding the corpus.

Network stays at 1 on purpose. Cross-club learning is blocked by the isolation that *is* the
regulatory moat; the only lawful version is anonymised aggregate calibration by age group, and
that too has to be designed in at consent time.
