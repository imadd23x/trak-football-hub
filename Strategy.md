# Trak Football — Developer Strategy & MVP Brief

> **April 2026 brief, no longer the source of truth.** Pilot scope lives in [MVP Requirements](MVP%20Requirements). Where the two disagree, MVP Requirements wins.  
> Do not make assumptions. If something is unclear, ask before building.  
> A working prototype (v4) exists and is the visual reference for every screen — request access if you do not have it.

---

## 1. What is Trak?

Trak is a **player-first career tracking platform** for academy and semi-professional footballers aged 13–18. The founding principle is simple: **the player owns their career.**

Three user types form the core triangle:

| Role | Primary Purpose |
|------|----------------|
| **Player** | Logs matches, receives a performance band, tracks goals, earns medals |
| **Coach** | Assesses players across 6 categories, logs sessions, manages squad |
| **Parent** | Follows their child's development — read-only access via invite |

**What makes Trak different from everything else out there:**  
LeagueApps, SportsEngine and similar platforms are organisational admin tools — registration, payments, scheduling. They are sold to club administrators. Trak lives on the player's phone and is about their personal development journey. There is no meaningful overlap.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Tailwind CSS (Lovable) |
| Database | Supabase — PostgreSQL, Frankfurt region |
| Auth | Supabase Auth with email confirmation |
| Email | Resend SMTP via trakfootball.com |
| Repo | Private GitHub — you already have access |

---

## 3. Current State of the Codebase

Phase 1 (auth, onboarding, role-based routing) is partially built in Lovable. **Treat the existing codebase as a starting point only.** The design system has changed significantly — do not preserve the old visual style. The v4 prototype is the reference for everything going forward.

---

## 4. Design System — Follow This Exactly

The entire app uses a single consistent design language. Do not deviate from these values.

### Colours

```css
--bg:        #0A0A0B   /* near-black — base background */
--s1:        #101012   /* surface — cards */
--s2:        #17171A   /* elevated surface */
--s3:        #202024   /* input backgrounds */
--border:    rgba(255,255,255,0.07)
--border-md: rgba(255,255,255,0.11)
--accent:    #C8F25A   /* volt green — primary accent */
--t1:        rgba(255,255,255,0.88)  /* primary text */
--t2:        rgba(255,255,255,0.45)  /* secondary text */
--t3:        rgba(255,255,255,0.22)  /* muted text */
```

### Typography

```
Display / headings:  DM Sans, weight 300–400
Labels / metadata:   DM Mono, weight 500
Body:                DM Sans, weight 400
```

Key rules:
- Large display numbers and band words: **DM Sans weight 300, 40–56px, letter-spacing -0.03em**
- All section labels, metadata, timestamps: **DM Mono weight 500, 9px, letter-spacing 0.12em, uppercase**
- Never use weight 700 except on buttons

### Spacing & Radius
```
Border radius — small:  10px
Border radius — medium: 14px
Border radius — large:  18px
Border radius — xl:     24px
Card padding: 16px
Screen horizontal padding: 20px
```

### Nav Bar
Glassmorphism. `background: rgba(10,10,11,0.92)`, `backdrop-filter: blur(24px)`. 
Active state: `background: rgba(200,242,90,0.06)`, label colour `#C8F25A`.

---

## 5. Performance Bands — Critical

**There are NO decimal ratings visible anywhere in the app.** The algorithm runs in the background and maps to one of 7 bands. This is the core UX decision and must not be changed.

| Band | Colour | Hex | When |
|------|--------|-----|------|
| Exceptional | Volt | `#C8F25A` | 9.2+ |
| Standout | Soft lime | `#86efac` | 8.2–9.1 |
| Good | Green | `#4ade80` | 7.2–8.1 |
| Steady | Blue | `#60a5fa` | 6.4–7.1 |
| Mixed | Muted orange | `#fb923c` | 5.6–6.3 |
| Developing | Soft purple | `#a78bfa` | 4.8–5.5 |
| Difficult | Near-white muted | `rgba(255,255,255,0.4)` | Below 4.8 |

**Rules:**
- Player sees the band word only — never the underlying number
- Coach sees the band word only — never the underlying number  
- The computed number lives in the database for trend analysis only
- The language is always positive — "Developing" not "Poor", "Difficult" not "Terrible"
- Never use red anywhere in the app

### Band display CSS
```css
.band-exceptional { background: rgba(200,242,90,0.15); color: #C8F25A; border: 1px solid rgba(200,242,90,0.3); }
.band-standout    { background: rgba(134,239,172,0.13); color: #86efac; border: 1px solid rgba(134,239,172,0.26); }
.band-good        { background: rgba(74,222,128,0.13);  color: #4ade80; border: 1px solid rgba(74,222,128,0.24); }
.band-steady      { background: rgba(96,165,250,0.13);  color: #60a5fa; border: 1px solid rgba(96,165,250,0.24); }
.band-mixed       { background: rgba(251,146,60,0.13);  color: #fb923c; border: 1px solid rgba(251,146,60,0.24); }
.band-developing  { background: rgba(167,139,250,0.13); color: #a78bfa; border: 1px solid rgba(167,139,250,0.24); }
.band-difficult   { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.4); border: 1px solid rgba(255,255,255,0.1); }
```

---

## 6. The Rating Algorithm

The computed score runs silently. The player never sees the number — only the band it maps to.

**Baseline: 6.5**  
**Range: 4.0 minimum, 10.0 maximum**  
**Friendly matches: all modifiers × 0.8**

### Score modifiers
| Condition | Modifier |
|-----------|----------|
| Team won | +0.3 |
| Team lost | –0.2 |
| Team drew | 0 |
| Self-rating: Excellent | +0.4 |
| Self-rating: Good | +0.2 |
| Self-rating: Average | 0 |
| Self-rating: Poor | –0.3 |
| Yellow card | –0.2 |
| Red card | –0.6 |
| Body: Fresh | +0.1 |
| Body: Knock | –0.15 |
| Played full match (80 min) | +0.1 |
| Played under 45 min | –0.1 |

### Position-specific modifiers (Attacker example)
| Input | Modifier |
|-------|----------|
| Goals scored: 1 | +0.3 |
| Goals scored: 2 | +0.5 |
| Goals scored: 3+ | +0.7 |
| Shots on target: 3–4 | +0.2 |
| Shots on target: 5+ | +0.35 |
| Attacking threat: Dangerous | +0.15 |
| Attacking threat: Dominant | +0.3 |

Goalkeeper, Defender and Midfielder each have their own modifier sets — request the full algorithm document if needed.

**The live preview on the match log form updates in real time as the player fills in the form.** Show the band word with its colour. Never show the number.

---

## 7. Connection System — Invite Codes

All connections use invite codes. There is no search by name.

### Coach → Player connection
- Each coach has a unique 6-character code: format `TRK-XXXX`
- Coach shares this code with players verbally or via their own messaging
- Player enters the code during onboarding (Step 3) or from their profile
- Connection is instant — no approval required

### Player → Parent connection  
- Player generates a 6-character parent code: format `PAR-XXXX`
- Parent downloads Trak, selects Parent role on landing
- Parent enters the code → app shows child's name and details for confirmation
- Parent creates account → immediately connected
- Parent has read-only access — they cannot edit anything

### What the parent can see
✓ Match results and performance bands  
✓ Coach assessments — all six category colours and band words  
✓ Goals and progress  
✗ Private match inputs (body condition, self-rating details)  
✗ Any other player's data

---

## 8. MVP Feature Set

### Player features
| Feature | Notes |
|---------|-------|
| Match log | Position, competition, venue, score, minutes, card, body condition, self-rating, position-specific questions |
| Performance band | Computed silently, shown as band word + colour |
| Goals | Two types: auto-tracked (linked to match data) and manual (player updates themselves) |
| Medals | 6 medals — see Section 9 |
| Coach connection | Via invite code or email invite |
| Parent connection | Player generates a code, shares it |
| Profile | Stats, coach assessment category bars, previous clubs, connections |
| Match history | Full list, tappable to see detail |
| Match detail | Full breakdown of inputs + coach assessment for that match |

### Coach features
| Feature | Notes |
|---------|-------|
| Squad management | Add players manually or via automatic link when player enters invite code |
| Player assessment | 6 category sliders, outputs band word not number |
| Session log | 3 fields only: date, type, notes |
| Invite code screen | Prominent display of their TRK-XXXX code with copy button |
| Player profile view | See player's band history and assessment history |
| Coach profile | Invite code, season stats, previous clubs |

### Parent features
| Feature | Notes |
|---------|-------|
| Child home | Hero card with "This season" — large band word, trend bars, band distribution |
| Match feed | All matches with bands |
| Coach assessments | All 6 category colour bars with band words |
| Goals | Read-only view |
| Alerts | 3 types: new coach assessment, medal unlocked, match logged |

### Explicitly NOT in MVP
- Training log for players
- Wellness as a standalone daily feature (only embedded as one question in match log)
- Highlights / video
- CV / profile export
- 1-on-1 meeting requests
- Attendance tracking
- Coach progress dashboard
- Child switcher UI (architecture only — UI in Phase 2)

---

## 9. Medals

6 medals total. All unlocked automatically by the system — player does not trigger them.

| Medal | Trigger |
|-------|---------|
| First Match | Player logs their first match |
| On a Roll | Matches logged in 5 consecutive weeks |
| First Star | First Exceptional or Standout band |
| Ten Down | 10 matches logged |
| Most Improved | Band distribution improves over any 10-match window |
| Self Aware | Player self-rating aligns with coach band within one band, 5 times |

---

## 10. Goals Logic

### Auto-tracked goals
These update automatically when a match is logged:
- Goals scored this season
- Matches played this season
- Matches with a Standout or Exceptional band

When a match is saved, the app checks all active goals and updates progress. The match result screen shows a goal update card if any progress was made.

### Manual goals
Everything else — "improve my first touch", "get selected for first team". Player goes to the goal and selects their progress level: Just started / Making progress / Nearly there / Achieved it. They can add a short note. Coach and parent see this update.

---

## 11. Screen List (37 screens)

All screens are built in the v4 prototype. Reference it for every layout decision.

**Landing:** `s-landing`

**Player onboarding:** `s-ob-p1` `s-ob-p2` `s-ob-p3` `s-ob-p4` `s-ob-p-done`

**Player app:** `s-p-home` `s-p-logchoose` `s-p-logform` `s-p-result` `s-p-matches` `s-p-matchdetail` `s-p-goals` `s-p-addgoal` `s-p-updategoal` `s-p-medals` `s-p-profile`

**Coach onboarding:** `s-ob-c1` `s-ob-c2` `s-ob-c-done`

**Coach app:** `s-c-home` `s-c-squad` `s-c-addplayer` `s-c-playerprofile` `s-c-sessions` `s-c-addsession` `s-c-assess` `s-c-invitecode` `s-c-profile`

**Parent onboarding:** `s-ob-par1` `s-ob-par1b` `s-ob-par2` `s-ob-par-done`

**Parent app:** `s-par-home` `s-par-matches` `s-par-goals` `s-par-alerts`

---

## 12. Supabase Schema (Core Tables)

```sql
-- Users (handled by Supabase Auth)
-- profiles table extends auth.users
profiles (
  id uuid references auth.users,
  role text, -- 'player' | 'coach' | 'parent'
  first_name text,
  last_name text,
  nationality text,
  created_at timestamptz
)

players (
  id uuid,
  profile_id uuid references profiles,
  position text, -- 'gk' | 'def' | 'mid' | 'att'
  club text,
  age_group text,
  shirt_number int,
  coach_invite_code text, -- the code player enters to connect to coach
  parent_invite_code text, -- unique code player shares with parent
  created_at timestamptz
)

coaches (
  id uuid,
  profile_id uuid references profiles,
  club text,
  age_group text,
  role text,
  invite_code text, -- unique TRK-XXXX code
  created_at timestamptz
)

parents (
  id uuid,
  profile_id uuid references profiles,
  created_at timestamptz
)

-- Connections
player_coach (
  player_id uuid references players,
  coach_id uuid references coaches,
  connected_at timestamptz
)

player_parent (
  player_id uuid references players,
  parent_id uuid references parents,
  connected_at timestamptz
)

-- Match data
matches (
  id uuid,
  player_id uuid references players,
  opponent text,
  score_us int,
  score_them int,
  competition text, -- 'league' | 'cup' | 'tournament' | 'friendly'
  venue text, -- 'home' | 'away'
  age_group text,
  minutes_played int,
  card text, -- 'none' | 'yellow' | 'red'
  body_condition text, -- 'fresh' | 'good' | 'tired' | 'knock'
  self_rating text, -- 'poor' | 'average' | 'good' | 'excellent'
  position text,
  position_inputs jsonb, -- position-specific answers stored as JSON
  computed_score decimal(4,2), -- hidden from UI, used for band calculation
  band text, -- 'exceptional'|'standout'|'good'|'steady'|'mixed'|'developing'|'difficult'
  is_friendly boolean,
  logged_at timestamptz
)

-- Coach assessments
assessments (
  id uuid,
  coach_id uuid references coaches,
  player_id uuid references players,
  match_id uuid references matches, -- optional link to a match
  appearance text, -- 'started' | 'sub' | 'training'
  work_rate int, -- 1-10, hidden from UI
  tactical int,
  attitude int,
  technical int,
  physical int,
  coachability int,
  overall_band text, -- computed from average of 6 scores
  self_rating_flag text, -- 'fair' | 'generous' | 'way off'
  note text, -- private note, visible to player only
  assessed_at timestamptz
)

-- Goals
goals (
  id uuid,
  player_id uuid references players,
  title text,
  category text, -- 'performance' | 'consistency' | 'development' | 'personal'
  target_number int, -- null for non-numeric goals
  current_number int,
  is_auto_tracked boolean,
  tracking_field text, -- 'goals_scored' | 'matches_played' | 'standout_bands' etc
  progress_level text, -- for manual goals: 'just_started'|'making_progress'|'nearly_there'|'achieved'
  progress_note text,
  target_date text,
  completed boolean,
  created_at timestamptz
)

-- Medals
medals (
  id uuid,
  player_id uuid references players,
  medal_type text, -- 'first_match'|'on_a_roll'|'first_star'|'ten_down'|'most_improved'|'self_aware'
  unlocked_at timestamptz
)

-- Previous clubs
previous_clubs (
  id uuid,
  profile_id uuid references profiles,
  club_name text,
  role text, -- position for player, coaching role for coach
  years text, -- e.g. '2022–2024'
  is_current boolean
)
```

---

## 13. RLS Policies (Key Rules)

- Players can only read/write their own data
- Coaches can read data for players connected to them only
- Parents can read data for their connected child only — no write access
- Invite codes are publicly readable (so the app can validate them) but only the owner can generate/regenerate them
- Assessment notes are visible to the assessed player and their coach only — not to parents

---

## 14. Launch Markets

Greece, Cyprus, Belgium, Netherlands.

**Important:** LeagueApps and SportsEngine have minimal presence in Greece and Cyprus — our primary launch markets. In Belgium and Netherlands some clubs may use LeagueApps for admin. Trak does not compete with these tools — it is the player's personal development record, not the club's admin system.

---

## 15. What to Build First (Suggested Order)

1. **Auth + role routing** — player / coach / parent, email confirmation, persistent sessions. This may already exist.
2. **Player onboarding** — 4 steps, position selection, invite code entry for coach, invite parent.
3. **Match log form** — all fields, position-specific questions, live band preview, save to Supabase.
4. **Player home** — hero card with "This season" band distribution, trend bars, recent matches.
5. **Coach onboarding + invite code generation** — coach gets their TRK-XXXX code on signup.
6. **Coach assessment form** — 6 sliders, band output, save to Supabase, notify player.
7. **Parent onboarding** — enter PAR-XXXX code, see child confirmation, create account.
8. **Parent home** — hero card, latest assessment, goals.
9. **Goals, medals, profiles** — complete the remaining screens.

---

## 16. Important Notes for the Developer

**Do not show decimal numbers anywhere.** Not to the player, not to the coach, not to the parent. The number lives only in the database.

**Do not add features not listed here.** The MVP scope is intentional. Every feature not listed was explicitly cut for good reason. Phase 2 features include: training log, wellness standalone, highlights, CV export, 1-on-1 requests, attendance, coach progress dashboard.

**The v4 prototype is the design reference.** Every layout, every component, every colour, every font size was deliberate. If something in the prototype looks different from what you would normally build, follow the prototype.

**Mobile first, max width 430px.** This is a mobile app. Do not build for desktop.

**The band vocabulary is fixed.** The 7 words are: Exceptional, Standout, Good, Steady, Mixed, Developing, Difficult. Do not change them or add alternatives.

**Ask before interpreting.** If the brief does not cover something specifically, ask. Do not guess and build.

---

*Last updated: April 2026*  
*Product owner: available via GitHub / direct message for any questions*
