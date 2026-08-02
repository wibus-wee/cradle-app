import type { Workspace } from './types'

const SAFE_ENTRY_NAME_RE = /^[\w.-]+$/

/**
 * Symlink entry name for a registered member workspace inside a multi-folder root.
 * Prefers the workspace display name (spaces → dashes), then identifier, then path basename.
 */
export function multiFolderEntryName(
  workspace: Pick<Workspace, 'id' | 'name' | 'identifier' | 'locator'>,
): string {
  const fromName = workspace.name.trim().replace(/\s+/g, '-')
  if (isSafeEntryName(fromName)) {
    return fromName
  }

  const fromIdentifier = workspace.identifier.trim().toLowerCase()
  if (isSafeEntryName(fromIdentifier)) {
    return fromIdentifier
  }

  const fromPath = pathBasename(workspace.locator.path).replace(/[^\w.-]+/g, '-')
  if (isSafeEntryName(fromPath)) {
    return fromPath
  }

  return workspace.id.slice(0, 8)
}

function pathBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts.at(-1) ?? trimmed
}

function isSafeEntryName(name: string): boolean {
  return name.length > 0
    && name !== '.'
    && name !== '..'
    && SAFE_ENTRY_NAME_RE.test(name)
}
