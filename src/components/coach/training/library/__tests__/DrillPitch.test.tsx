import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LIBRARY, START_LEVEL, fit, type LibraryDrill } from '@/lib/training/library'
import { DrillPitch, PitchKey } from '../DrillPitch'

/* TRAK-386 (Drill Library 2/11): the pitch picture on screen. */

const drill = (name: string) => LIBRARY.find(d => d.name === name) as LibraryDrill
const keepBall = drill('Keep the ball')

describe('DrillPitch', () => {
  it('full: a picture with a one-line description and the size line', () => {
    render(<DrillPitch drill={keepBall} players={12} level={START_LEVEL} />)
    const img = screen.getByRole('img', { name: /^Keep the ball set-up\. Area shape and size: 13x13 m\. Numbers: 12 players, 9v3\./ })
    expect(img.getAttribute('viewBox')).toBe('0 0 640 420')
    expect(img.querySelectorAll('circle[r="11"]')).toHaveLength(12)
    expect(img.querySelector('text')?.textContent).toBe('13 m')
  })

  it('follows the players and the level', () => {
    const { rerender } = render(<DrillPitch drill={keepBall} players={12} level={START_LEVEL} />)
    rerender(<DrillPitch drill={keepBall} players={16} level={START_LEVEL + 1} />)
    const img = screen.getByRole('img', { name: /Numbers: 16 players, 6v2 in each grid/ })
    expect(img.querySelectorAll('circle[r="11"]')).toHaveLength(16)
    expect(img.querySelector('text')?.textContent).toBe('10 m')
  })

  it('card: zoomed onto the drill, hidden from screen readers (the card says it in words), no size line', () => {
    const { container } = render(<DrillPitch drill={drill('Pass and follow')} players={15} level={START_LEVEL} variant="card" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 640 420')
    expect(svg.querySelector('text')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('two pictures on one page each point at their own arrow head', () => {
    const { container } = render(<>
      <DrillPitch drill={keepBall} players={12} level={START_LEVEL} />
      <DrillPitch drill={keepBall} players={12} level={START_LEVEL} variant="card" />
    </>)
    const ids = [...container.querySelectorAll('marker')].map(m => m.id)
    expect(new Set(ids).size).toBe(2)
    for (const svg of container.querySelectorAll('svg')) {
      const id = svg.querySelector('marker')!.id
      expect([...svg.querySelectorAll('line')].every(l => l.getAttribute('marker-end') === `url(#${id})`)).toBe(true)
    }
  })
})

describe('PitchKey', () => {
  it('says what each colour means for the drill', () => {
    render(<PitchKey legend={fit(drill('Press from the front'), 16, START_LEVEL).legend} />)
    const key = screen.getByRole('list', { name: 'Key' })
    expect([...key.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Team A', 'Team B', 'Spare player', 'Keeper'])
  })
})
