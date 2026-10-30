/**
 * TRAK-316: a row of cards snaps card by card on touch only. With a mouse or trackpad, mandatory snapping pulled the row
 * to the next stop mid-swipe and fought a scroll back (TRAK-279 found it on the player profile; Matches home, Home's
 * Needs you and the parent's cards had it too). The scroll area decides, so every row gets it.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const scrollArea = async (fine: boolean) => {
  vi.resetModules()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: fine)' ? fine : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
  return (await import('@/components/arc/scroll-area/scroll-area')).ScrollArea
}

afterEach(() => vi.unstubAllGlobals())

describe('TRAK-316: rows snap on touch only', () => {
  it('with a mouse or trackpad, the row follows the swipe', async () => {
    const ScrollArea = await scrollArea(true)
    render(<ScrollArea orientation="horizontal" snap="x mandatory" label="Your matches"><div /></ScrollArea>)
    expect(screen.getByRole('region', { name: 'Your matches' }).style.scrollSnapType).toBe('')
  })

  it('on touch, it snaps card by card', async () => {
    const ScrollArea = await scrollArea(false)
    render(<ScrollArea orientation="horizontal" snap="x mandatory" label="Your matches"><div /></ScrollArea>)
    expect(screen.getByRole('region', { name: 'Your matches' }).style.scrollSnapType).toBe('x mandatory')
  })
})
