import fs from 'node:fs/promises'
import path from 'node:path'

import { fixMacOSFrameworkSymlinks } from './scripts/fix-macos-framework-symlinks.mjs'
import { copyCodexRuntimeToPackagedResources } from './scripts/sync-codex-runtime.mjs'

const updateServerUrl = process.env.CRADLE_DESKTOP_UPDATE_URL?.trim()
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
  if (url.endsWith('/manifest.json')) {
    return url.slice(0, -'manifest.json'.length)
  }
  if (url.endsWith('.json')) {
    return url.slice(0, url.lastIndexOf('/') + 1)
  }
  return url.endsWith('/') ? url : `${url}/`
}

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
  }
}

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
  appId: 'com.cradle.app',
  productName: 'Cradle',

  afterPack,

  asar: true,
  asarUnpack: [
    '**/*.node',
    '**/*.wasm',
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
    target: [
      'dir',
    ],
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
