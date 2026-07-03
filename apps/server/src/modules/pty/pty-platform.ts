import { basename } from 'node:path'

/** Platform-aware default shell. */
export function getDefaultShell(): string {
  return resolveDefaultShell({
    platform: process.platform,
    comspec: process.env.COMSPEC,
    shell: process.env.SHELL,
  })
}

/**
 * Pure resolver behind {@link getDefaultShell}, extracted so the fallback
 * semantics can be tested without depending on the host platform/env.
 */
export function resolveDefaultShell(input: {
  platform: NodeJS.Platform
  comspec: string | undefined
  shell: string | undefined
}): string {
  if (input.platform === 'win32') {
    // `||` not `??`: COMSPEC can be set to an empty string on some Windows
    // machines (observed in the wild), and the nullish coalescing operator
    // only falls back on null/undefined. An empty value here flows into
    // node-pty as `file=""` and surfaces as `File not found: ` (empty name).
    return input.comspec || 'cmd.exe'
  }
  return input.shell || '/bin/sh'
}

/** PATH delimiter: `;` on Windows, `:` elsewhere. */
export function getPathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':'
}

/** Extract the command name from an executable path, stripping Windows extensions. */
export function getExecutableCommand(executablePath: string): string {
  return basename(executablePath).replace(/\.(cmd|exe|ps1|bat)$/i, '')
}
