import { WIDE_COLUMN } from '@/components/trak'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { useFeature } from '@/components/trak/parked'
import { useTranslation } from '@/lib/i18n'

/* TRAK-418 (11 Nov review; Kostas, 12 Nov: option A, a coach's own page). Settings › How Trak works opened a page
   written for players (a rating engine, "how honestly you self-rated"), and an older coach manual (awards, a Recognition
   tab, quick logs) sat behind the old Profile. A coach now reads this page: what Trak does today, where each thing is,
   and what families see. A part for Matches, Training or the season plan shows only where the academy has it on, so
   the page never describes something the coach can't open. Players and parents keep their own page (/how-it-works).
   The words are a first draft for Kostas to settle; the Greek follows his (TRAK-410). */

type Section = 'week' | 'squad' | 'matches' | 'training' | 'season' | 'assess' | 'families' | 'settings'

/** How many lines each part has (week1, week2, …, after weekTitle), in coachHowTrakWorks.json. */
const LINES: Record<Section, number> = { week: 4, squad: 2, matches: 3, training: 3, season: 2, assess: 2, families: 1, settings: 2 }

export default function CoachHowTrakWorks() {
  const { t } = useTranslation()
  const on = { matches: useFeature('games'), training: useFeature('training'), season: useFeature('season_plan') }
  const sections: Section[] = ['week', 'squad',
    ...(on.matches ? ['matches' as const] : []),
    ...(on.training ? ['training' as const] : []),
    ...(on.season ? ['season' as const] : []),
    'assess', 'families', 'settings']

  return (
    <div className="min-h-screen bg-ground pb-28">
      <div className={WIDE_COLUMN}>
        <header className="arc grid gap-3 pt-5 pb-4">
          <CoachTrail current={t('coachHowTrakWorks:title')} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{t('coachHowTrakWorks:title')}</h1>
          <p className="max-w-[60ch] text-[15px] text-ink-2">{t('coachHowTrakWorks:intro')}</p>
        </header>
        <div className="grid gap-3 tablet:grid-cols-2">
          {sections.map(section => (
            <section key={section} aria-labelledby={`how-${section}`} className="rounded-2xl border border-line bg-surface p-4 tablet:p-5">
              <h2 id={`how-${section}`} className="text-[17px] font-medium text-ink">{t(`coachHowTrakWorks:${section}Title`)}</h2>
              <ul className="mt-2 grid gap-2">
                {Array.from({ length: LINES[section] }, (_, i) => (
                  <li key={i} className="text-[15px] leading-snug text-ink-2">
                    {t(`coachHowTrakWorks:${section}${i + 1}` as 'coachHowTrakWorks:week1')}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
