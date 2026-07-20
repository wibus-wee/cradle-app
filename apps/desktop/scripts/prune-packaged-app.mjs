/**
 * Post-pack size pruning for Cradle desktop.
 * Removes Chromium locales/lproj bloat and optional heavy vendor binaries so
 * compressed DMG/ZIP can approach the product size budget.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Locales retained inside Electron Framework *.lproj / locales/*.pak */
export const KEEP_ELECTRON_LOCALES = new Set([
  'en',
  'en_GB',
  'en-GB',
  'en-US',
  'en_US',
  'es',
  'ja',
  'zh_CN',
  'zh-CN',
  'zh_TW',
  'zh-TW',
  'zh-Hans',
  'zh_Hans',
  'zh-Hant',
  'zh_Hant',
])

/**
 * When true (default), omit huge first-party agent binaries from the package.
 * Claude Agent SDK ships a ~230MB native CLI; Codex app-server is ~200MB.
 * Both compress poorly relative to the <100MB installer goal and should be
 * delivered on demand (Download Center) rather than baked into every DMG/ZIP.
 *
 * Opt back into full offline bundles with CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES=1.
 */
export function shouldBundleAgentBinaries() {
  const raw = process.env.CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES?.trim().toLowerCase()
  if (!raw) {
    // Slim by default: base installer must stay downloadable.
    return false
  }
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function isKeptLocale(localeName) {
  if (KEEP_ELECTRON_LOCALES.has(localeName)) {
    return true
  }
  // Gender/case variants (en_FEMININE.lproj) are never needed for Chromium chrome strings.
  const base = localeName.split('_')[0]?.split('-')[0]
  return base ? KEEP_ELECTRON_LOCALES.has(base) && !/[_-](FEMININE|MASCULINE|NEUTER)$/i.test(localeName) : false
}

export async function removeUnusedMacFrameworkLocales(context) {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) {
    return { removed: 0 }
  }

  const frameworkResources = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  )

  let entries
  try {
    entries = await fs.readdir(frameworkResources)
  }
  catch {
    return { removed: 0 }
  }

  let removed = 0
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.endsWith('.lproj')) {
        return
      }
      const locale = entry.slice(0, -'.lproj'.length)
      if (isKeptLocale(locale)) {
        return
      }
      await fs.rm(path.join(frameworkResources, entry), { recursive: true, force: true })
      removed += 1
    }),
  )

  if (removed > 0) {
    // Stale signature under the framework must be cleared so re-sign can succeed.
    const frameworkRoot = path.resolve(frameworkResources, '..', '..', '..')
    await fs.rm(path.join(frameworkRoot, '_CodeSignature'), { recursive: true, force: true }).catch(() => {})
  }

  return { removed }
}

/**
 * Strip Chromium locale packs on Windows/Linux (and macOS app Resources/locales if present).
 */
export async function removeUnusedChromiumLocalePaks(context) {
  const platform = context.electronPlatformName
  const candidates = []

  if (platform === 'darwin' || platform === 'mas') {
    const appRoot = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
    )
    candidates.push(path.join(appRoot, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'locales'))
    candidates.push(path.join(appRoot, 'Resources', 'locales'))
  }
  else {
    candidates.push(path.join(context.appOutDir, 'locales'))
    candidates.push(path.join(context.appOutDir, 'resources', 'locales'))
  }

  let removed = 0
  for (const localesDir of candidates) {
    let entries
    try {
      entries = await fs.readdir(localesDir)
    }
    catch {
      continue
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.endsWith('.pak')) {
          return
        }
        const locale = entry.slice(0, -'.pak'.length)
        if (isKeptLocale(locale)) {
          return
        }
        await fs.rm(path.join(localesDir, entry), { force: true })
        removed += 1
      }),
    )
  }

  return { removed }
}

/**
 * Optional Chromium media/GPU helpers that Cradle does not require for core UI.
 * ffmpeg is only needed for HTML5 media decode; swiftshader is a software Vulkan fallback.
 * Removing them saves ~10–20MB uncompressed; re-sign is required on macOS after.
 */
export async function removeOptionalChromiumLibraries(context) {
  const platform = context.electronPlatformName
  const removed = []

  const targets = []
  if (platform === 'darwin' || platform === 'mas') {
    const libraries = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Libraries',
    )
    targets.push(
      path.join(libraries, 'libffmpeg.dylib'),
      path.join(libraries, 'libvk_swiftshader.dylib'),
      path.join(libraries, 'vk_swiftshader_icd.json'),
    )
  }
  else if (platform === 'win32') {
    targets.push(
      path.join(context.appOutDir, 'ffmpeg.dll'),
      path.join(context.appOutDir, 'vk_swiftshader.dll'),
      path.join(context.appOutDir, 'vk_swiftshader_icd.json'),
      path.join(context.appOutDir, 'vulkan-1.dll'),
    )
  }
  else if (platform === 'linux') {
    targets.push(
      path.join(context.appOutDir, 'libffmpeg.so'),
      path.join(context.appOutDir, 'libvk_swiftshader.so'),
      path.join(context.appOutDir, 'vk_swiftshader_icd.json'),
    )
  }

  for (const target of targets) {
    try {
      await fs.rm(target, { force: true })
      removed.push(target)
    }
    catch {
      // absent is fine
    }
  }

  if (removed.length > 0 && (platform === 'darwin' || platform === 'mas')) {
    const frameworkRoot = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
    )
    await fs.rm(path.join(frameworkRoot, '_CodeSignature'), { recursive: true, force: true }).catch(() => {})
  }

  return { removed }
}

function packagedResourcesDir(context) {
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    )
  }
  return path.join(context.appOutDir, 'resources')
}

/**
 * Drop Claude Agent SDK platform packages (~230MB CLI) and any leftover Codex CLI
 * from the packaged server runtime when slim packaging is active.
 */
export async function removeUnbundledAgentBinaries(context) {
  if (shouldBundleAgentBinaries()) {
    return { removed: [] }
  }

  const resourcesDir = packagedResourcesDir(context)
  const removed = []
  const candidates = [
    // Codex app-server (afterPack may skip copy; also scrub any residual full CLI)
    path.join(resourcesDir, 'codex'),
    path.join(resourcesDir, 'codex.exe'),
    path.join(resourcesDir, 'codex-app-server'),
    path.join(resourcesDir, 'codex-app-server.exe'),
    // Claude Agent SDK optionalDependencies land under server/node_modules
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-x64'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-arm64'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-arm64'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64-musl'),
    path.join(resourcesDir, 'server', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-arm64-musl'),
  ]

  // Also scrub pnpm virtual store copies if present
  const serverNodeModules = path.join(resourcesDir, 'server', 'node_modules')
  try {
    const top = await fs.readdir(serverNodeModules)
    for (const entry of top) {
      if (entry.startsWith('claude-agent-sdk-') || entry.includes('claude-agent-sdk-')) {
        candidates.push(path.join(serverNodeModules, entry))
      }
    }
    const pnpmDir = path.join(serverNodeModules, '.pnpm')
    const pnpmEntries = await fs.readdir(pnpmDir).catch(() => [])
    for (const entry of pnpmEntries) {
      if (entry.includes('claude-agent-sdk-darwin')
        || entry.includes('claude-agent-sdk-win32')
        || entry.includes('claude-agent-sdk-linux')) {
        candidates.push(path.join(pnpmDir, entry))
      }
    }
  }
  catch {
    // server runtime may be missing in partial packs
  }

  for (const target of candidates) {
    try {
      await fs.rm(target, { recursive: true, force: true })
      removed.push(target)
    }
    catch {
      // ignore
    }
  }

  if (removed.length > 0) {
    console.warn(
      `[desktop] Slim package: removed ${removed.length} agent binary path(s). `
      + 'Set CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES=1 for offline Claude/Codex bundles.',
    )
  }

  return { removed }
}

export async function prunePackagedApp(context) {
  const lproj = await removeUnusedMacFrameworkLocales(context)
  const paks = await removeUnusedChromiumLocalePaks(context)
  const libs = await removeOptionalChromiumLibraries(context)
  const agents = await removeUnbundledAgentBinaries(context)

  console.warn(
    `[desktop] Size prune: lproj=${lproj.removed} pak=${paks.removed} `
    + `chromiumLibs=${libs.removed.length} agentPaths=${agents.removed.length}`,
  )

  return { lproj, paks, libs, agents }
}
