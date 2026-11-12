import { i18n } from '@/lib/i18n'

/* TRAK-407: a band's word ('Good') and an appearance ('started') are kept as saved; these give the word shown for
   each in the language showing. Call them from a component that uses useTranslation(). */

const key = (kind: string, value: string) => `coachAssess:${kind}_${value}` as 'coachAssess:overall'

/** 'Good' -> the band's word in the language showing; anything unknown is shown as it is. */
export const bandWord = (word: string) => (i18n.exists(key('band', word.toLowerCase())) ? i18n.t(key('band', word.toLowerCase())) : word)

/** 'started' | 'sub' | 'didnt_play' | 'training' -> its word. */
export const appearanceWord = (value: string) => (i18n.exists(key('appearance', value)) ? i18n.t(key('appearance', value)) : value)
