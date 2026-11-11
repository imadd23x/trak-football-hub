import { useId, type ReactNode } from 'react'
import { useTranslation } from '@/lib/i18n'

/* TRAK-250: small components the Squad tabs share. */

/** A value that was never recorded: a dash on screen, words for a screen reader. Never 0. */
export function Missing({ what }: { what?: string }) {
  const { t } = useTranslation()
  return <><span aria-hidden>—</span><span className="sr-only">{what ?? t('coachSquad:notRecorded')}</span></>
}

/** A titled card; its title names the region. `muted` is for side notes. */
export function Card({ title, muted = false, children }: { title: string; muted?: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="rounded-[14px] border border-line bg-surface p-4">
      <h3 id={id} className={muted ? 'mb-2 text-[12px] font-medium text-ink-3' : 'mb-3 text-[13px] font-medium text-ink'}>{title}</h3>
      {children}
    </section>
  )
}
