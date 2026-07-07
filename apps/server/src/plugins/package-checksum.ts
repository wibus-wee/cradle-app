import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { MARKETPLACE_INSTALL_RECEIPT_FILE } from './install-receipt'

interface PackageEntry {
  absolutePath: string
  kind: 'file' | 'symlink'
  relativePath: string
}

function toPackageRelativePath(packageDir: string, absolutePath: string): string {
  return relative(packageDir, absolutePath).split(sep).join('/')
}

async function collectPackageEntries(packageDir: string, currentDir = packageDir): Promise<PackageEntry[]> {
  const entries: PackageEntry[] = []
  const dirents = await readdir(currentDir, { withFileTypes: true })

  for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(currentDir, dirent.name)
    const relativePath = toPackageRelativePath(packageDir, absolutePath)
    if (relativePath === MARKETPLACE_INSTALL_RECEIPT_FILE) {
      continue
    }

    if (dirent.isDirectory()) {
      entries.push(...await collectPackageEntries(packageDir, absolutePath))
      continue
    }

    if (dirent.isFile()) {
      entries.push({ absolutePath, kind: 'file', relativePath })
      continue
    }

    if (dirent.isSymbolicLink()) {
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) {
        entries.push({ absolutePath, kind: 'symlink', relativePath })
      }
    }
  }

  return entries
}

export async function calculatePluginPackageChecksum(packageDir: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update('cradle-plugin-package-sha256-v1\0')

  const entries = await collectPackageEntries(packageDir)
  for (const entry of entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(entry.kind)
    hash.update('\0')
    hash.update(entry.relativePath)
    hash.update('\0')
    if (entry.kind === 'symlink') {
      hash.update(await readlink(entry.absolutePath))
      hash.update('\0')
      continue
    }

    const content = await readFile(entry.absolutePath)
    hash.update(String(content.byteLength))
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }

  return `sha256:${hash.digest('hex')}`
}
