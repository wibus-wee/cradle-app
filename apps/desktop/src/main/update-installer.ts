import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import type { DesktopUpdateBundleVerifier } from './update-bundle-verifier'
import {
  MacOSDesktopUpdateBundleVerifier,
} from './update-bundle-verifier'
import type {
  DesktopUpdateApplyResult,
  DesktopUpdateDownload,
  DesktopUpdateInstallerPlan,
} from './update-types'

const execFileAsync = promisify(execFile)
const UPDATE_RESULT_FILE = 'last-update-result.json'
const STAGING_CLEANUP_RETRY_COUNT = 5
const STAGING_CLEANUP_RETRY_DELAY_MS = 200

export type DesktopUpdateInstallerOptions = {
  updatesDir?: string
  bundleVerifier?: DesktopUpdateBundleVerifier
}

export class DesktopUpdateInstaller {
  private readonly updatesDir: string
  private readonly bundleVerifier: DesktopUpdateBundleVerifier

  constructor(options: DesktopUpdateInstallerOptions = {}) {
    this.updatesDir = options.updatesDir ?? join(app.getPath('userData'), 'updates')
    this.bundleVerifier = options.bundleVerifier ?? new MacOSDesktopUpdateBundleVerifier()
  }

  get resultPath(): string {
    return join(this.updatesDir, UPDATE_RESULT_FILE)
  }

  async readLastResult(): Promise<DesktopUpdateApplyResult | null> {
    try {
      return JSON.parse(await readFile(this.resultPath, 'utf8')) as DesktopUpdateApplyResult
    }
    catch {
      return null
    }
  }

  async prepare(download: DesktopUpdateDownload, version: string): Promise<DesktopUpdateInstallerPlan> {
    if (process.platform !== 'darwin') {
      throw new Error('Desktop self-updates are only supported on macOS')
    }

    const targetAppPath = readCurrentAppPath()
    const targetAppName = parse(targetAppPath).base
    const stagingRoot = await createStagingRoot(this.updatesDir, version)

    try {
      await extractArchive(download.archivePath, stagingRoot)

      const stagedAppPath = await readStagedAppPath(stagingRoot, targetAppName)
      const stagedVersion = await readBundleShortVersion(stagedAppPath)
      if (stagedVersion !== version) {
        throw new Error(`Update bundle version ${stagedVersion} does not match manifest version ${version}`)
      }
      await this.bundleVerifier.verify(stagedAppPath, targetAppPath)

      const targetParent = dirname(targetAppPath)
      const usesAdministratorPrivileges = !(await canWriteDirectory(targetParent))
      const scriptPath = join(this.updatesDir, `apply-${version}.sh`)
      await mkdir(this.updatesDir, { recursive: true })
      await writeFile(scriptPath, createApplyScript({
        archivePath: download.archivePath,
        resultPath: this.resultPath,
        stagedAppPath,
        stagingRoot,
        targetAppPath,
        usesAdministratorPrivileges,
        version,
        parentPid: process.pid,
      }), { mode: 0o700 })
      await chmod(scriptPath, 0o700)

      return {
        version,
        archivePath: download.archivePath,
        stagingRoot,
        stagedAppPath,
        targetAppPath,
        scriptPath,
        resultPath: this.resultPath,
        usesAdministratorPrivileges,
      }
    }
    catch (error) {
      await removeStagingRoot(stagingRoot)
      throw error
    }
  }

  launch(plan: DesktopUpdateInstallerPlan): void {
    const child = spawn('/bin/bash', [plan.scriptPath], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  }

  /** Removes update staging that is no longer actionable in this app session. */
  async discard(plan: DesktopUpdateInstallerPlan): Promise<void> {
    await Promise.all([
      removeStagingRoot(plan.stagingRoot),
      rm(plan.scriptPath, { force: true }),
    ])
  }

  /** Clears stale staging left by a previous desktop session. */
  async discardStaleStaging(): Promise<void> {
    await rm(join(this.updatesDir, 'staging'), { recursive: true, force: true })
  }
}

function readCurrentAppPath(): string {
  let currentPath = process.execPath

  for (;;) {
    if (currentPath.endsWith('.app')) {
      return currentPath
    }

    const parentPath = dirname(currentPath)
    if (parentPath === currentPath) {
      throw new Error(`Unable to resolve the current .app bundle from ${process.execPath}`)
    }
    currentPath = parentPath
  }
}

async function readStagedAppPath(stagingRoot: string, targetAppName: string): Promise<string> {
  const directPath = join(stagingRoot, targetAppName)
  if (await pathExists(directPath)) {
    return directPath
  }

  const entries = await readdir(stagingRoot, { withFileTypes: true })
  const appEntries = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
  if (appEntries.length === 1) {
    return join(stagingRoot, appEntries[0].name)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.app')) {
      continue
    }

    const nestedPath = join(stagingRoot, entry.name, targetAppName)
    if (await pathExists(nestedPath)) {
      return nestedPath
    }
  }

  throw new Error(`Update archive does not contain ${targetAppName}`)
}

async function readBundleShortVersion(appPath: string): Promise<string> {
  const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
  const { stdout } = await execFileAsync('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    infoPlistPath,
  ])
  return stdout.trim()
}

async function extractArchive(archivePath: string, targetDirectory: string): Promise<void> {
  await execFileAsync('/usr/bin/ditto', [
    '-x',
    '-k',
    archivePath,
    targetDirectory,
  ])
}

async function createStagingRoot(updatesDir: string, version: string): Promise<string> {
  const stagingParent = join(updatesDir, 'staging')
  await mkdir(stagingParent, { recursive: true })
  return await mkdtemp(join(stagingParent, `${version}-`))
}

async function removeStagingRoot(stagingRoot: string): Promise<void> {
  await rm(stagingRoot, {
    recursive: true,
    force: true,
    maxRetries: STAGING_CLEANUP_RETRY_COUNT,
    retryDelay: STAGING_CLEANUP_RETRY_DELAY_MS,
  })
}

async function canWriteDirectory(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath, constants.W_OK)
    return true
  }
  catch {
    return false
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

function createApplyScript(input: {
  archivePath: string
  resultPath: string
  stagedAppPath: string
  stagingRoot: string
  targetAppPath: string
  usesAdministratorPrivileges: boolean
  version: string
  parentPid: number
}): string {
  const backupAppPath = `${input.targetAppPath}.previous-update`
  const privilegedCommand = [
    'set -e',
    `/bin/rm -rf ${quoteForScript(backupAppPath)}`,
    `if [ -e ${quoteForScript(input.targetAppPath)} ]; then /bin/mv ${quoteForScript(input.targetAppPath)} ${quoteForScript(backupAppPath)}; fi`,
    `if ! /bin/mv ${quoteForScript(input.stagedAppPath)} ${quoteForScript(input.targetAppPath)}; then if [ -e ${quoteForScript(backupAppPath)} ]; then /bin/mv ${quoteForScript(backupAppPath)} ${quoteForScript(input.targetAppPath)}; fi; exit 1; fi`,
    `/usr/bin/xattr -dr com.apple.quarantine ${quoteForScript(input.targetAppPath)} >/dev/null 2>&1 || true`,
    `/bin/rm -rf ${quoteForScript(backupAppPath)}`,
  ].join('\n')

  return `#!/bin/bash
set -u

VERSION=${quoteForScript(input.version)}
PARENT_PID=${input.parentPid}
TARGET_APP=${quoteForScript(input.targetAppPath)}
STAGED_APP=${quoteForScript(input.stagedAppPath)}
STAGING_ROOT=${quoteForScript(input.stagingRoot)}
ARCHIVE_PATH=${quoteForScript(input.archivePath)}
RESULT_PATH=${quoteForScript(input.resultPath)}
BACKUP_APP=${quoteForScript(backupAppPath)}
USES_ADMIN=${input.usesAdministratorPrivileges ? 'true' : 'false'}
PRIVILEGED_COMMAND=${quoteForScript(privilegedCommand)}

json_escape() {
  /usr/bin/printf '%s' "$1" | /usr/bin/sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' | /usr/bin/tr '\\n' ' '
}

write_result() {
  local ok="$1"
  local message="$2"
  local escaped_version
  local escaped_message
  local finished_at
  escaped_version=$(json_escape "$VERSION")
  escaped_message=$(json_escape "$message")
  finished_at=$(/bin/date -u +"%Y-%m-%dT%H:%M:%SZ")
  if [ "$ok" = "true" ]; then
    /usr/bin/printf '{"ok":true,"version":"%s","error":null,"finishedAt":"%s"}\\n' "$escaped_version" "$finished_at" > "$RESULT_PATH"
  else
    /usr/bin/printf '{"ok":false,"version":"%s","error":"%s","finishedAt":"%s"}\\n' "$escaped_version" "$escaped_message" "$finished_at" > "$RESULT_PATH"
  fi
}

fail_update() {
  write_result false "$1"
  exit 1
}

wait_for_parent() {
  local remaining=120
  while /bin/kill -0 "$PARENT_PID" >/dev/null 2>&1; do
    if [ "$remaining" -le 0 ]; then
      fail_update "Timed out waiting for the app to exit"
    fi
    remaining=$((remaining - 1))
    /bin/sleep 1
  done
}

replace_without_privileges() {
  /bin/rm -rf "$BACKUP_APP" || fail_update "Could not remove previous update backup"
  if [ -e "$TARGET_APP" ]; then
    /bin/mv "$TARGET_APP" "$BACKUP_APP" || fail_update "Could not move the current app aside"
  fi
  if ! /bin/mv "$STAGED_APP" "$TARGET_APP"; then
    if [ -e "$BACKUP_APP" ]; then
      /bin/mv "$BACKUP_APP" "$TARGET_APP" >/dev/null 2>&1 || true
    fi
    fail_update "Could not move the updated app into place"
  fi
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true
  /bin/rm -rf "$BACKUP_APP" >/dev/null 2>&1 || true
}

replace_with_privileges() {
  /usr/bin/osascript \\
    -e 'on run argv' \\
    -e 'do shell script item 1 of argv with administrator privileges' \\
    -e 'end run' \\
    -- "$PRIVILEGED_COMMAND" || fail_update "Privileged replacement failed"
}

wait_for_parent

if [ "$USES_ADMIN" = "true" ]; then
  replace_with_privileges
else
  replace_without_privileges
fi

/usr/bin/open -n "$TARGET_APP" || fail_update "Updated app could not be reopened"
/bin/rm -rf "$STAGING_ROOT" "$ARCHIVE_PATH" >/dev/null 2>&1 || true
write_result true ""
exit 0
`
}

function quoteForScript(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}
