import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { MobileShell, NavBar } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { useFeature } from '@/components/trak/parked'
import { useAuth } from '@/contexts/AuthContext'
import {
  IconOverview, IconSquad, IconMatch, IconTraining,
  IconAssess, IconProgress, IconAward, IconParentLink, IconSessions, IconTips,
} from '@/components/icons/TrakIcons'
import { BAND_TEXT } from '@/lib/types'

// ─── Atoms (defined first so they're available everywhere) ───────────────────

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[10px] p-3" style={{ background: 'rgb(var(--t-brand) / 0.06)', border: '1px solid rgb(var(--t-brand) / 0.14)' }}>
      <span className="text-brand flex-shrink-0 mt-0.5 text-[11px]">→</span>
      <p className="text-[12px] text-ink-2 leading-relaxed">{children}</p>
    </div>
  )
}

function StatusRow({ label, color, dot, desc }: { label: string; color: string; dot: string; desc: string }) {
  return (
    <div className="flex gap-2.5 items-start rounded-[10px] p-3" style={{ background: 'rgb(var(--t-ground))', border: '1px solid rgb(var(--t-line))' }}>
      <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: dot }} />
      <div>
        <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
        <p className="text-[11px] text-ink-3 leading-snug mt-0.5">{desc}</p>
      </div>
    </div>
  )
}

function MethodCard({ title, tag, tagColor, desc }: { title: string; tag: string; tagColor: string; desc: string }) {
  return (
    <div className="rounded-[12px] p-3.5" style={{ background: 'rgb(var(--t-ground))', border: '1px solid rgb(var(--t-line))' }}>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgb(var(--t-brand) / 0.08)', color: tagColor, fontFamily: 'var(--t-font-mono)' }}>{tag}</span>
      </div>
      <p className="text-[12px] text-ink-2 leading-relaxed">{desc}</p>
    </div>
  )
}

// ─── Section content — render functions, called at render time ────────────────

function ContentOverview() {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      <p>TRAK is a performance tracking platform for football coaches and their players. As a coach, you're the source of truth — your assessments and session logs drive every number your players see on their profile.</p>
      <p>Your players get a running record of their development: match ratings, coach assessments, awards, and an evolution card that tracks progress over time. Parents, if invited, get a read-only view of that same journey.</p>
      <Rule>Your data is yours. No other coach can see your squad, sessions, or assessments.</Rule>
    </div>
  )
}

function ContentSquad() {
  return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
      <p>Your squad is the list of players you coach. Each player can exist in two states:</p>
      <div className="space-y-2">
        <StatusRow label="Unlinked" color="rgb(var(--t-ink-2))" dot="rgb(var(--t-ink-3))" desc="You've added the player's name and position. They appear in your squad but have no TRAK account yet." />
        <StatusRow label="Linked" color="rgb(var(--t-brand))" dot="rgb(var(--t-brand))" desc="The player's account is connected to their place on your roster. Their match history, evolution card and passport are now live." />
      </div>
      <Rule>Go to <b className="text-ink">Squad → +</b> to add a player. Name, position and age group is all you need.</Rule>
      <p>Once a player links their account, any assessments or match logs you create for them automatically appear in their profile.</p>
    </div>
  )
}

function ContentMatches() {
  // TRAK-288: where Games is on, a match is evaluated on its game page instead of logged.
  const games = useFeature('games')
  if (games) return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
      <p>Each match has its page in <b className="text-ink">Games</b>: the logistics, your game plan and, from full time, its evaluation. On Home's week a played match offers <b className="text-ink">Evaluate</b>.</p>
      <Rule>The evaluation is a draft only you see. Save it and sleep on it: nothing reaches players or families until you publish it.</Rule>
    </div>
  )
  return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
      <p>There are two ways to log a match. On Home's week, a match that has kicked off offers <b className="text-ink">Log it</b>; or tap the <b className="text-ink">+</b>:</p>
      <MethodCard title="Quick Match Log" tag="1–2 min" tagColor="rgb(var(--t-brand))" desc="Enter opponent, score, competition type (League / Cup / Friendly) and venue. Tick who played. TRAK calculates a rating for every linked player automatically based on their position and the result." />
      <MethodCard title="Full Session Log" tag="5 min" tagColor="rgb(var(--t-brand) / 0.6)" desc="Adds notes, individual minutes played, and detailed attendance tracking. Best used for cup games or key fixtures you want a full record of." />
      <Rule>The quick log is designed to be done at full time, pitch-side. Use it as your default.</Rule>
    </div>
  )
}

function ContentTraining() {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      <p>Log training sessions with the <b className="text-ink">+</b>, or take the register from Home's week once a training has started. Choose a session type (Fitness, Technical, Tactical, Conditioning or Mixed), add a title, and tick who attended.</p>
      <p>Training sessions don't generate ratings for players — they're an attendance and workload record. Coaches who use TRAK consistently build a full-season picture of who shows up and how hard they work.</p>
      <Rule>Session history is visible to club administrators (read-only). It's not shown to players or parents.</Rule>
    </div>
  )
}

function ContentAssessments() {
  const dims = [
    ['Work Rate', 'Effort and engine — does the player work for the team?'],
    ['Tactical', 'Reading the game, positioning, decision-making under pressure'],
    ['Attitude', 'Professionalism and response to feedback'],
    ['Technical', 'Ball control, passing, shooting, first touch'],
    ['Physical', 'Pace, strength, stamina, athleticism'],
    ['Coachability', 'Does the player implement feedback and improve?'],
  ]
  return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
      <p>TRAK assessments use 6 dimensions rated 1–10:</p>
      <div className="grid grid-cols-2 gap-2">
        {dims.map(([dim, desc]) => (
          <div key={dim} className="rounded-[10px] p-3" style={{ background: 'rgb(var(--t-ground))', border: '1px solid rgb(var(--t-line))' }}>
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-ink-2 mb-1" style={{ fontFamily: 'var(--t-font-mono)' }}>{dim}</p>
            <p className="text-[11px] text-ink-3 leading-snug">{desc}</p>
          </div>
        ))}
      </div>
      <p>The average of the 6 scores becomes the player's coach rating for that session. Over time these build into an overall band.</p>
      <Rule>Private notes you add to an assessment are coach-only. Players and parents never see them.</Rule>
      <MethodCard title="Quick Assess" tag="30 sec" tagColor="rgb(var(--t-brand))" desc="Rate any player with a single overall flag (Standout, Good, Fair, Needs Work). Useful after training when you don't have time for the full form." />
    </div>
  )
}

function ContentRatings() {
  const bands = [
    { band: 'Exceptional', range: '9.0 – 10.0', color: BAND_TEXT.Exceptional },
    { band: 'Standout',    range: '8.0 – 8.9',  color: BAND_TEXT.Standout },
    { band: 'Good',        range: '7.0 – 7.9',  color: BAND_TEXT.Good },
    { band: 'Steady',      range: '6.0 – 6.9',  color: BAND_TEXT.Steady },
    { band: 'Mixed',       range: '5.0 – 5.9',  color: BAND_TEXT.Mixed },
    { band: 'Developing',  range: '0.0 – 4.9',  color: BAND_TEXT.Developing },
  ]
  return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
      <p>Each assessment produces a score from 1–10. Match ratings are computed on the same scale, factoring in position, competition type, result and venue.</p>
      <p>Scores translate into <b className="text-ink">performance bands:</b></p>
      <div className="space-y-1.5">
        {bands.map(b => (
          <div key={b.band} className="flex items-center justify-between rounded-[8px] px-3 py-2" style={{ background: 'rgb(var(--t-ground))', border: '1px solid rgb(var(--t-line))' }}>
            <span className="text-[12px] font-medium" style={{ color: b.color }}>{b.band}</span>
            <span className="text-[10px] text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>{b.range}</span>
          </div>
        ))}
      </div>
      <p>A player's <b className="text-ink">OVR</b> is their rolling average across all assessments you've given them. It anchors their card tier: Bronze → Silver → Gold → Volt → Icon.</p>
      <Rule>Consistent assessments build a more accurate picture. Aim to assess each player at least once a month.</Rule>
    </div>
  )
}

function ContentRecognition() {
  const awards = [
    ['Player of the Week', 'POTW'],
    ['Player of the Month', 'POTM'],
    ['Player of the Season', 'POTS'],
    ['Most Improved', 'Improvement'],
    ['Top Scorer', 'Goals'],
  ]
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      <p>From the <b className="text-ink">Recognition</b> tab, you can award any player in your squad:</p>
      <div className="space-y-1.5">
        {awards.map(([name, tag]) => (
          <div key={tag} className="flex items-center gap-3 rounded-[8px] px-3 py-2.5" style={{ background: 'rgb(var(--t-ground))', border: '1px solid rgb(var(--t-line))' }}>
            <span className="text-[11px] text-ink flex-1">{name}</span>
            <span className="text-[9px] font-medium tracking-[0.1em] uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgb(var(--t-brand) / 0.1)', color: 'rgb(var(--t-brand))', fontFamily: 'var(--t-font-mono)' }}>{tag}</span>
          </div>
        ))}
      </div>
      <p>Awards appear on the player's profile and evolution card. You can add a personal note with each award. Linked players are notified.</p>
    </div>
  )
}

function ContentParents() {
  const items: [string, string, boolean][] = [
    ['✓', 'Match history and results', true],
    ['✓', 'Performance bands and OVR', true],
    ['✓', 'Coach assessment scores (Work Rate, Tactical, etc.)', true],
    ['✓', 'Recognition awards you give their child', true],
    ['✗', 'Your private assessment notes', false],
    ['✗', 'Other players in your squad', false],
    ['✗', 'Attendance records', false],
  ]
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      <p>Parents join TRAK through an invite link the player sends them from their own profile. Once linked, the parent gets a read-only view of:</p>
      <div className="space-y-1.5">
        {items.map(([icon, label, allowed]) => (
          <div key={label} className="flex items-start gap-2.5">
            <span className="mt-0.5 text-[11px] font-bold flex-shrink-0" style={{ color: allowed ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))' }}>{icon}</span>
            <span className="text-[12px]" style={{ color: allowed ? 'rgb(var(--t-ink-2))' : 'rgb(var(--t-ink-3))' }}>{label}</span>
          </div>
        ))}
      </div>
      <Rule>Parents cannot contact you through TRAK. The platform keeps the parent–coach boundary clear.</Rule>
    </div>
  )
}

function ContentSchedule() {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      <p>The <b className="text-ink">Schedule</b> tab lets you plan upcoming sessions and matches. You can type a fixture list in plain text and TRAK's AI will parse it into calendar events automatically.</p>
      <p>Events you mark as <b className="text-ink">Published</b> become visible to your linked players and their parents. Unpublished events are coach-only drafts.</p>
      <Rule>Published events appear on players' profiles the next time they open the app.</Rule>
    </div>
  )
}

function ContentTips() {
  const steps: [string, string][] = [
    ["Add your full squad", "Even players without a TRAK account yet. You can assess them immediately — they will see the history when they join."],
    ["Log your next match with Quick Log", "Do it pitch-side at full time. Takes 90 seconds. This is the fastest way to show players that TRAK is real and active."],
    ["Do one full assessment per player", "After your first session, fill in the 6-dimension form for each player. This seeds their OVR and unlocks their card."],
    ["Give out one award", "Recognition costs nothing and means everything. Start with a Player of the Week after your first match."],
  ]
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      <ol className="space-y-3 list-none">
        {steps.map(([title, desc], i) => (
          <li key={i} className="flex gap-3">
            <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-on-brand" style={{ background: 'rgb(var(--t-brand))' }}>{i + 1}</span>
            <div>
              <p className="text-[12px] font-medium text-ink mb-0.5">{title}</p>
              <p className="text-[11px] text-ink-3 leading-relaxed">{desc}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── Section definitions ──────────────────────────────────────────────────────

type IconComponent = (props: { size?: number; color?: string }) => JSX.Element

interface Section {
  id: string
  Icon: IconComponent
  title: string
  subtitle: string
  Content: () => JSX.Element
}

const SECTIONS: Section[] = [
  { id: 'overview',    Icon: IconOverview,    title: 'What is TRAK?',          subtitle: 'The big picture',                    Content: ContentOverview    },
  { id: 'squad',       Icon: IconSquad,       title: 'Building Your Squad',    subtitle: 'Adding players and linking accounts', Content: ContentSquad       },
  { id: 'matches',     Icon: IconMatch,       title: 'Logging Matches',        subtitle: 'Quick log vs full session',           Content: ContentMatches     },
  { id: 'training',    Icon: IconTraining,    title: 'Logging Training',       subtitle: 'Tracking attendance and sessions',    Content: ContentTraining    },
  { id: 'assessments', Icon: IconAssess,      title: 'Assessing Players',      subtitle: 'The 6-dimension framework',           Content: ContentAssessments },
  { id: 'ratings',     Icon: IconProgress,    title: 'The Rating System',      subtitle: 'How bands and OVR are calculated',    Content: ContentRatings     },
  { id: 'recognition', Icon: IconAward,       title: 'Recognition & Awards',   subtitle: 'Motivating your squad',               Content: ContentRecognition },
  { id: 'parents',     Icon: IconParentLink,  title: 'Parent Connections',     subtitle: 'What parents can and cannot see',     Content: ContentParents     },
  { id: 'schedule',    Icon: IconSessions,    title: 'The calendar',           subtitle: 'Top left on Home: schedule and publish',       Content: ContentSchedule    },
  { id: 'tips',        Icon: IconTips,        title: 'Tips for Getting Started', subtitle: 'Your first week with TRAK',         Content: ContentTips        },
]

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ section, open, onToggle }: { section: Section; open: boolean; onToggle: () => void }) {
  const Content = section.Content
  const Icon = section.Icon
  return (
    <div
      className="rounded-[18px] overflow-hidden"
      style={{ background: 'rgb(var(--t-surface))', border: `1px solid ${open ? 'rgb(var(--t-brand) / 0.2)' : 'rgb(var(--t-line))'}` }}
    >
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left">
        <div
          className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
          style={{
            background: open ? 'rgb(var(--t-brand) / 0.08)' : 'rgb(var(--t-raised))',
            border: `1px solid ${open ? 'rgb(var(--t-brand) / 0.18)' : 'rgb(var(--t-line))'}`,
          }}
        >
          <Icon size={16} color={open ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium text-ink leading-tight" style={{ fontFamily: 'var(--t-font)' }}>{section.title}</p>
          <p className="text-[11px] text-ink-3 mt-0.5">{section.subtitle}</p>
        </div>
        <span className="flex-shrink-0 text-ink-3">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line">
          <Content />
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoachManual() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [openId, setOpenId] = useState<string | null>('overview')

  return (
    <MobileShell width="read">
      {/* Topbar */}
      <div className="flex items-center gap-3 pt-3 pb-3 border-b border-line shrink-0">
        <button
          onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
          className="w-[34px] h-[34px] bg-raised border border-line rounded-[10px] flex items-center justify-center flex-shrink-0"
          aria-label="Back"
        >
          <ChevronLeft size={14} className="text-ink" />
        </button>
        <div>
          <p className="text-[16px] font-medium text-ink leading-tight" style={{ fontFamily: 'var(--t-font)' }}>How Trak works</p>
          <p className="text-[10px] text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>{SECTIONS.length} SECTIONS</p>
        </div>
      </div>

      {/* Intro */}
      <div className="mt-4 mb-3 rounded-[14px] px-4 py-3.5" style={{ background: 'rgb(var(--t-brand) / 0.06)', border: '1px solid rgb(var(--t-brand) / 0.14)' }}>
        <p className="text-[12px] text-ink-2 leading-relaxed">
          Everything you need to get your squad up and running on TRAK. Tap any section to expand it.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-2 pb-16">
        {SECTIONS.map(s => (
          <SectionCard
            key={s.id}
            section={s}
            open={openId === s.id}
            onToggle={() => setOpenId(prev => prev === s.id ? null : s.id)}
          />
        ))}
      </div>
      {/* TRAK-254: a coach on a laptop keeps the side menu here (anyone can open this page). */}
      {profile?.role === 'coach' && <>
        <QuickAdd sideMenuOnly />
        <NavBar role="coach" sideMenuOnly activeTab="/coach/profile" onNavigate={navigate} />
      </>}
    </MobileShell>
  )
}
