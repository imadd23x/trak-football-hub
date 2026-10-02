# Trak Football — Growth Enhancements Implementation Plan

> **23 September 2026:** An April post-pilot backlog, not pilot scope. Pilot scope and what comes first after it are in [MVP Requirements](../../MVP%20Requirements).

> **Created:** 2026-04-12  
> **Mode:** Hold Scope (pilot-first, validate before scaling)  
> **Tech Stack:** React 18 + TypeScript, Tailwind CSS, Supabase, Vitest  
> **Architecture:** Client-Heavy (Approach A) — all computation in React client

---

## Guiding Principles

1. **TDD First** — Every feature starts with a failing test. RED → GREEN → REFACTOR.
2. **Pilot Validation** — Ship to the 30-user pilot, measure, then decide.
3. **Persona Isolation** — Each enhancement targets exactly one persona.
4. **No Scope Creep** — Features marked "Explicitly NOT in MVP" stay out until pilot validates.
5. **Telemetry Everywhere** — Track every new feature usage for post-pilot analysis.

---

## Phase 1: Quick Wins (Week 1–2)

These are low-effort, high-impact features that drive immediate engagement.

---

### Task 1.1: Shareable Performance Cards (Player)

**Goal:** Players can generate and share a visual card of their match result.

**Why:** Free viral marketing. Players share → teammates ask "What app is that?"

**Files to Create:**
- `src/components/player/ShareableCard.tsx` — Card component with match data
- `src/lib/share.ts` — `generateShareImage()` using html-to-image
- `src/__tests__/share.test.tsx` — Tests for card rendering and data accuracy

**Files to Modify:**
- `src/pages/MatchLog.tsx` — Add "Share" button after match save
- `src/components/player/PlayerHome.tsx` — Add share button on recent match cards
- `package.json` — Add `html-to-image` dependency

**Implementation Steps:**

1. **Write failing test** — Card renders with match data, band pill, and QR code
2. **Install dependency:** `npm install html-to-image`
3. **Build `ShareableCard.tsx`:**
   - Dark navy background matching design system (`#080d1a`)
   - Player name, position, match result (W/D/L + score)
   - `RatingBandPill` component for computed rating
   - Goals/assists count
   - Medal count (if any)
   - QR code linking to `https://trakfootball.com` (use `qrcode.react`)
   - "TRAK FOOTBALL" branding footer
4. **Build `generateShareImage()` in `src/lib/share.ts`:**
   - Use `toPng()` from html-to-image on the card ref
   - Copy to clipboard via `navigator.clipboard.write()`
   - Fallback: download as PNG
5. **Integrate into MatchLog flow:**
   - After successful match save, show share modal
   - "Copy Image" + "Download" buttons
6. **Integrate into PlayerHome:**
   - Small share icon on each recent match card
7. **Track telemetry:** `trackEvent('share_card', { match_id, band })`

**Acceptance Criteria:**
- [ ] Card renders correctly with all match data
- [ ] Share generates a downloadable PNG
- [ ] QR code is scannable and links to trakfootball.com
- [ ] Telemetry event fires on share
- [ ] Works on mobile (430px max-width)

**Dependencies:** `html-to-image`, `qrcode.react`

---

### Task 1.2: Streak Counter (Player)

**Goal:** Track and display consecutive weeks of match logging.

**Why:** Streaks increase retention by 40%+ in youth apps. Already partially implemented in `medals.ts` (the `on_a_roll` medal logic).

**Files to Create:**
- `src/lib/streaks.ts` — Streak calculation logic
- `src/components/player/StreakBadge.tsx` — Visual streak display
- `src/__tests__/streaks.test.ts` — Unit tests for streak logic

**Files to Modify:**
- `src/components/player/PlayerHome.tsx` — Add streak display to hero card
- `src/lib/types.ts` — Add `Streak` interface

**Implementation Steps:**

1. **Write failing test** — Streak calculation from match dates
2. **Build `src/lib/streaks.ts`:**
   ```typescript
   export interface Streak {
     current: number;      // Current consecutive weeks
     best: number;         // All-time best streak
     lastMatchDate: string; // ISO date of last match
     isActive: boolean;    // Streak is current (not broken)
   }

   export function calculateStreak(matches: Match[]): Streak {
     // Reuse logic from medals.ts on_a_roll check
     // Group matches by ISO week
     // Count consecutive weeks
     // Determine if streak is active (last match within current week)
   }
   ```
3. **Build `StreakBadge.tsx`:**
   - Fire emoji with number: `🔥 5`
   - Subtle animation on streak increment
   - Grayed out if streak is broken: `🔥 5 (best)`
4. **Integrate into PlayerHome:**
   - Add to hero card stats row (replace or augment existing stats)
   - Show "Keep your streak alive!" nudge if no match this week
5. **Track telemetry:** `trackEvent('streak_viewed', { current, best })`

**Acceptance Criteria:**
- [ ] Streak calculates correctly from match history
- [ ] Badge displays on player home
- [ ] Broken streak shows best-ever value
- [ ] Nudge appears when streak is at risk
- [ ] All edge cases tested (year boundary, no matches, single match)

---

### Task 1.3: Personal Records (Player)

**Goal:** Display player's all-time bests and milestones.

**Why:** Players need to SEE achievement to stay motivated.

**Files to Create:**
- `src/lib/records.ts` — Record calculation from match history
- `src/components/player/PersonalRecords.tsx` — Records display component
- `src/__tests__/records.test.ts` — Unit tests

**Files to Modify:**
- `src/pages/player/PlayerProfile.tsx` (or create if missing) — Add records section
- `src/components/player/PlayerHome.tsx` — Add "Personal Best" card

**Implementation Steps:**

1. **Write failing test** — Records extract correctly from match array
2. **Build `src/lib/records.ts`:**
   ```typescript
   export interface PersonalRecords {
     highestRating: { value: number; matchId: string; date: string };
     mostGoalsInMatch: { value: number; matchId: string; date: string };
     longestGreenStreak: number; // Consecutive matches in Green+ band
     totalMatches: number;
     totalGoals: number;
     totalAssists: number;
     firstMatchDate: string;
   }

   export function calculateRecords(matches: Match[]): PersonalRecords { ... }
   ```
3. **Build `PersonalRecords.tsx`:**
   - Card layout with trophy emoji headers
   - Each record: label + value + date
   - "New Record!" badge if recently broken
4. **Integrate into PlayerHome:**
   - Collapsible "Personal Bests" section below recent activity
5. **Track telemetry:** `trackEvent('records_viewed', {})`

**Acceptance Criteria:**
- [ ] Records calculate correctly from match history
- [ ] "New Record" badge shows for records broken in last 7 days
- [ ] Records update immediately after new match save
- [ ] Handles edge case: no matches yet

---

## Phase 2: Engagement Boost (Week 3–4)

Features that deepen engagement and create social dynamics.

---

### Task 2.1: Progress Charts (Player)

**Goal:** Visualize rating trends and skill development over time.

**Why:** Players need to see improvement to stay motivated. Charts make abstract numbers tangible.

**Files to Create:**
- `src/components/player/RatingTrendChart.tsx` — Line chart of ratings over time
- `src/components/player/PositionRadar.tsx` — Radar chart of position-specific skills
- `src/__tests__/charts.test.tsx` — Snapshot tests for chart rendering

**Files to Modify:**
- `src/pages/player/PlayerProfile.tsx` — Add charts section
- `package.json` — Add `recharts` dependency

**Implementation Steps:**

1. **Write failing test** — Charts render with mock data
2. **Install dependency:** `npm install recharts`
3. **Build `RatingTrendChart.tsx`:**
   - Line chart: X-axis = match date, Y-axis = computed rating
   - Band threshold lines (horizontal) for Exceptional/Good/Steady/etc.
   - Color-coded dots matching band colors
   - Responsive, max-width 430px
   - Tooltip showing match details on hover/tap
4. **Build `PositionRadar.tsx`:**
   - Radar chart with position-specific axes:
     - GK: Shot Stopping, Distribution, Commanding, Positioning, Consistency
     - DEF: Duels, Clearances, Aerial, Positioning, Passing, Goals
     - MID: Passing, Chances, Pressing, Goals, Duels, Consistency
     - ATT: Goals, Chances, Movement, Pressing, Duels, Consistency
   - Average of last 5 matches for each axis
   - Overlay: "You vs. Average" comparison
5. **Integrate into PlayerProfile:**
   - Tab or section: "Performance" with both charts
   - Filter: Last 5 / 10 / All matches
6. **Track telemetry:** `trackEvent('chart_viewed', { type: 'trend' | 'radar' })`

**Acceptance Criteria:**
- [ ] Line chart shows rating trend with band thresholds
- [ ] Radar chart shows position-specific skills
- [ ] Charts are responsive and readable on mobile
- [ ] Data filters work (5/10/All matches)
- [ ] Graceful handling of <3 matches (show "Not enough data")

**Dependencies:** `recharts`

---

### Task 2.2: Leaderboards (Player)

**Goal:** Position-based leaderboards showing how players rank.

**Why:** Competition drives engagement. Players want to know where they stand.

**Files to Create:**
- `src/components/player/Leaderboard.tsx` — Leaderboard display
- `src/lib/leaderboard.ts` — Ranking calculation logic
- `src/__tests__/leaderboard.test.ts` — Unit tests

**Files to Modify:**
- `src/components/player/PlayerHome.tsx` — Add leaderboard card
- `src/pages/player/` — Add leaderboard page (or integrate into existing)

**Implementation Steps:**

1. **Write failing test** — Rankings calculate correctly
2. **Build `src/lib/leaderboard.ts`:**
   ```typescript
   export interface LeaderboardEntry {
     playerId: string;
     playerName: string;
     position: Position;
     avgRating: number;
     matchesPlayed: number;
     rank: number;
     isCurrentUser: boolean;
   }

   export async function getPositionLeaderboard(
     position: Position,
     currentUserId: string
   ): Promise<LeaderboardEntry[]> {
     // Query matches for all players in same position
     // Calculate average rating (min 3 matches)
     // Sort by avg rating descending
     // Assign ranks
     // Mark current user
   }
   ```
3. **Build `Leaderboard.tsx`:**
   - Position filter tabs: GK / DEF / MID / ATT
   - List: Rank, Name, Avg Rating (band pill), Matches
   - Current user highlighted
   - Top 3 get medal emojis: 🥇🥈🥉
   - "You" indicator for current player
4. **Integrate into PlayerHome:**
   - "Your Position" card showing rank + top 3
   - Tap to expand full leaderboard
5. **Privacy:** Only show first name + last initial (e.g., "Alex K.")
6. **Track telemetry:** `trackEvent('leaderboard_viewed', { position })`

**Acceptance Criteria:**
- [ ] Leaderboard ranks players correctly by avg rating
- [ ] Position filtering works
- [ ] Current user is highlighted
- [ ] Privacy: only first name + last initial shown
- [ ] Handles ties (same rank)
- [ ] Min 3 matches to appear on leaderboard

---

### Task 2.3: Push Notifications — Parent (Parent)

**Goal:** Proactive notifications when child's match data is logged.

**Why:** Parents are busy; they need updates pushed to them, not another app to check.

**Files to Create:**
- `supabase/migrations/XXX_push_tokens.sql` — Store device push tokens
- `supabase/functions/send-match-notification/index.ts` — Edge function for notifications
- `src/lib/notifications.ts` — Client-side notification registration
- `src/components/parent/NotificationSettings.tsx` — Notification preferences UI

**Files to Modify:**
- `src/pages/parent/ParentOnboarding.tsx` — Add notification permission prompt
- `src/pages/MatchLog.tsx` — Trigger notification after match save

**Implementation Steps:**

1. **Write failing test** — Notification payload structure
2. **Database migration:**
   ```sql
   CREATE TABLE push_tokens (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     token TEXT NOT NULL,
     platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
     created_at TIMESTAMPTZ DEFAULT now(),
     UNIQUE(user_id, token)
   );

   CREATE TABLE notification_preferences (
     user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
     match_logged BOOLEAN DEFAULT TRUE,
     medal_earned BOOLEAN DEFAULT TRUE,
     goal_progress BOOLEAN DEFAULT TRUE,
     assessment_received BOOLEAN DEFAULT TRUE,
     quiet_hours_start TIME DEFAULT '22:00',
     quiet_hours_end TIME DEFAULT '07:00'
   );
   ```
3. **Build `src/lib/notifications.ts`:**
   - Request notification permission
   - Register service worker
   - Store push token in Supabase
   - `sendMatchNotification(playerId, matchData)` — calls edge function
4. **Build edge function `send-match-notification`:**
   - Query parent connections for the player
   - Get push tokens for each parent
   - Check notification preferences
   - Check quiet hours
   - Send via Firebase Cloud Messaging (FCM)
5. **Build `NotificationSettings.tsx`:**
   - Toggle switches for each notification type
   - Quiet hours time picker
   - "Test Notification" button
6. **Integrate into MatchLog:**
   - After successful save, call `sendMatchNotification()`
7. **Track telemetry:** `trackEvent('notification_sent', { type })`

**Acceptance Criteria:**
- [ ] Parent receives notification when child logs a match
- [ ] Notification includes: player name, match result, rating band
- [ ] Preferences are respected (can disable specific types)
- [ ] Quiet hours are enforced
- [ ] "Test Notification" button works
- [ ] Graceful degradation if permission denied

**Dependencies:** Firebase Cloud Messaging, Supabase Edge Functions

---

## Phase 3: Coach Value (Week 5–6)

Features that make coaches indispensable users.

---

### Task 3.1: Squad Analytics Dashboard (Coach)

**Goal:** Aggregate squad metrics for coaches.

**Why:** Coaches need data to make decisions. Individual player views aren't enough.

**Files to Create:**
- `src/components/coach/SquadAnalytics.tsx` — Analytics dashboard
- `src/lib/squad-analytics.ts` — Aggregate calculation logic
- `src/__tests__/squad-analytics.test.ts` — Unit tests

**Files to Modify:**
- `src/components/coach/CoachHome.tsx` — Add analytics card
- `src/pages/coach/` — Add analytics page

**Implementation Steps:**

1. **Write failing test** — Aggregate calculations are correct
2. **Build `src/lib/squad-analytics.ts`:**
   ```typescript
   export interface SquadAnalytics {
     totalPlayers: number;
     totalMatches: number;
     avgRating: number;
     bandDistribution: Record<BandType, number>;
     mostImproved: { playerId: string; playerName: string; improvement: number };
     needsAttention: { playerId: string; playerName: string; reason: string }[];
     positionBreakdown: Record<Position, { count: number; avgRating: number }>;
   }

   export async function calculateSquadAnalytics(coachUserId: string): Promise<SquadAnalytics> { ... }
   ```
3. **Build `SquadAnalytics.tsx`:**
   - Band distribution bar chart (horizontal)
   - "Most Improved" player card with +X.X indicator
   - "Needs Attention" list (players with declining ratings)
   - Position breakdown grid
   - Date range filter: This Month / Last 3 Months / All Time
4. **Integrate into CoachHome:**
   - "Squad Overview" card with key metrics
   - Tap to expand full analytics
5. **Track telemetry:** `trackEvent('squad_analytics_viewed', { filter })`

**Acceptance Criteria:**
- [ ] Band distribution calculates correctly
- [ ] "Most Improved" identifies correct player
- [ ] "Needs Attention" flags players with declining trends
- [ ] Date range filtering works
- [ ] Handles edge case: no matches in date range

---

### Task 3.2: Quick Assess Flow (Coach)

**Goal:** Streamlined assessment flow — swipe through players, rate 6 sliders, done.

**Why:** Reducing friction increases assessment completion rate.

**Files to Create:**
- `src/components/coach/QuickAssess.tsx` — Swipeable assessment flow
- `src/__tests__/quick-assess.test.tsx` — Interaction tests

**Files to Modify:**
- `src/components/coach/CoachHome.tsx` — Add "Quick Assess" action
- `src/components/coach/CoachAssess.tsx` — Refactor to use shared slider component

**Implementation Steps:**

1. **Write failing test** — Assessment submits with all 6 ratings
2. **Build `QuickAssess.tsx`:**
   - Player card with photo/initials + name + position
   - 6 horizontal sliders (Work Rate, Tactical, Attitude, Technical, Physical, Coachability)
   - Slider labels: 1-10 with emoji indicators (😟😐😊🤩)
   - Optional note field (collapsed by default)
   - "Next Player" button → auto-saves and loads next
   - Progress indicator: "3 of 15 assessed"
   - "Skip" button for players not present
3. **Flow:**
   - Coach opens Quick Assess
   - Sees player list sorted by last assessment date (oldest first)
   - Rates 6 sliders → taps "Next"
   - Repeat until all players assessed
   - Summary screen: "15/15 assessed ✓"
4. **Track telemetry:** `trackEvent('quick_assess_completed', { count, duration_ms })`

**Acceptance Criteria:**
- [ ] All 6 sliders are required before advancing
- [ ] Assessment saves on "Next" (not batched at end)
- [ ] Progress indicator updates correctly
- [ ] Skip doesn't lose progress
- [ ] Summary screen shows completion stats

---

### Task 3.3: Assessment Templates (Coach)

**Goal:** Save and reuse common assessment patterns.

**Why:** Coaches assess the same things repeatedly. Templates save time.

**Files to Create:**
- `src/components/coach/AssessmentTemplates.tsx` — Template management UI
- `supabase/migrations/XXX_assessment_templates.sql` — Templates table

**Files to Modify:**
- `src/components/coach/QuickAssess.tsx` — Add template selector

**Implementation Steps:**

1. **Write failing test** — Template applies correctly to assessment form
2. **Database migration:**
   ```sql
   CREATE TABLE assessment_templates (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     coach_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     work_rate INTEGER,
     tactical INTEGER,
     attitude INTEGER,
     technical INTEGER,
     physical INTEGER,
     coachability INTEGER,
     created_at TIMESTAMPTZ DEFAULT now()
   );
   ```
3. **Build `AssessmentTemplates.tsx`:**
   - "Save Current as Template" button
   - Template list with name + preview of ratings
   - "Apply Template" button on each
   - "Delete Template" with confirmation
4. **Integrate into QuickAssess:**
   - Template dropdown above sliders
   - Selecting a template pre-fills all 6 sliders
   - Coach can still adjust individual sliders after applying
5. **Track telemetry:** `trackEvent('template_used', { template_id })`

**Acceptance Criteria:**
- [ ] Can save current assessment as template
- [ ] Template pre-fills all 6 sliders
- [ ] Can manage (rename/delete) templates
- [ ] Templates are coach-specific (RLS enforced)

---

## Phase 4: Viral Mechanics (Week 7–8)

Features that drive organic growth.

---

### Task 4.1: Referral Program (Player)

**Goal:** Players invite teammates with trackable referral codes.

**Why:** Your invite code system already exists (`invite-codes.ts`). Extend it with incentives.

**Files to Create:**
- `src/lib/referrals.ts` — Referral tracking logic
- `src/components/player/ReferralCard.tsx` — Referral UI
- `supabase/migrations/XXX_referrals.sql` — Referrals table
- `src/__tests__/referrals.test.ts` — Unit tests

**Files to Modify:**
- `src/lib/invite-codes.ts` — Add referral code generation
- `src/components/player/PlayerHome.tsx` — Add referral card
- `src/pages/OnboardingPage.tsx` — Accept referral code during signup

**Implementation Steps:**

1. **Write failing test** — Referral tracks correctly, rewards trigger
2. **Database migration:**
   ```sql
   CREATE TABLE referrals (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     referrer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     referred_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     referral_code TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT now(),
     UNIQUE(referred_id)
   );

   CREATE TABLE referral_rewards (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     milestone INTEGER NOT NULL, -- 1, 3, 5, 10
     reward_type TEXT NOT NULL, -- 'badge', 'frame', 'title'
     reward_value TEXT NOT NULL,
     unlocked_at TIMESTAMPTZ DEFAULT now(),
     UNIQUE(user_id, milestone)
   );
   ```
3. **Build `src/lib/referrals.ts`:**
   ```typescript
   export interface ReferralStats {
     totalReferrals: number;
     referralCode: string; // REF-XXXX
     rewards: ReferralReward[];
     nextMilestone: { count: number; reward: string } | null;
   }

   export async function getReferralStats(userId: string): Promise<ReferralStats> { ... }
   export async function processReferral(referralCode: string, newUserId: string): Promise<void> { ... }
   export function checkReferralRewards(referralCount: number): ReferralReward[] { ... }
   ```
4. **Build `ReferralCard.tsx`:**
   - Referral code display (large, copyable)
   - Share button (native share API)
   - Progress bar to next milestone
   - Rewards list with unlock status
5. **Referral Rewards:**
   - 1 referral: "Recruiter" badge
   - 3 referrals: Custom profile frame
   - 5 referrals: "Scout" title
   - 10 referrals: Early access to new features
6. **Anti-abuse:**
   - Track by device fingerprint + email domain
   - Max 3 referrals per day
   - Referred user must complete onboarding
7. **Track telemetry:** `trackEvent('referral_shared', { code })`, `trackEvent('referral_completed', { referrer_id })`

**Acceptance Criteria:**
- [ ] Referral code generates correctly
- [ ] Referral tracks when new user signs up with code
- [ ] Rewards unlock at correct milestones
- [ ] Share button works on mobile
- [ ] Anti-abuse measures prevent gaming
- [ ] RLS: users can only see their own referrals

---

### Task 4.2: Social Proof Elements (All Personas)

**Goal:** Show users they're part of an active community.

**Why:** "12 players from your academy are already on Trak" creates FOMO and trust.

**Files to Create:**
- `src/lib/social-proof.ts` — Social proof data fetching
- `src/components/trak/SocialProofBanner.tsx` — Reusable banner component

**Files to Modify:**
- `src/components/player/PlayerHome.tsx` — Add social proof banner
- `src/components/coach/CoachHome.tsx` — Add social proof banner
- `src/pages/LandingPage.tsx` — Add social proof to landing

**Implementation Steps:**

1. **Write failing test** — Social proof messages generate correctly
2. **Build `src/lib/social-proof.ts`:**
   ```typescript
   export interface SocialProofMessage {
     text: string;
     type: 'community' | 'activity' | 'achievement';
   }

   export async function getSocialProofMessages(userId: string, role: Role): Promise<SocialProofMessage[]> {
     // "X players from your club are on Trak"
     // "Your position group averaged X.X this week"
     // "Y matches logged across all Trak users today"
     // "Top performer in your age group this month"
   }
   ```
3. **Build `SocialProofBanner.tsx`:**
   - Subtle banner below hero card
   - Rotating messages (one at a time, changes on refresh)
   - Dismissible (persists for session)
4. **Messages by persona:**
   - **Player:** "12 players from [Club] are on Trak" / "Your position group averaged 7.2 this week"
   - **Coach:** "15 players in your squad have logged 47 matches this month"
   - **Parent:** "Join 8 other parents tracking their child's progress"
5. **Track telemetry:** `trackEvent('social_proof_seen', { message_type })`

**Acceptance Criteria:**
- [ ] Messages are accurate and contextual
- [ ] Banner is subtle and non-intrusive
- [ ] Dismiss persists for session
- [ ] Messages rotate on page refresh
- [ ] No PII泄露 (only aggregate numbers)

---

### Task 4.3: Club Bulk Onboarding (Coach)

**Goal:** Coaches can invite entire squad at once via WhatsApp/email.

**Why:** One coach adopting → entire squad follows → 31 new users from ONE acquisition.

**Files to Create:**
- `src/components/coach/BulkInvite.tsx` — Bulk invite UI
- `supabase/functions/send-bulk-invite/index.ts` — Edge function for sending invites
- `src/__tests__/bulk-invite.test.tsx` — Tests

**Files to Modify:**
- `src/components/coach/CoachHome.tsx` — Add "Invite Squad" action

**Implementation Steps:**

1. **Write failing test** — Bulk invite generates correct codes
2. **Build `BulkInvite.tsx`:**
   - Text area for player names (one per line)
   - Auto-generates TRK-XXXX codes for each
   - "Copy All" button (formatted for WhatsApp paste)
   - "Share via WhatsApp" button (pre-filled message)
   - "Share via Email" button (mailto: link)
   - Template message:
     ```
     Hey! I'm using Trak Football to track my progress this season.
     Join my squad with this code: TRK-XXXX
     Download: https://trakfootball.com/join/TRK-XXXX
     ```
3. **Build edge function `send-bulk-invite`:**
   - Accept array of player names + emails
   - Generate unique invite codes
   - Send emails via Resend SMTP
   - Return summary: X sent, Y failed
4. **Track telemetry:** `trackEvent('bulk_invite_sent', { count, method })`

**Acceptance Criteria:**
- [ ] Can generate codes for up to 25 players at once
- [ ] Copy-to-clipboard works
- [ ] WhatsApp share opens with pre-filled message
- [ ] Email sends via Resend (if email provided)
- [ ] Codes are unique and trackable

---

## Cross-Cutting Concerns

### Telemetry Integration

Every new feature must track usage:

```typescript
// Pattern for all new features
import { trackEvent } from '@/lib/telemetry';

// On feature interaction
trackEvent('feature_name', {
  persona: profile.role,
  // feature-specific metadata
});
```

### Design System Compliance

All new components must follow the existing design system:

- **Colors:** Dark navy theme (`#080d1a` background, `#2563EB` primary, `#E8803A` orange, `#E8B84B` gold)
- **Fonts:** Barlow Condensed (headings), Barlow (body)
- **Layout:** Mobile-first, max-width 430px
- **Components:** Use existing shadcn/ui components from `src/components/ui/`

### RLS Policy Pattern

All new tables must have RLS:

```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Players can read their own data
CREATE POLICY "Players can read own data" ON new_table
  FOR SELECT USING (auth.uid() = user_id);

-- Coaches can read squad data
CREATE POLICY "Coaches can read squad data" ON new_table
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM squad_players
      WHERE coach_user_id = auth.uid()
      AND player_user_id = new_table.user_id
    )
  );
```

### Testing Standards

- **Unit tests:** Every `src/lib/*.ts` function
- **Component tests:** Every new component renders correctly
- **Integration tests:** Key user flows (match log → share, assess → template)
- **Coverage target:** >80% for new code

---

## Dependency Graph

```
Phase 1 (Quick Wins)
├── 1.1 Shareable Cards ──────── no dependencies
├── 1.2 Streak Counter ───────── no dependencies
└── 1.3 Personal Records ─────── no dependencies

Phase 2 (Engagement)
├── 2.1 Progress Charts ──────── depends on: match data (exists)
├── 2.2 Leaderboards ─────────── depends on: match data (exists)
└── 2.3 Push Notifications ───── depends on: parent connection system (exists)

Phase 3 (Coach Value)
├── 3.1 Squad Analytics ──────── depends on: match data + assessments (exist)
├── 3.2 Quick Assess ─────────── depends on: assessment form (exists)
└── 3.3 Assessment Templates ─── depends on: 3.2 (Quick Assess)

Phase 4 (Viral)
├── 4.1 Referral Program ─────── depends on: invite codes (exists)
├── 4.2 Social Proof ─────────── depends on: match data (exists)
└── 4.3 Bulk Onboarding ──────── depends on: invite codes (exists)
```

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Push notifications require FCM setup | Medium | Defer to Phase 2; use in-app notifications as fallback |
| Recharts bundle size | Low | Tree-shake; lazy load chart components |
| html-to-image browser compatibility | Low | Test on iOS Safari; provide download fallback |
| Referral abuse (fake signups) | Medium | Device fingerprinting + email domain checks |
| Leaderboard privacy concerns | Medium | First name + last initial only; opt-out option |
| Coach assessment fatigue | Low | Quick Assess flow reduces friction significantly |

---

## Success Metrics

| Metric | Current (Est.) | Target (Post-Phase 4) |
|--------|----------------|----------------------|
| Weekly Active Players (WAP) | ~10 | 20+ |
| Match Logging Frequency | 1x/week | 2x/week |
| Coach Assessment Completion | ~50% | 80%+ |
| Parent Weekly Active | ~20% | 40%+ |
| Referral Conversion Rate | 0% | 15%+ |
| Day 30 Retention | ~20% | 35%+ |
| Viral Coefficient (K) | 0 | >0.8 |

---

## Definition of Done

A task is complete when:

1. ✅ All acceptance criteria are met
2. ✅ Unit tests pass (>80% coverage for new code)
3. ✅ Component renders correctly at 430px max-width
4. ✅ Telemetry events fire correctly
5. ✅ RLS policies are in place (if new tables)
6. ✅ Design system compliance verified
7. ✅ No TypeScript errors
8. ✅ No ESLint warnings
9. ✅ Code reviewed and approved
10. ✅ Deployed to pilot environment

---

## Next Steps

1. **Review this plan** with the founder for approval
2. **Prioritize Phase 1 tasks** based on pilot feedback
3. **Set up telemetry dashboard** to track new metrics
4. **Begin Task 1.1** (Shareable Cards) — highest impact, lowest effort
