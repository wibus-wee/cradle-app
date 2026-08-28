import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { log, spinner } from '@clack/prompts'
import { parseCradlePluginPackageJsonText } from '@cradle/plugin-sdk/manifest'
import type { Command } from 'commander'
import pc from 'picocolors'
import { z } from 'zod'

import { getCommandContext } from '../runtime/context'
import { CliHttpError } from '../runtime/http-client'

interface PluginInstallOptions {
  packageDir?: string
  label?: string
  addedReason?: string
}

interface PluginUpdateOptions {
  packageDir?: string
}

const PersonalPluginResultSchema = z.object({
  source: z.object({
    id: z.string().min(1),
  }),
  discoveredPlugins: z.array(z.object({
    routeSegment: z.string().min(1),
    displayName: z.string().min(1),
    hasServer: z.boolean(),
    hasWeb: z.boolean(),
    hasDesktop: z.boolean(),
    layers: z.object({
      server: z.object({ status: z.string(), error: z.string().nullable() }),
      web: z.object({ status: z.string(), error: z.string().nullable() }),
      desktop: z.object({ status: z.string(), error: z.string().nullable() }),
    }),
  })),
  operation: z.object({
    action: z.enum(['install', 'update', 'refresh']),
    status: z.literal('success'),
    error: z.null(),
    reviewRequired: z.boolean(),
    reviewPath: z.string().nullable(),
    previousSnapshotPreserved: z.boolean(),
  }),
})

function findChild(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name)
}

function readChild(parent: Command, name: string, description: string): Command {
  return findChild(parent, name) ?? parent.command(name).description(description)
}

async function runPackageBuild(packageDir: string): Promise<void> {
  const rawPackageJson = await readFile(resolve(packageDir, 'package.json'), 'utf8')
  const packageJson: { scripts?: { build?: string } } = JSON.parse(rawPackageJson)
  parseCradlePluginPackageJsonText(rawPackageJson)
  if (!packageJson.scripts?.build?.trim()) {
    throw new Error('Plugin package must declare a build script before it can be installed.')
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['--prefix', packageDir, 'run', 'build'], {
      stdio: 'inherit',
      shell: false,
    })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(signal
        ? `Plugin build stopped by ${signal}.`
        : `Plugin build exited with code ${code ?? 'unknown'}.`))
    })
  })
}

async function warnForMissingReadme(packageDir: string): Promise<void> {
  try {
    await access(resolve(packageDir, 'README.md'))
  }
  catch {
    log.warn('Plugin package has no README.md. Document its purpose, capabilities, permissions, configuration, build, and verification.')
  }
}

function printResult(action: 'Installed' | 'Updated', value: unknown): void {
  const result = PersonalPluginResultSchema.parse(value)
  const firstPlugin = result.discoveredPlugins[0]
  log.success(`${action} ${pc.bold(firstPlugin?.displayName ?? 'personal plugin')} as an immutable Cradle snapshot.`)
  log.info(`Source ID: ${pc.bold(result.source.id)}`)
  for (const plugin of result.discoveredPlugins) {
    const runtimeStates = [
      plugin.hasServer ? `server=${plugin.layers.server.status}` : null,
      plugin.hasWeb ? `web=${plugin.layers.web.status}` : null,
      plugin.hasDesktop ? `desktop=${plugin.layers.desktop.status}` : null,
    ].filter((state): state is string => state !== null)
    log.info(`${pc.bold(plugin.displayName)}: ${runtimeStates.join(', ') || 'no runtime layers'}`)
    for (const layer of ['server', 'web', 'desktop'] as const) {
      const error = plugin.layers[layer].error
      if (error) {
        log.warn(`${plugin.displayName} ${layer}: ${error}`)
      }
    }
  }
  if (result.operation.reviewRequired) {
    log.info(process.env.CRADLE_CHAT_SESSION_ID
      ? 'Review and activation are waiting in the originating Cradle chat.'
      : `Activation requires user review in Cradle Plugin Center. Source: ${pc.cyan(result.source.id)}`)
  }
}

async function buildAndInstall(command: Command, options: PluginInstallOptions): Promise<void> {
  const packageDir = resolve(options.packageDir ?? process.cwd())
  await warnForMissingReadme(packageDir)
  await runPackageBuild(packageDir)
  const progress = spinner()
  progress.start('Validating and installing the built plugin snapshot')
  try {
    const result = await getCommandContext(command).request({
      method: 'post',
      path: {},
      query: {},
      body: {
        packageDir,
        label: options.label,
        addedReason: options.addedReason,
      },
      template: '/plugins/personal',
    })
    progress.stop('Plugin snapshot installed')
    printResult('Installed', result)
  }
  catch (error) {
    progress.error('Plugin installation failed')
    throw error
  }
}

async function buildAndUpdate(command: Command, sourceId: string, options: PluginUpdateOptions): Promise<void> {
  const packageDir = resolve(options.packageDir ?? process.cwd())
  await warnForMissingReadme(packageDir)
  await runPackageBuild(packageDir)
  const progress = spinner()
  progress.start('Validating and publishing the updated plugin snapshot')
  try {
    const result = await getCommandContext(command).request({
      method: 'post',
      path: { sourceId },
      query: {},
      body: { packageDir },
      template: '/plugins/personal/{sourceId}',
    })
    progress.stop('Plugin snapshot updated')
    printResult('Updated', result)
  }
  catch (error) {
    const previousSnapshotPreserved = error instanceof CliHttpError
      && error.details?.previousSnapshotPreserved === true
    progress.error(previousSnapshotPreserved
      ? 'Plugin update failed; the previous snapshot remains installed'
      : 'Plugin update failed')
    throw error
  }
}

function reportCommandError(error: unknown): void {
  log.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

export function registerPluginInstallCommands(root: Command): void {
  const plugin = readChild(root, 'plugin', 'Manage plugins')
  plugin
    .command('install')
    .description('Build and install a personal plugin as an immutable snapshot')
    .option('--package-dir <path>', 'Plugin package directory. Defaults to the current directory')
    .option('--label <label>', 'Label for the retained personal source')
    .option('--added-reason <reason>', 'Reason recorded with the personal source')
    .action(async (options: PluginInstallOptions, command: Command) => {
      await buildAndInstall(command, options).catch(reportCommandError)
    })

  plugin
    .command('update')
    .description('Build and atomically replace an installed personal plugin snapshot')
    .argument('<source-id>', 'Personal plugin source ID returned during installation')
    .option('--package-dir <path>', 'Plugin package directory. Defaults to the current directory')
    .action(async (sourceId: string, options: PluginUpdateOptions, command: Command) => {
      await buildAndUpdate(command, sourceId, options).catch(reportCommandError)
    })
}

export const pluginInstallInternals = {
  runPackageBuild,
  warnForMissingReadme,
}
