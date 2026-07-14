import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { EditorDefinition, EditorId } from './editor-catalog'
import { EDITORS, findEditor } from './editor-catalog'

// macOS .app bundle search locations (in priority order).
function macAppSearchPaths(appName: string): string[] {
  const app = `${appName}.app`
  return [
    join(homedir(), 'Applications', app),
    join(homedir(), 'Applications', 'JetBrains Toolbox', app),
    `/Applications/JetBrains Toolbox/${app}`,
    `/Applications/${app}`,
    `/Applications/Utilities/${app}`,
    `/System/Applications/${app}`,
  ]
}

function macAppExists(appName: string): boolean {
  return macAppSearchPaths(appName).some(path => existsSync(path))
}

// Resolves whether a CLI command is on PATH. Uses `which` on macOS/Linux and
// `where` on Windows. Returns false on any error (command not found).
function isCommandAvailable(command: string, platform: NodeJS.Platform): Promise<boolean> {
  return new Promise((resolve) => {
    const bin = platform === 'win32' ? 'where' : 'which'
    execFile(bin, [command], { windowsHide: true }, error => resolve(!error))
  })
}

export interface DetectedEditor {
  id: EditorId
  label: string
  /** Absolute path to the macOS app bundle when one was found. */
  applicationPath?: string
}

// Detects which editors from the catalog are installed on this machine.
// `file-manager` and `system-default` are always available (OS-provided).
// An editor is available if any of its CLI commands is on PATH OR (on macOS) any
// of its .app bundles exists in a standard location.
export async function readAvailableEditors(platform: NodeJS.Platform = process.platform): Promise<DetectedEditor[]> {
  const result: DetectedEditor[] = []
  for (const editor of EDITORS) {
    if (editor.id === 'file-manager' || editor.id === 'system-default') {
      result.push({ id: editor.id, label: editor.label })
      continue
    }
    const cliAvailable = editor.commands
      ? await Promise.all(editor.commands.map(cmd => isCommandAvailable(cmd, platform))).then(flags => flags.some(Boolean))
      : false
    const applicationPath = platform === 'darwin'
      ? editor.macApplications?.map(findMacApplicationPath).find((path): path is string => Boolean(path))
      : undefined
    const macAppAvailable = Boolean(applicationPath)
    if (cliAvailable || macAppAvailable) {
      result.push({ id: editor.id, label: editor.label, applicationPath })
    }
  }
  return result
}

function findMacApplicationPath(appName: string): string | undefined {
  return macAppSearchPaths(appName).find(existsSync)
}

function run(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

// For terminal-style editors, open the containing directory rather than a file.
function resolveTargetDirectory(targetPath: string): string {
  return targetPath
}

// Launches a specific editor definition for the given path. Returns true on
// success. Tries macOS `open -a` when an app bundle exists, else the CLI.
async function launchEditor(editor: EditorDefinition, targetPath: string, platform: NodeJS.Platform): Promise<boolean> {
  // Terminal-style editors always resolve to a directory.
  const target = editor.launchStyle === 'terminal-working-directory' ? resolveTargetDirectory(targetPath) : targetPath

  if (platform === 'darwin' && editor.macApplications?.some(macAppExists)) {
    const appName = editor.macApplications.find(macAppExists)!
    try {
      await run('/usr/bin/open', ['-a', appName, target])
      return true
    }
    catch {
      // fall through to CLI
    }
  }

  if (editor.commands) {
    for (const cmd of editor.commands) {
      if (await isCommandAvailable(cmd, platform)) {
        try {
          await run(cmd, [target])
          return true
        }
        catch {
          continue
        }
      }
    }
  }

  // Last resort on macOS: `open -a` with the first declared app name even if the
  // bundle wasn't found in standard locations (it may live elsewhere).
  if (platform === 'darwin' && editor.macApplications?.length) {
    try {
      await run('/usr/bin/open', ['-a', editor.macApplications[0]!, target])
      return true
    }
    catch {
      return false
    }
  }

  return false
}

// Opens `targetPath` in the preferred editor. When `editorId` is omitted, tries
// available editors in catalog order (legacy auto-detect behavior). Returns the
// label of the editor that opened the path. Throws if none could.
export async function launchPathInEditor(targetPath: string, editorId?: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  // Explicit preferred editor: try it first, then fall back to auto-detect.
  if (editorId) {
    const editor = findEditor(editorId)
    if (editor && await launchEditor(editor, targetPath, platform)) {
      return editor.label
    }
  }

  const errors: string[] = []
  for (const editor of EDITORS) {
    if (editor.id === editorId) {
      continue
    }
    if (editor.id === 'system-default') {
      // system-default is a last resort; handled below.
      continue
    }
    if (await launchEditor(editor, targetPath, platform)) {
      return editor.label
    }
    errors.push(editor.label)
  }

  throw new Error(`No supported editor could open ${targetPath}. Tried ${errors.join(', ')}.`)
}
