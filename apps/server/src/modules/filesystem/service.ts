import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

export interface DirectoryEntry {
  name: string
  path: string
  type: 'directory' | 'file'
  size: number | null
  modifiedAt: number | null
}

export interface BrowseResult {
  current: string
  parent: string | null
  entries: DirectoryEntry[]
}

export async function browse(requestedPath?: string): Promise<BrowseResult> {
  let raw = requestedPath?.trim() || homedir()
  // Expand ~ to home directory
  if (raw === '~' || raw.startsWith('~/')) {
    raw = homedir() + raw.slice(1)
  }
  const target = resolve(raw)

  const realStat = await stat(target)
  if (!realStat.isDirectory()) {
    throw new Error(`Not a directory: ${target}`)
  }

  const dirents = await readdir(target, { withFileTypes: true })

  const entries: DirectoryEntry[] = []
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) {
      continue
    }
    const fullPath = join(target, dirent.name)
    const isDir = dirent.isDirectory()
    let size: number | null = null
    let modifiedAt: number | null = null
    try {
      const s = await stat(fullPath)
      size = isDir ? null : s.size
      modifiedAt = Math.floor(s.mtimeMs / 1000)
    }
    catch {
      // inaccessible entries are still listed with null metadata
    }
    entries.push({
      name: dirent.name,
      path: fullPath,
      type: isDir ? 'directory' : 'file',
      size,
      modifiedAt,
    })
  }

  // directories first, then files; alphabetical within each group
  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  const segments = target.split(sep)
  const parent = segments.length > 1 ? resolve(target, '..') : null

  return { current: target, parent, entries }
}

export interface FavoriteEntry {
  name: string
  path: string
  icon: string
}

export function favorites(): FavoriteEntry[] {
  const home = homedir()
  const candidates: FavoriteEntry[] = [
    { name: 'Home', path: home, icon: 'home' },
    { name: 'Desktop', path: join(home, 'Desktop'), icon: 'monitor' },
    { name: 'Documents', path: join(home, 'Documents'), icon: 'file-text' },
    { name: 'Downloads', path: join(home, 'Downloads'), icon: 'download' },
    { name: 'dev', path: join(home, 'dev'), icon: 'code' },
    { name: 'Projects', path: join(home, 'Projects'), icon: 'code' },
    { name: 'workspace', path: join(home, 'workspace'), icon: 'code' },
    { name: 'src', path: join(home, 'src'), icon: 'code' },
  ]
  // Only return directories that actually exist
  return candidates.filter(c => existsSync(c.path))
}
