import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function readPlistString(xml: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<key>\\s*${escapedKey}\\s*</key>\\s*<string>([^<]+)</string>`).exec(xml)
  return match?.[1]?.trim()
}

async function readBundleIconNames(infoPlistPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      infoPlistPath,
    ])
    const info: Record<string, unknown> = JSON.parse(stdout)
    return [info.CFBundleIconFile, info.CFBundleIconName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim())
  }
  catch {
    const xml = await readFile(infoPlistPath, 'utf8').catch(() => '')
    return ['CFBundleIconFile', 'CFBundleIconName']
      .map(key => readPlistString(xml, key))
      .filter((value): value is string => Boolean(value))
  }
}

async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath).then(value => value.isFile()).catch(() => false)
}

function iconCandidates(resourcesPath: string, iconName: string): string[] {
  if (extname(iconName)) {
    return [join(resourcesPath, iconName)]
  }
  return ['.icns', '.png', '.svg'].map(extension => join(resourcesPath, `${iconName}${extension}`))
}

/** Resolves the actual icon asset inside a macOS application bundle. */
export async function resolveMacApplicationIconPath(applicationPath: string): Promise<string | undefined> {
  const contentsPath = join(applicationPath, 'Contents')
  const resourcesPath = join(contentsPath, 'Resources')
  const iconNames = await readBundleIconNames(join(contentsPath, 'Info.plist'))

  for (const candidate of iconNames.flatMap(iconName => iconCandidates(resourcesPath, iconName))) {
    if (await isFile(candidate)) {
      return candidate
    }
  }

  const entries = await readdir(resourcesPath).catch(() => [])
  const fallback = entries.find(entry => /\.(?:icns|png|svg)$/i.test(entry))
  return fallback ? join(resourcesPath, fallback) : undefined
}
