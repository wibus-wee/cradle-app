import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, readlink, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import type { DesktopCliCommandPlatform, DesktopCliStatus } from './desktop-cli-manager'
import { readUnsupportedDesktopCliStatus } from './desktop-cli-manager'

const runFile = promisify(execFile)
const MAC_COMMAND_PATH = '/usr/local/bin/cradle'

function readPackagedCliSourcePath(): string {
  return join(process.resourcesPath, 'bin', 'cradle')
}

function readCliSourcePath(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  if (!app.isPackaged) {
    return null
  }
  return readPackagedCliSourcePath()
}

async function readCommandLinkTarget(commandPath: string): Promise<string | null> {
  try {
    const stats = await lstat(commandPath)
    if (!stats.isSymbolicLink()) {
      return null
    }
    return await readlink(commandPath)
  }
  catch {
    return null
  }
}

async function readCommandPathConflict(commandPath: string): Promise<string | null> {
  try {
    const stats = await lstat(commandPath)
    return stats.isSymbolicLink() ? null : `${commandPath} already exists and is not a symlink.`
  }
  catch {
    return null
  }
}

async function runMacPrivilegedScript(script: string): Promise<void> {
  await runFile('/usr/bin/osascript', [
    '-e',
    `do shell script ${JSON.stringify(script)} with administrator privileges`,
  ])
}

async function removeExistingCommandLink(commandPath: string): Promise<void> {
  try {
    const stats = await lstat(commandPath)
    if (!stats.isSymbolicLink()) {
      throw new Error(`${commandPath} already exists and is not a symlink.`)
    }
    await unlink(commandPath)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function removeExistingCommandLinkWithPrivilege(commandPath: string): Promise<void> {
  const quotedCommandPath = quoteForMacScript(commandPath)
  await runMacPrivilegedScript(
    `if [ ! -e ${quotedCommandPath} ] || [ -L ${quotedCommandPath} ]; then rm -f ${quotedCommandPath}; else exit 73; fi`,
  )
}

async function createCommandLink(sourcePath: string): Promise<void> {
  try {
    await removeExistingCommandLink(MAC_COMMAND_PATH)
  }
  catch (error) {
    if (error instanceof Error && error.message.includes('is not a symlink')) {
      throw error
    }
    await removeExistingCommandLinkWithPrivilege(MAC_COMMAND_PATH)
  }

  try {
    await symlink(sourcePath, MAC_COMMAND_PATH)
  }
  catch {
    const quotedCommandPath = quoteForMacScript(MAC_COMMAND_PATH)
    const script = [
      `if [ ! -e ${quotedCommandPath} ] || [ -L ${quotedCommandPath} ]; then rm -f ${quotedCommandPath}; else exit 73; fi`,
      `ln -s ${quoteForMacScript(sourcePath)} ${quoteForMacScript(MAC_COMMAND_PATH)}`,
    ].join(' && ')
    await runMacPrivilegedScript(script)
  }
}

function quoteForMacScript(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

export const macDesktopCliCommand: DesktopCliCommandPlatform = {
  commandPath: MAC_COMMAND_PATH,
  async readStatus(): Promise<DesktopCliStatus> {
    const sourcePath = readCliSourcePath()
    if (!sourcePath) {
      return readUnsupportedDesktopCliStatus(
        MAC_COMMAND_PATH,
        'CLI PATH installation is available in packaged macOS builds.',
      )
    }

    let sourceError: string | null = null
    try {
      await access(sourcePath, constants.X_OK)
    }
    catch (error) {
      sourceError = error instanceof Error ? error.message : String(error)
    }

    const linkTarget = await readCommandLinkTarget(MAC_COMMAND_PATH)
    const commandConflict = await readCommandPathConflict(MAC_COMMAND_PATH)
    const linked = linkTarget === sourcePath
    return {
      supported: true,
      installed: linked,
      linked,
      requiresRepair: Boolean(sourceError || commandConflict || (linkTarget && linkTarget !== sourcePath)),
      commandPath: MAC_COMMAND_PATH,
      sourcePath,
      errorMessage: sourceError ?? commandConflict,
    }
  },
  async install(): Promise<DesktopCliStatus> {
    const status = await this.readStatus()
    if (!status.supported || !status.sourcePath) {
      return status
    }

    try {
      await createCommandLink(status.sourcePath)
    }
    catch (error) {
      return {
        ...await this.readStatus(),
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
    return this.readStatus()
  },
  async remove(): Promise<DesktopCliStatus> {
    const status = await this.readStatus()
    if (!status.supported || !status.sourcePath) {
      return status
    }

    const linkTarget = await readCommandLinkTarget(MAC_COMMAND_PATH)
    if (linkTarget !== status.sourcePath) {
      return status
    }

    try {
      await unlink(MAC_COMMAND_PATH)
    }
    catch (error) {
      try {
        await runMacPrivilegedScript(`rm -f ${quoteForMacScript(MAC_COMMAND_PATH)}`)
      }
      catch {
        return {
          ...await this.readStatus(),
          errorMessage: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return this.readStatus()
  },
}
