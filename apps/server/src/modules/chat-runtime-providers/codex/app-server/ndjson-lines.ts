/**
 * NDJSON line framing for Codex app-server stdio.
 *
 * Node's `readline` treats U+2028/U+2029 as line breaks. That shreds valid
 * single-line NDJSON whenever a JSON string contains those characters
 * (common in remote plugin catalog descriptions). Codex frames on LF only.
 */

export type NdjsonLineHandler = (line: string) => void

/**
 * Split an incoming byte/text stream into NDJSON records using only `\n`
 * (optional preceding `\r` is stripped). U+2028 / U+2029 stay inside the line.
 */
export class NdjsonLineSplitter {
  private buffer = ''

  constructor(private readonly onLine: NdjsonLineHandler) {}

  push(chunk: string | Buffer): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n')
      if (newlineIndex < 0) {
        return
      }
      let line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      this.onLine(line)
    }
  }

  /** Emit any trailing bytes that never saw a terminating `\n`. */
  flush(): void {
    if (this.buffer.length === 0) {
      return
    }
    const line = this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer
    this.buffer = ''
    this.onLine(line)
  }
}

/** True when a stdout line looks like it could be a JSON value / object. */
export function looksLikeJsonNdjsonLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}
