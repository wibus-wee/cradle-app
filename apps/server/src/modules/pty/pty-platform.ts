import { basename } from 'node:path'

/** Platform-aware default shell. */
export function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe'
  }
  return process.env.SHELL ?? '/bin/sh'
}

/** PATH delimiter: `;` on Windows, `:` elsewhere. */
export function getPathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':'
}

/** Extract the command name from an executable path, stripping Windows extensions. */
export function getExecutableCommand(executablePath: string): string {
  return basename(executablePath).replace(/\.(cmd|exe|ps1|bat)$/i, '')
}
