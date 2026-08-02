import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { box, intro, log, outro, spinner } from '@clack/prompts'
import { parseCradlePluginPackageJsonText } from '@cradle/plugin-sdk/manifest'
import type { Command } from 'commander'
import pc from 'picocolors'
import type { InlineConfig, Plugin, Rollup } from 'vite'
import { z } from 'zod'

import { getCommandContext } from '../runtime/context'
import {
  formatDurationMs,
  formatLayerLabel,
  formatTimestamp,
  printPluginDevBanner,
  renderSessionSummary,
} from './plugin-dev-ui'

const layerNames = ['server', 'web', 'desktop'] as const
type PluginLayer = typeof layerNames[number]

const PluginDevSessionSchema = z.object({
  id: z.string().min(1),
  pluginName: z.string().min(1),
  displayName: z.string().min(1),
  revisions: z.object({
    server: z.number().int().nonnegative(),
    web: z.number().int().nonnegative(),
    desktop: z.number().int().nonnegative(),
  }),
})

interface LayerBuild {
  layer: PluginLayer
  outputEntry: string
  sourceEntry: string
}

interface LayerWatcher {
  build: LayerBuild
  close: () => Promise<void>
  initialBuild: Promise<void>
}

interface PluginDevOptions {
  packageDir?: string
}

function findChild(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name)
}

function readChild(parent: Command, name: string, description: string): Command {
  return findChild(parent, name) ?? parent.command(name).description(description)
}

function isBareImport(id: string): boolean {
  return !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')
}

function injectWebCss(): Plugin {
  return {
    name: 'cradle-plugin-dev-inject-css',
    generateBundle(_options, bundle) {
      const cssAssets = Object.values(bundle).filter(
        (output): output is Rollup.OutputAsset => output.type === 'asset' && output.fileName.endsWith('.css'),
      )
      if (cssAssets.length === 0) { return }
      const css = cssAssets.map(asset => String(asset.source)).join('\n')
      const injection = [
        `const __cradleStyle = document.createElement('style');`,
        `__cradleStyle.dataset.cradlePluginDevStyle = import.meta.url;`,
        `__cradleStyle.textContent = ${JSON.stringify(css)};`,
        `document.head.appendChild(__cradleStyle);`,
        `export const __cradleDevDispose = () => __cradleStyle.remove();`,
      ].join('\n')
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) {
          output.code = `${injection}\n${output.code}`
        }
      }
      for (const asset of cssAssets) {
        delete bundle[asset.fileName]
      }
    },
  }
}

function createBuildConfig(packageDir: string, layerBuild: LayerBuild): InlineConfig {
  const outputDir = resolve(packageDir, '.cradle/dev')
  const common = {
    configFile: false as const,
    root: packageDir,
    logLevel: 'silent' as const,
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: outputDir,
      sourcemap: true,
      target: 'es2022' as const,
      watch: {},
    },
  }

  if (layerBuild.layer === 'web') {
    return {
      ...common,
      plugins: [injectWebCss()],
      build: {
        ...common.build,
        lib: {
          entry: resolve(packageDir, layerBuild.sourceEntry),
          formats: ['es'],
        },
        rollupOptions: {
          external: [
            'react',
            'react-dom',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            'react-dom/client',
          ],
          output: {
            entryFileNames: `${layerBuild.layer}.mjs`,
          },
        },
      },
    }
  }

  return {
    ...common,
    build: {
      ...common.build,
      ssr: resolve(packageDir, layerBuild.sourceEntry),
      rollupOptions: {
        external: (id: string) => isBareImport(id),
        output: {
          entryFileNames: `${layerBuild.layer}.mjs`,
        },
      },
      target: 'node22',
    },
  }
}

async function startLayerWatcher(
  viteBuild: typeof import('vite').build,
  packageDir: string,
  layerBuild: LayerBuild,
  onRebuild: (build: LayerBuild, durationMs: number) => Promise<void>,
): Promise<LayerWatcher> {
  const result = await viteBuild(createBuildConfig(packageDir, layerBuild))
  if (!('on' in result)) {
    throw new Error(`Vite did not create a watcher for the ${layerBuild.layer} layer.`)
  }
  const watcher = result as Rollup.RollupWatcher
  let initialComplete = false
  let resolveInitial!: () => void
  let rejectInitial!: (error: Error) => void
  const initialBuild = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveInitial = resolvePromise
    rejectInitial = rejectPromise
  })

  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') {
      const durationMs = event.duration
      void event.result.close()
      if (!initialComplete) {
        initialComplete = true
        resolveInitial()
        return
      }
      void onRebuild(layerBuild, durationMs)
      return
    }
    if (event.code === 'ERROR') {
      const error = event.error instanceof Error ? event.error : new Error(String(event.error))
      if (!initialComplete) {
        initialComplete = true
        rejectInitial(new Error(`${layerBuild.layer} build failed: ${error.message}`))
        return
      }
      log.error(`${formatLayerLabel(layerBuild.layer)} build failed: ${error.message}`)
    }
  })

  return {
    build: layerBuild,
    close: () => watcher.close(),
    initialBuild,
  }
}

function createLayerBuilds(dev: {
  server?: string
  web?: string
  desktop?: string
}): LayerBuild[] {
  return layerNames.flatMap((layer) => {
    const sourceEntry = dev[layer]
    return sourceEntry
      ? [{ layer, sourceEntry, outputEntry: `.cradle/dev/${layer}.mjs` }]
      : []
  })
}

async function runPluginDev(command: Command, options: PluginDevOptions): Promise<void> {
  const packageDir = resolve(options.packageDir ?? process.cwd())
  const parsed = parseCradlePluginPackageJsonText(await readFile(resolve(packageDir, 'package.json'), 'utf8'))
  const builds = createLayerBuilds(parsed.cradle.dev ?? {})
  if (builds.length === 0) {
    throw new Error('Plugin package must declare at least one explicit cradle.dev entry.')
  }
  const { build: viteBuild } = await import('vite')

  const context = getCommandContext(command)
  let session: z.infer<typeof PluginDevSessionSchema> | null = null
  let reloadQueue = Promise.resolve()
  const onRebuild = async (layerBuild: LayerBuild, durationMs: number): Promise<void> => {
    if (!session) { return }
    reloadQueue = reloadQueue.then(async () => {
      const result = await context.request({
        method: 'post',
        path: { id: session!.id },
        query: {},
        body: { layer: layerBuild.layer },
        template: '/plugins/dev-sessions/{id}/reload',
      })
      session = PluginDevSessionSchema.parse(result)
      log.step(`${pc.dim(`[${formatTimestamp()}]`)} ${formatLayerLabel(layerBuild.layer)} rebuilt in ${pc.yellow(formatDurationMs(durationMs))} · revision ${pc.bold(String(session.revisions[layerBuild.layer]))}`)
    }).catch((error: unknown) => {
      log.error(`${formatLayerLabel(layerBuild.layer)} reload failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    await reloadQueue
  }

  printPluginDevBanner()
  intro(`${parsed.cradle.displayName ?? parsed.name} ${pc.dim(`v${parsed.version}`)}`)
  const watchers: LayerWatcher[] = []
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let resolveSignal!: () => void
  const stopped = new Promise<void>(resolvePromise => { resolveSignal = resolvePromise })
  const stop = (): void => resolveSignal()

  const startup = spinner()
  const startedAt = performance.now()
  try {
    try {
      startup.start(`Building ${builds.map(item => formatLayerLabel(item.layer)).join(', ')}`)
      for (const layerBuild of builds) {
        watchers.push(await startLayerWatcher(viteBuild, packageDir, layerBuild, onRebuild))
      }
      await Promise.all(watchers.map(watcher => watcher.initialBuild))
      startup.message(`Connecting to Cradle at ${context.serverUrl}`)
      session = PluginDevSessionSchema.parse(await context.request({
        method: 'post',
        path: {},
        query: {},
        body: {
          packageDir,
          entries: Object.fromEntries(builds.map(item => [item.layer, item.outputEntry])),
        },
        template: '/plugins/dev-sessions',
      }))
      startup.stop(`${pc.bold(pc.green('Ready'))} in ${pc.yellow(formatDurationMs(performance.now() - startedAt))}`)
      box(
        renderSessionSummary({
          serverUrl: context.serverUrl,
          layers: builds.map(item => ({ layer: item.layer, revision: session!.revisions[item.layer] })),
          outputDir: relative(process.cwd(), resolve(packageDir, '.cradle/dev')),
        }),
        'Dev session',
        { width: 'auto', formatBorder: pc.dim },
      )
    }
    catch (error) {
      startup.error('Startup failed')
      throw error
    }
    log.info('Watching for changes. Press Ctrl+C to stop.')

    heartbeat = setInterval(() => {
      if (!session) { return }
      void context.request({
        method: 'post',
        path: { id: session.id },
        query: {},
        template: '/plugins/dev-sessions/{id}/heartbeat',
      }).catch((error: unknown) => {
        log.warn(`heartbeat failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 10_000)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    await stopped
  }
  finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    if (heartbeat) { clearInterval(heartbeat) }
    await Promise.allSettled(watchers.map(watcher => watcher.close()))
    await reloadQueue
    if (session) {
      await context.request({
        method: 'delete',
        path: { id: session.id },
        query: {},
        template: '/plugins/dev-sessions/{id}',
      }).catch(() => undefined)
      outro(`Deactivated ${pc.bold(session.pluginName)}`)
    }
  }
}

export function registerPluginDevCommand(root: Command): void {
  const plugin = readChild(root, 'plugin', 'Manage plugins')
  plugin
    .command('dev')
    .description('Build and temporarily load a plugin in the running Cradle Desktop app')
    .option('--package-dir <path>', 'Plugin package directory. Defaults to the current directory')
    .action(async (options: PluginDevOptions, command: Command) => {
      try {
        await runPluginDev(command, options)
      }
      catch (error: unknown) {
        log.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      }
    })
}

export const pluginDevInternals = {
  createBuildConfig,
  createLayerBuilds,
}
