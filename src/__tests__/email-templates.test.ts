import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// TRAK-142: the repository copies of the four Supabase Auth email templates.
// They are pasted into the dashboard by hand, so a stale copy is a live risk:
// a one-click {{ .ConfirmationURL }} is the link Microsoft's scanner used up
// before families could sign in (TRAK-107). Go evaluates actions inside HTML
// comments too (ce429c2), so "anywhere in the file" means anywhere.

const DIR = join(__dirname, '..', '..', 'email-templates')
const read = (name: string) => readFileSync(join(DIR, name), 'utf8')

const CODE_EMAILS = [
  { file: 'invite-parent.html', type: 'invite' },
  { file: 'magic-link.html', type: 'magiclink' },
  { file: 'reset-password.html', type: 'recovery' },
] as const

describe('email templates: nothing a link scanner can use up', () => {
  for (const name of ['invite-parent.html', 'magic-link.html', 'reset-password.html', 'confirm-signup.html']) {
    it(`${name} has no {{ .ConfirmationURL }} and no /auth/continue, even in a comment`, () => {
      const html = read(name)
      expect(html).not.toMatch(/\{\{-?\s*\.ConfirmationURL/)
      expect(html).not.toContain('/auth/continue')
    })
  }

  for (const { file, type } of CODE_EMAILS) {
    it(`${file} shows the code and links only to /auth/code?type=${type}`, () => {
      const html = read(file)
      expect(html).toContain('{{ .Token }}')
      expect(html).not.toMatch(/\.TokenHash/)
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of hrefs) {
        expect(href.startsWith(`{{ .SiteURL }}/auth/code?type=${type}&`)).toBe(true)
      }
    })
  }

  it('confirm-signup.html keeps its separate /auth/confirm flow (TRAK-117)', () => {
    const html = read('confirm-signup.html')
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href.startsWith('{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}')).toBe(true)
    }
  })

  it('magic-link.html names the child and the academy for a second child (TRAK-118)', () => {
    const html = read('magic-link.html')
    // Both guardian branches (invited_as set, and an older invitation without it).
    expect(html.split('{{ .Data.academy_name }} has added {{ .Data.child_first_name }} to Trak').length - 1).toBe(2)
    expect(html).toContain('Sign in with the code below to approve {{ .Data.child_first_name }}. Nothing about')
  })

  it('every template is plain ASCII, so a stripped charset cannot turn symbols into mojibake', () => {
    for (const name of ['invite-parent.html', 'magic-link.html', 'reset-password.html', 'confirm-signup.html']) {
      const nonAscii = [...read(name)].filter(ch => ch.charCodeAt(0) > 0x7e)
      expect(nonAscii).toEqual([])
    }
  })
})
