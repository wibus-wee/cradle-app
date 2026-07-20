import { createRequire } from 'node:module'
import path from 'node:path'

import { fixMacOSFrameworkSymlinks } from './scripts/fix-macos-framework-symlinks.mjs'
import {
  prunePackagedApp,
  shouldBundleAgentBinaries,
} from './scripts/prune-packaged-app.mjs'
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
  if (url.endsWith('/manifest.json')) {
    return url.slice(0, -'manifest.json'.length)
  }
  if (url.endsWith('.xml') || url.endsWith('.json') || url.endsWith('.yml') || url.endsWith('.yaml')) {
    return url.slice(0, url.lastIndexOf('/') + 1)
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
  if (url.endsWith('/manifest.json')) {
    return `${url.slice(0, -'manifest.json'.length)}appcast.xml`
  }
  if (url.endsWith('.json') || url.endsWith('.yml') || url.endsWith('.yaml')) {
    return `${url.slice(0, url.lastIndexOf('/') + 1)}appcast.xml`
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
  // Codex app-server alone is ~200MB; only embed when offline agent bundles are requested.
  if (shouldBundleAgentBinaries()) {
    await copyCodexRuntimeToPackagedResources(context)
  }
  else {
    console.warn(
      '[desktop] Skipping bundled Codex runtime (slim package). '
      + 'Set CRADLE_DESKTOP_BUNDLE_AGENT_BINARIES=1 to embed it.',
    )
  }

  // Locale/pak/ffmpeg/agent-binary strip before any re-sign.
  await prunePackagedApp(context)

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
  // Keep only Chromium chrome locales that match product languages. electron-builder
  // strips locales/*.pak on supported targets; afterPack also hard-prunes leftovers.
  electronLanguages: ['en-US', 'en-GB', 'es', 'ja', 'zh-CN', 'zh-TW'],
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
    '!node_modules/electron-sparkle-updater/**/*.{md,ts,map}',
    '!node_modules/electron-sparkle-updater/**/{test,tests,__tests__,docs}/**',
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
    // UDZO is the strongest widely-compatible hdiutil format electron-builder
    // supports natively. Installer build-dmg.mjs further converts to ULMO (LZMA).
    format: 'UDZO',
  },

  // Note: electron-builder 26.x has no top-level `zip` schema key (validation fails).
  // ZIP compression follows global `compression: 'maximum'`. Installer DMG uses ULMO.

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
