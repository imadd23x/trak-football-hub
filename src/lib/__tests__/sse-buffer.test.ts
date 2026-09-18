import { describe, it, expect } from 'vitest'
import { SSEBuffer } from '../sse-buffer'

function dataLine(text: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`
}

describe('SSEBuffer', () => {
  it('reads whole events arriving in one chunk', () => {
    const b = new SSEBuffer()
    expect(b.push(dataLine('Hello'))).toEqual([dataLine('Hello').slice(6).trim()])
  })

  it('does not lose an event split across two chunks', () => {
    const b = new SSEBuffer()
    const line = dataLine('Great first touch')
    const split = Math.floor(line.length / 2)

    const first = b.push(line.slice(0, split))
    const second = b.push(line.slice(split))

    const all = [...first, ...second]
    expect(all).toHaveLength(1)
    const parsed = JSON.parse(all[0])
    expect(parsed.choices[0].delta.content).toBe('Great first touch')
  })

  it('handles several events in one chunk', () => {
    const b = new SSEBuffer()
    const out = b.push(dataLine('a') + dataLine('b') + dataLine('c'))
    expect(out).toHaveLength(3)
  })

  it('holds back a trailing partial line until the rest arrives', () => {
    const b = new SSEBuffer()
    expect(b.push(dataLine('done') + 'data: {"par')).toHaveLength(1)
    expect(b.push('tial":true}\n')).toEqual(['{"partial":true}'])
  })

  it('ignores [DONE] and non-data lines', () => {
    const b = new SSEBuffer()
    expect(b.push('data: [DONE]\n')).toEqual([])
    expect(b.push(': keep-alive comment\n\n')).toEqual([])
  })

  it('reassembles a message delivered one character per chunk', () => {
    const b = new SSEBuffer()
    const line = dataLine('keep going')
    const collected: string[] = []
    for (const ch of line) collected.push(...b.push(ch))
    expect(collected).toHaveLength(1)
    expect(JSON.parse(collected[0]).choices[0].delta.content).toBe('keep going')
  })

  it('flush returns a final unterminated line', () => {
    const b = new SSEBuffer()
    expect(b.push('data: {"a":1}')).toEqual([])
    expect(b.flush()).toEqual(['{"a":1}'])
  })
})
