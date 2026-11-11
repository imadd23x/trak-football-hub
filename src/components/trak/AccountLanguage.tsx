import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { currentLanguage, isLanguage, showLanguage } from '@/lib/i18n'

/**
 * TRAK-406 (Languages 1/8): once someone is signed in, Trak shows the language saved on their account, whatever this
 * device showed before; so a coach who picked Ελληνικά on their phone gets Greek on the laptop too. An account that has
 * never picked keeps this device's language. A tag the app doesn't know is ignored (English stays).
 */
export function AccountLanguage() {
  const { profile } = useAuth()
  const saved = profile?.language
  useEffect(() => {
    if (isLanguage(saved) && saved !== currentLanguage()) void showLanguage(saved).catch(() => { /* stays as it is */ })
  }, [saved, profile?.user_id])
  return null
}
