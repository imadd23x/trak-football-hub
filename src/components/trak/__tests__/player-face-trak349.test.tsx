import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FaceDrawing, PlayerFace } from '@/components/trak/PlayerFace'
import { People } from '@/components/coach/EventSheetCoach'
import { HAIR_COLOURS, HAIR_STYLE_COUNT, hairOf } from '@/lib/player-face'

/**
 * TRAK-349: players get the mockup's drawn face instead of initials. Every child shares one neutral skin tone, never
 * one picked per child (Tarek, 3 Nov); only the hair varies by name. A face is drawn, never a photo (G7).
 */

afterEach(cleanup)

const FIRST = ['Adam', 'Jonah', 'Luca', 'Leo', 'Sam', 'Ben', 'Noah', 'Omar', 'Ethan', 'Ryan']
const LAST = ['Cole', 'Reed', 'Grant', 'Wells', 'Price']
const NAMES = FIRST.flatMap(first => LAST.map(last => `${first} ${last}`))

const drawn = (name: string) => render(<FaceDrawing name={name} />).container

describe('TRAK-349 player faces', () => {
  it('gives all 50 synthetic children one skin tone, and varies only the hair', () => {
    expect(NAMES).toHaveLength(50)
    const skins = new Set<string>()
    const hair = new Set<string>()
    for (const name of NAMES) {
      const face = drawn(name)
      face.querySelectorAll('[data-skin]').forEach(part => skins.add(`${part.getAttribute('fill') ?? ''}|${part.getAttribute('style') ?? ''}`))
      const hairPart = face.querySelector('[data-hair]')!
      expect(HAIR_COLOURS).toContain(hairPart.getAttribute('fill'))
      expect(Number(hairPart.getAttribute('data-hair'))).toBeLessThan(HAIR_STYLE_COUNT)
      hair.add(`${hairPart.getAttribute('fill')} ${hairPart.getAttribute('data-hair')}`)
      cleanup()
    }
    expect(skins.size).toBe(1)
    expect(hair.size).toBeGreaterThan(5)
  })

  it('draws the same face for the same name, wherever it appears', () => {
    const once = drawn('Omar Haddad').innerHTML
    cleanup()
    expect(drawn('Omar Haddad').innerHTML).toBe(once)
    cleanup()
    expect(drawn('  Omar Haddad ').innerHTML).toBe(once)
    expect(hairOf('Omar Haddad')).toEqual(hairOf(' Omar Haddad'))
  })

  it("keeps Arc's frame and label, and never shows or fetches a photo", () => {
    const { container } = render(<PlayerFace name="Omar Haddad" size="lg" />)
    expect(screen.getByRole('img', { name: 'Omar Haddad' })).toBeInTheDocument()
    expect(container.querySelector('svg[data-face]')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[src], [href]')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it("draws faces in the event sheet's stacked attendance avatars too", () => {
    const { container } = render(<People heading="Attending" people={[{ id: 'p1', name: 'Omar Haddad' }, { id: 'p2', name: 'Leo Grant' }]} />)
    expect(container.querySelectorAll('svg[data-face]')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Leo Grant' })).toBeInTheDocument()
  })

  it('stays hidden from screen readers when the name is beside it', () => {
    render(<PlayerFace name="Omar Haddad" size="sm" aria-hidden="true" />)
    expect(screen.queryByRole('img', { name: 'Omar Haddad' })).toBeNull()
  })
})
