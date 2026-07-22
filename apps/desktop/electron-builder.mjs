import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { fixMacOSFrameworkSymlinks } from './scripts/fix-macos-framework-symlinks.mjs'
import { copyCodexRuntimeToPackagedResources } from './scripts/sync-codex-runtime.mjs'

const require = createRequire(import.meta.url)

const updateServerUrl = process.env.CRADLE_DESKTOP_UPDATE_URL?.trim()
const sparkleAppcastUrl = resolveSparkleAppcastUrlForBuild(
  process.env.CRADLE_DESKTOP_SPARKLE_APPCAST_URL?.trim() || updateServerUrl || '',
)
const sparklePublicEdKey = process.env.SPARKLE_ED_PUBLIC_KEY?.trim() || undefined
const hasAppleSigningIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)

if (!hasAppleSigningIdentity) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

const keepElectronFrameworkLocales = new Set([
  'en',
  'en_GB',
  'en-US',
  'en_US',
  'es',
  'ja',
  'zh_CN',
  'zh_TW',
])

function getPublishConfig() {
  if (!updateServerUrl) {
    return undefined
  }

  return [
    {
      provider: 'generic',
      url: resolveElectronUpdaterFeedUrl(updateServerUrl),
    },
  ]
}

function resolveElectronUpdaterFeedUrl(url) {
  if (url.endsWith('/appcast.xml')) {
    return url.slice(0, -'appcast.xml'.length)
  }
  return url.endsWith('/') ? url : `${url}/`
}

function resolveSparkleAppcastUrlForBuild(url) {
  if (!url) {
    return 'https://github.com/wibus-wee/cradle-app/releases/latest/download/appcast.xml'
  }
  if (url.endsWith('.xml')) {
    return url
  }
  return url.endsWith('/') ? `${url}appcast.xml` : `${url}/appcast.xml`
}

function loadSparkleBuilderFragments() {
  try {
    // Prefer the published package helper when available.
    const { sparkleBuilderConfig } = require('electron-sparkle-updater/builder')
    return sparkleBuilderConfig({
      feedUrl: sparkleAppcastUrl,
      publicEdKey: sparklePublicEdKey,
      scheduledCheckIntervalSeconds: 5 * 60,
    })
  }
  catch (error) {
    console.warn(`[desktop] electron-sparkle-updater/builder unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return {
      extraFiles: [],
      files: [],
      asarUnpack: [],
      dmg: { writeUpdateInfo: false },
      zip: { writeUpdateInfo: false },
      mac: {
        extendInfo: {
          SUFeedURL: sparkleAppcastUrl,
          ...(sparklePublicEdKey ? { SUPublicEDKey: sparklePublicEdKey } : {}),
          SUEnableInstallerLauncherService: false,
          SUScheduledCheckInterval: 5 * 60,
        },
      },
    }
  }
}

const sparkle = loadSparkleBuilderFragments()

async function removeUnusedMacFrameworkLocales(context) {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) {
    return
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
    return
  }

  let removed = false
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.endsWith('.lproj')) {
        return
      }

      const locale = entry.slice(0, -'.lproj'.length)
      if (keepElectronFrameworkLocales.has(locale)) {
        return
      }

      await fs.rm(path.join(frameworkResources, entry), { recursive: true, force: true })
      removed = true
    }),
  )

  if (removed) {
    // Remove stale code signature so electron-builder regenerates it during re-signing.
    // _CodeSignature lives at Electron Framework.framework/_CodeSignature (3 levels above Resources).
    const frameworkRoot = path.resolve(frameworkResources, '..', '..', '..')
    await fs.rm(path.join(frameworkRoot, '_CodeSignature'), { recursive: true, force: true }).catch(() => {})
  }
}

async function adHocSignAfterPack(context) {
  try {
    const builder = await import('electron-sparkle-updater/builder')
    await builder.adHocSignAfterPack(context)
  }
  catch {
    // Fallback for environments where the package is not resolvable as ESM.
    const { adHocSignAfterPack: adHocSign } = require('electron-sparkle-updater/builder')
    await adHocSign(context)
  }
}

async function afterPack(context) {
  await copyCodexRuntimeToPackagedResources(context)
  await removeUnusedMacFrameworkLocales(context)
  if (['darwin', 'mas'].includes(context.electronPlatformName)) {
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
    )
    const result = fixMacOSFrameworkSymlinks(appPath)
    if (result.absoluteSymlinks.length > 0) {
      const details = result.absoluteSymlinks
        .map(symlink => `${symlink.linkPath} -> ${symlink.target}`)
        .join('\n')
      throw new Error(`Unfixed absolute macOS framework symlink(s):\n${details}`)
    }
    if (result.rewritten > 0) {
      console.warn(`[desktop] Rewrote ${result.rewritten} macOS framework symlink(s).`)
    }

    // Load-bearing for Sparkle: generate_appcast requires codesign --verify --deep --strict.
    // Ad-hoc re-sign covers unsigned Developer ID-less builds.
    await adHocSignAfterPack(context)
  }
}

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
  appId: 'com.cradle.app',
  productName: 'Cradle',
  executableName: 'Cradle',

  afterPack,

  asar: true,
  asarUnpack: [
    '**/*.node',
    '**/*.wasm',
    ...(Array.isArray(sparkle.asarUnpack) ? sparkle.asarUnpack : [sparkle.asarUnpack].filter(Boolean)),
  ],

  compression: 'maximum',
  detectUpdateChannel: true,
  generateUpdatesFilesForAllChannels: true,
  npmRebuild: false,
  publish: getPublishConfig(),

  directories: {
    buildResources: '../../resources',
    output: 'release',
  },

  files: [
    'dist/main/**/*',
    'dist/preload/**/*',
    'dist/renderer/**/*',
    '!node_modules',
    // Sparkle bridge must ship as a real node_modules package so the packaged
    // loader can require native/build/Release/sparkle_bridge.node from asar.unpacked.
    'node_modules/electron-sparkle-updater/**/*',
    '!node_modules/electron-sparkle-updater/node_modules',
    ...(Array.isArray(sparkle.files) ? sparkle.files : []),
  ],

  extraFiles: [
    ...(Array.isArray(sparkle.extraFiles) ? sparkle.extraFiles : []),
  ],

  extraResources: [
    {
      from: '../server/dist/desktop-runtime',
      to: 'server',
      filter: [
        '**/*',
        '!node_modules/**',
      ],
    },
    {
      from: '../server/dist/desktop-runtime/node_modules',
      to: 'server/node_modules',
      filter: ['**/*'],
    },
    {
      from: '../../packages/cli/dist',
      to: 'cli',
      filter: ['**/*'],
    },
    {
      from: 'resources/bin',
      to: 'bin',
      filter: ['**/*'],
    },
    {
      from: 'resources/relayd',
      to: 'relayd',
      filter: ['**/*'],
    },
    {
      from: '../../packages/db/drizzle',
      to: 'drizzle',
      filter: [
        '**/*',
        '!meta/*_snapshot.json',
        '!README.md',
      ],
    },
    {
      from: '../../resources/skills',
      to: 'resources/skills',
      filter: ['**/*'],
    },
    {
      from: '../server/dist/desktop-plugins',
      to: 'server/plugins',
      filter: ['**/*'],
    },
    {
      from: 'native/macos/mac-bridge/.build/cradle-dist',
      to: 'mac-bridge',
      filter: ['**/*'],
    },
  ],

  mac: {
    category: 'public.app-category.developer-tools',
    compression: 'maximum',
    entitlements: '../../build/entitlements.mac.plist',
    entitlementsInherit: '../../build/entitlements.mac.plist',
    gatekeeperAssess: false,
    hardenedRuntime: hasAppleSigningIdentity,
    ...(hasAppleSigningIdentity ? {} : { identity: null }),
    extendInfo: {
      ...(sparkle.mac?.extendInfo ?? {}),
    },
    target: [
      'dir',
    ],
  },

  dmg: {
    ...(sparkle.dmg ?? {}),
  },

  win: {
    target: [
      'nsis',
      'zip',
    ],
    artifactName: ['$', '{productName}-', '$', '{os}-', '$', '{arch}.', '$', '{ext}'].join(''),
  },

  linux: {
    target: [
      'AppImage',
      'deb',
    ],
    category: 'Development',
    artifactName: ['$', '{productName}-', '$', '{os}-', '$', '{arch}.', '$', '{ext}'].join(''),
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: ['$', '{productName}-setup.', '$', '{ext}'].join(''),
    include: 'build/installer.nsh',
  },
}

export default config
