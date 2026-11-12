import type { ReactNode } from 'react'
import { WIDE_COLUMN } from '@/components/trak'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { useFeature } from '@/components/trak/parked'
import { useTranslation } from '@/lib/i18n'
import type words from '@/locales/en/coachHowTrakWorks.json'

/* TRAK-418 (11 Nov review; Kostas, 12 Nov: option A, a coach's own page). Settings › How Trak works opened a page
   written for players (a rating engine, "how honestly you self-rated"), and an older coach manual (awards, a Recognition
   tab, quick logs) sat behind the old Profile. A coach now reads this page.
   Kostas, 12 Nov: it reads in the order a coach meets Trak. First, before the season: the squad, the season plan,
   Formations. Then every week, Trak's four core jobs: Scheduling, Assessing, Planning training, Preparing for matches.
   A part or line for something the academy has switched off doesn't show, so the page never describes what the coach
   can't open. Players and parents keep their own page (/how-it-works). The words are Kostas's to settle; the Greek
   follows his final English (TRAK-410). */

type Word = keyof typeof words

const Lines = ({ lines, untitled = false }: { lines: (Word | false)[]; untitled?: boolean }) => {
  const { t } = useTranslation()
  return (
    <ul className={`grid gap-2 ${untitled ? '' : 'mt-2'}`}>
      {lines.filter((line): line is Word => !!line).map(line =>
        <li key={line} className="text-[15px] leading-snug text-ink-2">{t(`coachHowTrakWorks:${line}`)}</li>)}
    </ul>
  )
}

const Card = ({ id, title, lines }: { id: string; title: Word; lines: (Word | false)[] }) => {
  const { t } = useTranslation()
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-surface p-4 tablet:p-5">
      <h3 id={id} className="text-[17px] font-medium text-ink">{t(`coachHowTrakWorks:${title}`)}</h3>
      <Lines lines={lines} />
    </section>
  )
}

/** A stage of the coach's year: its number, its name and what's in it. */
const Stage = ({ id, step, title, intro, children }: { id: string; step?: number; title: Word; intro?: Word; children: ReactNode }) => {
  const { t } = useTranslation()
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div>
        <h2 id={id} className="flex items-center gap-2.5 text-[19px] font-medium text-ink">
          {step && <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full text-[14px]"
            style={{ background: 'rgb(var(--t-brand))', color: 'rgb(var(--t-on-brand))' }}>{step}</span>}
          {t(`coachHowTrakWorks:${title}`)}
        </h2>
        {intro && <p className="mt-1 text-[15px] text-ink-2">{t(`coachHowTrakWorks:${intro}`)}</p>}
      </div>
      {children}
    </section>
  )
}

export default function CoachHowTrakWorks() {
  const { t } = useTranslation()
  const on = {
    events: useFeature('events'), games: useFeature('games'), training: useFeature('training'), season: useFeature('season_plan'),
  }

  return (
    <div className="min-h-screen bg-ground pb-28">
      <div className={WIDE_COLUMN}>
        <header className="arc grid gap-3 pt-5 pb-4">
          <CoachTrail current={t('coachHowTrakWorks:title')} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{t('coachHowTrakWorks:title')}</h1>
          <p className="max-w-[60ch] text-[15px] text-ink-2">{t('coachHowTrakWorks:intro')}</p>
        </header>
        <div className="grid gap-8">
          <Stage id="how-before" step={1} title="beforeTitle">
            <div className="rounded-2xl border border-line bg-surface p-4 tablet:p-5">
              <Lines untitled lines={['beforeSquad', on.season && 'beforePlan', 'beforeFormations']} />
            </div>
          </Stage>
          <Stage id="how-week" step={2} title="weekTitle" intro="weekIntro">
            <div className="grid gap-3 tablet:grid-cols-2">
              {on.events && <Card id="how-scheduling" title="schedulingTitle" lines={['scheduling1', 'scheduling2', 'scheduling3']} />}
              <Card id="how-assessing" title="assessingTitle" lines={['assessingPlayer', on.season && 'assessingDue', on.season && 'assessingObjectives']} />
              {on.training && <Card id="how-training" title="trainingTitle" lines={['training1', 'training2', 'training3']} />}
              {on.games && <Card id="how-matches" title="matchesTitle" lines={['matches1', 'matches2']} />}
            </div>
          </Stage>
          <Stage id="how-good" title="goodTitle">
            <div className="rounded-2xl border border-line bg-surface p-4 tablet:p-5">
              <Lines untitled lines={['goodFamilies', 'goodHome', 'goodSettings']} />
            </div>
          </Stage>
        </div>
      </div>
    </div>
  )
}
