import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { el } from 'date-fns/locale'
import { currentLanguage, dateLocale, deviceLanguage, i18n, LANGUAGES, showLanguage, SOURCE_LANGUAGE, startLanguage } from '@/lib/i18n'

/* TRAK-406 (Languages 1/8): the word files. Every language in LANGUAGES has
   every English word, with the plural forms its own grammar needs, and nothing
   else; so adding a language is one list entry and one folder, and the test
   says what is missing. */

const LOCALES = join(process.cwd(), 'src/locales')
const read = (code: string, area: string) => JSON.parse(readFileSync(join(LOCALES, code, `${area}.json`), 'utf8')) as Record<string, string>
const AREAS = readdirSync(join(LOCALES, SOURCE_LANGUAGE)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))
const PLURAL = /_(zero|one|two|few|many|other)$/
const variables = (text: string) => [...text.matchAll(/\{\{\s*(\w+)/g)].map(match => match[1]).sort()

/** The words a translation may use beyond the English one's, because the code passes them too. */
const EXTRA_VARIABLES: Record<string, string[]> = {
  'settings:switchSaveError': ['label'],
  'settings:switchLoadError': ['label'],
}

/** The keys a language needs: English's, with each plural word in the language's own plural forms. */
function keysFor(code: string, area: string) {
  const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories
  const keys = new Set<string>()
  for (const key of Object.keys(read(SOURCE_LANGUAGE, area))) {
    if (PLURAL.test(key)) forms.forEach(form => keys.add(key.replace(PLURAL, `_${form}`)))
    else keys.add(key)
  }
  return [...keys].sort()
}

afterEach(async () => {
  await i18n.changeLanguage(SOURCE_LANGUAGE)
  localStorage.clear()
})

describe('TRAK-406: the word files', () => {
  it('has one folder per language, and a language for every folder', () => {
    const folders = readdirSync(LOCALES, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    expect(folders.sort()).toEqual(LANGUAGES.map(language => language.code).sort())
  })

  it.each(LANGUAGES.map(language => language.code))('%s has every English word, and no others', code => {
    for (const area of AREAS) {
      const words = read(code, area)
      expect(Object.keys(words).sort(), `${code}/${area}.json`).toEqual(keysFor(code, area))
      for (const [key, text] of Object.entries(words)) {
        expect(typeof text === 'string' && text.trim().length > 0, `${code}/${area}.json ${key} is empty`).toBe(true)
        const english = read(SOURCE_LANGUAGE, area)[key.replace(PLURAL, '_other')] ?? read(SOURCE_LANGUAGE, area)[key]
        const allowed = [...variables(english), ...(EXTRA_VARIABLES[`${area}:${key}`] ?? [])]
        for (const name of variables(text)) expect(allowed, `${code}/${area}.json ${key} uses {{${name}}}`).toContain(name)
      }
    }
  })

  it('checks every area\'s keys in the type check (i18next.d.ts)', () => {
    const types = readFileSync(join(process.cwd(), 'src/lib/i18n/i18next.d.ts'), 'utf8')
    for (const area of AREAS) expect(types, area).toContain(`${area}: typeof ${area}`)
  })

  it('names each language in itself, once', () => {
    expect(LANGUAGES.map(language => language.name)).toEqual(['English', 'Ελληνικά'])
    expect(new Set(LANGUAGES.map(language => language.code)).size).toBe(LANGUAGES.length)
  })
})

describe('TRAK-406: showing a language', () => {
  it('starts in English, with English day names', () => {
    expect(currentLanguage()).toBe('en')
    expect(i18n.t('nav:home')).toBe('Home')
    expect(dateLocale()).toBeUndefined()
  })

  it('shows Greek once picked: its words, its day names, and the page says so', async () => {
    await showLanguage('el')
    expect(currentLanguage()).toBe('el')
    expect(i18n.t('nav:home')).toBe('Αρχική')
    expect(i18n.t('common:change', { count: 2 })).toBe('αλλαγές')
    expect(dateLocale()).toBe(el)
    expect(document.documentElement.lang).toBe('el')
    expect(document.documentElement.dir).toBe('ltr')
    expect(deviceLanguage()).toBe('el')
  })

  it('falls back to English for a word with no translation, never a blank', async () => {
    await showLanguage('el')
    i18n.addResource('en', 'nav', 'onlyInEnglish', 'Only in English')
    expect(i18n.t('nav:onlyInEnglish' as 'nav:home')).toBe('Only in English')
  })

  it('opens in the language last picked on this device', async () => {
    localStorage.setItem('trak.language', 'el')
    await startLanguage()
    expect(currentLanguage()).toBe('el')
  })

  it('ignores a language this version of Trak does not know', async () => {
    localStorage.setItem('trak.language', 'xx')
    expect(deviceLanguage()).toBeNull()
    await startLanguage()
    expect(currentLanguage()).toBe('en')
  })
})
