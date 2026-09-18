/**
 * Reassembles server-sent-event `data:` lines across chunk boundaries.
 *
 * A ReadableStream hands back arbitrary byte chunks, not whole lines. The
 * feedback stream used to decode each chunk and split it on newlines on its
 * own, so any event that straddled a boundary produced half a JSON object,
 * failed to parse, and was swallowed by a catch — the player silently received
 * feedback with words missing from the middle.
 *
 * Push each decoded chunk; get back only the complete `data:` payloads. A
 * trailing partial line is held until the rest of it arrives.
 */
export class SSEBuffer {
  private buffer = ''

  /** Feed one decoded chunk; returns the complete data payloads it completed. */
  push(chunk: string): string[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    // The last element is whatever came after the final newline — possibly an
    // incomplete line, so it stays in the buffer until more arrives.
    this.buffer = lines.pop() ?? ''
    return lines.map(toPayload).filter((l): l is string => l !== null)
  }

  /** Call once the stream is done, to release a final line with no newline. */
  flush(): string[] {
    const rest = this.buffer
    this.buffer = ''
    const payload = toPayload(rest)
    return payload === null ? [] : [payload]
  }
}

function toPayload(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return null
  return data
}
