import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { localParts, localTodayISO } from '@/lib/event-time'
import { attributeHeatmap, focusAttribute, heatAlpha, weekStarts, type AttributeRow } from '@/lib/squad/attributes'
import { dayMonth } from '@/lib/squad/format'
import { Card, Missing } from './parts'
import type { SquadRoster } from './useSquadRoster'
import { useTranslation } from '@/lib/i18n'
import { useFeature } from '@/components/trak/parked'
import { DRILLS_PATH } from '@/lib/training/library/paths'
import { ATTRIBUTE_WORD } from '@/lib/squad/attribute-words'

/* TRAK-250: Squad > Attributes. The six assessment attributes averaged across the squad, week by week,
   with the spread of each child's latest value. Coach-only: it is never shown to players or parents. */

const WEEKS = 6
const dateOf = (iso: string) => localParts(iso).date

/** Shade of a recorded value: the brand token at an opacity that grows with the value. */
function shade(value: number) {
  const alpha = heatAlpha(value)
  return {
    background: `rgb(var(--t-brand) / ${alpha.toFixed(2)})`,
    color: alpha > 0.5 ? 'rgb(var(--t-on-brand))' : 'rgb(var(--t-ink))',
  }
}

const CELL = 'flex min-h-11 min-w-[52px] flex-col items-center justify-center rounded-[8px] px-1 text-[14px] font-medium'

function Cell({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <td className="p-[3px]"><div className={CELL} style={style}>{children}</div></td>
}

function Trend({ trend }: { trend: number | null }) {
  const { t } = useTranslation()
  if (trend === null) return <Missing />
  if (trend === 0) return <span>→ 0.0</span>
  const up = trend > 0
  return (
    <span style={{ color: up ? 'rgb(var(--t-success))' : 'rgb(var(--t-danger))' }}>
      <span role="img" aria-label={up ? t('coachSquad:up') : t('coachSquad:down')}>{up ? '↑' : '↓'}</span> {Math.abs(trend).toFixed(1)}
    </span>
  )
}

function Row({ row, focus }: { row: AttributeRow; focus: boolean }) {
  const { t } = useTranslation()
  const ring = focus ? { outline: '2px solid rgb(var(--t-ink))', outlineOffset: '-2px' } : undefined
  return (
    <tr>
      <th scope="row" className="whitespace-nowrap py-[3px] pr-3 text-left text-[14px] font-medium"
        style={{ color: focus ? 'rgb(var(--t-danger))' : 'rgb(var(--t-ink))' }}>
        {t(ATTRIBUTE_WORD[row.key])}
      </th>
      {row.weeks.map((v, i) => v === null
        ? <Cell key={i} style={{ background: 'rgb(var(--t-raised))', color: 'rgb(var(--t-ink-3))', ...ring }}><Missing /></Cell>
        : <Cell key={i} style={{ ...shade(v), ...ring }}>{v.toFixed(1)}</Cell>)}
      <Cell style={{ background: 'rgb(var(--t-raised))', color: 'rgb(var(--t-ink))', fontSize: 13 }}>
        {row.range === null ? <Missing /> : (
          <>
            <span>{row.range.min}–{row.range.max}</span>
            <small className="text-[11px] font-normal text-ink-3">{row.range.wide ? t('coachSquad:wide') : t('coachSquad:narrow')}</small>
          </>
        )}
      </Cell>
      <Cell style={{ background: 'rgb(var(--t-raised))', color: 'rgb(var(--t-ink))' }}><Trend trend={row.trend} /></Cell>
    </tr>
  )
}

export function AttributesTab({ roster }: { roster: SquadRoster }) {
  const { assessments } = roster
  const { t } = useTranslation()
  const drills = useFeature('training')
  const weeks = useMemo(() => weekStarts(localTodayISO(), WEEKS), [])
  const rows = useMemo(() => attributeHeatmap(assessments, weeks, dateOf), [assessments, weeks])
  const focus = useMemo(() => focusAttribute(rows), [rows])
  const recorded = rows.some(r => r.weeks.some(v => v !== null))

  return (
    <div className="pt-2">
      <h2 className="text-[20px] font-medium tracking-[-0.01em] text-ink">{t('coachSquad:tabAttributes')}</h2>
      <p className="mt-1 text-[12px] text-ink-3">{t('coachSquad:attrSub', { count: WEEKS })}</p>

      {!recorded || !focus ? (
        <div className="mt-5 rounded-[14px] border border-line bg-surface p-5">
          <p className="text-[15px] font-medium text-ink-2">{t('coachSquad:noAssessmentsWeeks', { count: WEEKS })}</p>
          <p className="mt-1 text-[12px] text-ink-3">{t('coachSquad:onceAssess')}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 laptop:grid-cols-[minmax(0,1fr)_300px]">
          {/* The table scrolls inside its card, never the page. Nothing focusable sits in it, so no ring is clipped. */}
          <div className="min-w-0 rounded-[14px] border border-line bg-surface p-2.5">
            <div tabIndex={0} role="region" aria-label={t('coachSquad:heatmapLabel')}
              className="overflow-x-auto rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
              <table className="w-full min-w-[620px] border-collapse">
                <caption className="sr-only">{t('coachSquad:heatmapCaption', { count: WEEKS })}</caption>
                <thead>
                  <tr>
                    <td />
                    {weeks.map(w => (
                      <th key={w} scope="col" className="py-1 text-center text-[12px] font-medium text-ink-3">{dayMonth(w)}</th>
                    ))}
                    <th scope="col" className="py-1 text-center text-[12px] font-medium text-ink-3">{t('coachSquad:range')}</th>
                    <th scope="col" className="py-1 text-center text-[12px] font-medium text-ink-3">{t('coachSquad:trend')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => <Row key={row.key} row={row} focus={row.key === focus.row.key} />)}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="flex min-w-0 flex-col gap-3.5">
            <section aria-label={t('coachSquad:focusThisWeek')} className="rounded-[14px] border-2 border-ink bg-surface p-4">
              <p className="text-[12px] font-medium text-ink-3">{t('coachSquad:focusThisWeek')}</p>
              <h3 className="mt-1 text-[24px] font-medium tracking-[-0.01em] text-ink">{t(ATTRIBUTE_WORD[focus.row.key])}</h3>
              <p className="mt-1.5 text-[13px] text-ink-2">{focus.sentence}</p>
              {/* TRAK-419: where Training is on, Drills is the one library. */}
              <Link to={drills ? DRILLS_PATH : '/coach/trainings'}
                className="mt-3.5 inline-flex min-h-11 w-full items-center justify-center rounded-[10px] px-3 text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                style={{ background: 'rgb(var(--t-brand))', color: 'rgb(var(--t-on-brand))' }}>
                {t(drills ? 'coachSquad:openDrills' : 'coachSquad:openTrainings')}
              </Link>
            </section>
            <Card title={t('coachSquad:howToReadRange')} muted>
              <p className="text-[13px] text-ink-2">
                {t('coachSquad:howToReadBody')}
              </p>
            </Card>
            <p className="rounded-[10px] bg-raised p-3 text-[12px] text-ink-3">
              {t('coachSquad:coachOnlyNote')}
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}
