#!/usr/bin/env node
// Verifies local macOS signing and notarization credentials before preview distribution packaging.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')

function printHelp() {
  console.log(`Usage: pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- [options]

Options:
  --mac-app-sign <identity>       Expected Developer ID Application identity. Defaults to CSC_NAME or auto-discovery.
  --mac-installer-sign <identity> Expected Developer ID Installer identity. Defaults to CRADLE_MAC_INSTALLER_SIGN_IDENTITY or auto-discovery.
  --mac-notary-profile <profile>  notarytool keychain profile used by desktop release packaging. Defaults to APPLE_KEYCHAIN_PROFILE.
  --check-app-signing             Check Developer ID Application and Electron Builder signing credentials.
  --check-installer-signing       Check Developer ID Installer credentials.
  --check-notary-profile          Check notarytool keychain profile access.
  --check-stapler                 Check stapler tool availability.
  --skip-notary-auth-check        Only check that a notary profile name was provided; do not call notarytool history.
  --help                          Show this help text.

This preflight is intentionally local and read-only. It does not import
certificates, modify keychains, sign artifacts, notarize artifacts, install
packages, or touch /Applications. It fails before build/package work when the
machine cannot produce Developer ID signed and notarized macOS preview
artifacts.`)
}

function readOption(name, fallback = null) {
  const prefix = `--${name}=`
  for (let index = 0; index < process.argv.length; index++) {
    const value = process.argv[index]
    if (value === `--${name}`) {
      return process.argv[index + 1] ?? fallback
    }
    if (value?.startsWith(prefix)) {
      return value.slice(prefix.length)
    }
  }
  return fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    error: result.error?.message ?? null,
  }
}

function summarizeOutput(output) {
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.slice(0, 8).join('\n')
}

async function readBuilderConfig() {
  const configUrl = pathToFileURL(resolve(desktopRoot, 'electron-builder.mjs'))
  configUrl.search = `t=${Date.now()}`
  const configModule = await import(configUrl.href)
  return configModule.default ?? {}
}

function readMacIdentityConfig(config) {
  return config.mac?.identity ?? null
}

function parseCodesigningIdentities(output) {
  return output
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"$/)
      if (!match) {
        return null
      }
      return { hash: match[1], name: match[2] }
    })
    .filter(Boolean)
}

function findIdentity(identities, expected, certificatePrefix) {
  const typed = identities.filter(identity => identity.name.startsWith(`${certificatePrefix}:`))
  if (!expected) {
    return typed[0] ?? null
  }
  return typed.find(identity => identity.hash === expected || identity.name === expected)
    ?? typed.find(identity => identity.name.includes(expected))
    ?? null
}

function checkCommand(command, args, label) {
  const result = run(command, args)
  if (result.status !== 0) {
    return {
      name: `${label} is available`,
      pass: false,
      detail: result.error ?? summarizeOutput(result.output) ?? `${command} exited with ${result.status}`,
    }
  }
  return {
    name: `${label} is available`,
    pass: true,
    detail: summarizeOutput(result.output) || [command, ...args].join(' '),
  }
}

function checkXcrunTool(toolName, label) {
  const result = run('xcrun', ['--find', toolName])
  if (result.status !== 0) {
    return {
      name: `${label} is available`,
      pass: false,
      detail: result.error ?? summarizeOutput(result.output) ?? `xcrun could not find ${toolName}`,
    }
  }
  return {
    name: `${label} is available`,
    pass: true,
    detail: summarizeOutput(result.output) || toolName,
  }
}

function checkDarwinHost() {
  return {
    name: 'macOS host is available',
    pass: process.platform === 'darwin',
    detail: process.platform === 'darwin'
      ? 'darwin'
      : `Current platform is ${process.platform}; macOS Developer ID distribution must run on macOS.`,
  }
}

function checkDeveloperIdentity({ identities, expected, certificatePrefix, label, allowDeferredImport = false }) {
  const match = findIdentity(identities, expected, certificatePrefix)
  if (!match) {
    const available = identities
      .filter(identity => identity.name.startsWith(`${certificatePrefix}:`))
      .map(identity => identity.name)
    if (allowDeferredImport) {
      return {
        name: `${label} identity is available`,
        pass: true,
        detail: 'CSC_LINK and CSC_KEY_PASSWORD are set. electron-builder can import the certificate during packaging.',
      }
    }
    return {
      name: `${label} identity is available`,
      pass: false,
      detail: [
        expected ? `Expected identity: ${expected}` : `No ${certificatePrefix} identity was auto-discovered.`,
        available.length > 0 ? `Available ${certificatePrefix} identities: ${available.join('; ')}` : `Available ${certificatePrefix} identities: none`,
      ].join('\n'),
    }
  }
  return {
    name: `${label} identity is available`,
    pass: true,
    detail: `${match.name} (${match.hash})`,
  }
}

function checkElectronBuilderSigning({ appIdentity, builderIdentity, identities }) {
  if (builderIdentity === '-') {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: false,
      detail: 'electron-builder.mjs sets mac.identity to "-", which produces an ad-hoc signature.',
    }
  }
  if (builderIdentity === 'null') {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: false,
      detail: 'electron-builder.mjs sets mac.identity to null, which skips app signing.',
    }
  }

  const cscName = process.env.CSC_NAME ?? null
  const cscLink = process.env.CSC_LINK ?? null
  const cscPassword = process.env.CSC_KEY_PASSWORD ?? null
  const discoveredDeveloperId = findIdentity(identities, appIdentity ?? cscName ?? builderIdentity, 'Developer ID Application')

  if (cscLink && !cscPassword) {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: false,
      detail: 'CSC_LINK is set but CSC_KEY_PASSWORD is missing.',
    }
  }

  if (cscName && !cscName.startsWith('Developer ID Application:')) {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: false,
      detail: `CSC_NAME is not a Developer ID Application identity: ${cscName}`,
    }
  }

  if (builderIdentity && !builderIdentity.startsWith('Developer ID Application:')) {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: false,
      detail: `electron-builder.mjs mac.identity is not a Developer ID Application identity: ${builderIdentity}`,
    }
  }

  if (discoveredDeveloperId) {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: true,
      detail: `Keychain identity available for electron-builder: ${discoveredDeveloperId.name}`,
    }
  }

  if (cscLink && cscPassword) {
    return {
      name: 'Electron Builder mac signing configuration can produce Developer ID app',
      pass: true,
      detail: 'CSC_LINK and CSC_KEY_PASSWORD are set. electron-builder can import the certificate during packaging.',
    }
  }

  return {
    name: 'Electron Builder mac signing configuration can produce Developer ID app',
    pass: false,
    detail: [
      'No Developer ID Application identity was found for Electron Builder.',
      'Set CSC_NAME to a keychain identity, provide CSC_LINK with CSC_KEY_PASSWORD, or import a Developer ID Application certificate into the keychain.',
    ].join('\n'),
  }
}

function checkNotaryProfile({ profile, skipAuthCheck }) {
  if (!profile) {
    return {
      name: 'notarytool keychain profile is usable',
      pass: false,
      detail: 'Pass --mac-notary-profile <profile> or set APPLE_KEYCHAIN_PROFILE before enabling notarized desktop distribution.',
    }
  }
  if (skipAuthCheck) {
    return {
      name: 'notarytool keychain profile is named',
      pass: true,
      detail: profile,
    }
  }

  const result = run('xcrun', ['notarytool', 'history', '--keychain-profile', profile])
  if (result.status !== 0) {
    return {
      name: 'notarytool keychain profile is usable',
      pass: false,
      detail: summarizeOutput(result.output) || `notarytool history failed for profile ${profile}`,
    }
  }
  return {
    name: 'notarytool keychain profile is usable',
    pass: true,
    detail: summarizeOutput(result.output) || profile,
  }
}

async function main() {
  if (hasFlag('help')) {
    printHelp()
    return
  }

  const builderConfig = await readBuilderConfig()
  const builderIdentity = readMacIdentityConfig(builderConfig)
  const appId = builderConfig.appId ?? 'com.cradle.app'
  const productName = builderConfig.productName ?? 'Cradle'
  const appIdentity = readOption('mac-app-sign', process.env.CSC_NAME ?? builderIdentity)
  const installerIdentity = readOption('mac-installer-sign', process.env.CRADLE_MAC_INSTALLER_SIGN_IDENTITY ?? null)
  const notaryProfile = readOption('mac-notary-profile', process.env.APPLE_KEYCHAIN_PROFILE ?? null)
  const skipNotaryAuthCheck = hasFlag('skip-notary-auth-check')
  const explicitCheckScope = hasFlag('check-app-signing')
    || hasFlag('check-installer-signing')
    || hasFlag('check-notary-profile')
    || hasFlag('check-stapler')
  const shouldCheckAppSigning = !explicitCheckScope || hasFlag('check-app-signing')
  const shouldCheckInstallerSigning = !explicitCheckScope || hasFlag('check-installer-signing')
  const shouldCheckNotaryProfile = !explicitCheckScope || hasFlag('check-notary-profile')
  const shouldCheckStapler = !explicitCheckScope || hasFlag('check-stapler')
  const hasElectronBuilderCertificateLink = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD)
  const canDeferAppIdentityImport = hasElectronBuilderCertificateLink
    && (!appIdentity || appIdentity === process.env.CSC_NAME)

  const identityResult = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  const identities = identityResult.status === 0 ? parseCodesigningIdentities(identityResult.output) : []

  const checks = [
    checkDarwinHost(),
    shouldCheckAppSigning || shouldCheckInstallerSigning
      ? checkCommand('security', ['find-identity', '-v', '-p', 'codesigning'], 'security codesigning identity lookup')
      : null,
    shouldCheckAppSigning ? checkXcrunTool('codesign', 'codesign') : null,
    shouldCheckInstallerSigning ? checkXcrunTool('productsign', 'productsign') : null,
    shouldCheckInstallerSigning ? checkXcrunTool('pkgutil', 'pkgutil') : null,
    shouldCheckNotaryProfile ? checkCommand('xcrun', ['--find', 'notarytool'], 'notarytool') : null,
    shouldCheckStapler ? checkCommand('xcrun', ['--find', 'stapler'], 'stapler') : null,
    shouldCheckAppSigning
? checkDeveloperIdentity({
      identities,
      expected: appIdentity,
      certificatePrefix: 'Developer ID Application',
      label: 'Developer ID Application',
      allowDeferredImport: canDeferAppIdentityImport,
    })
: null,
    shouldCheckInstallerSigning
? checkDeveloperIdentity({
      identities,
      expected: installerIdentity,
      certificatePrefix: 'Developer ID Installer',
      label: 'Developer ID Installer',
    })
: null,
    shouldCheckAppSigning ? checkElectronBuilderSigning({ appIdentity, builderIdentity, identities }) : null,
    shouldCheckNotaryProfile ? checkNotaryProfile({ profile: notaryProfile, skipAuthCheck: skipNotaryAuthCheck }) : null,
  ].filter(Boolean)

  const failed = checks.filter(check => !check.pass)
  console.log(JSON.stringify({
    appId,
    productName,
    inputs: {
      macAppSign: appIdentity,
      macInstallerSign: installerIdentity,
      macNotaryProfile: notaryProfile,
      electronBuilderMacIdentity: builderIdentity,
      cscName: process.env.CSC_NAME ?? null,
      cscLinkPresent: Boolean(process.env.CSC_LINK),
      cscKeyPasswordPresent: Boolean(process.env.CSC_KEY_PASSWORD),
      checkAppSigning: shouldCheckAppSigning,
      checkInstallerSigning: shouldCheckInstallerSigning,
      checkNotaryProfile: shouldCheckNotaryProfile,
      checkStapler: shouldCheckStapler,
      skipNotaryAuthCheck,
    },
    identities: identities.map(identity => identity.name),
    checks,
  }, null, 2))

  if (failed.length > 0) {
    console.error(`macOS distribution credential preflight failed: ${failed.length}/${checks.length} checks failed.`)
    process.exitCode = 1
    return
  }

  console.log('macOS distribution credential preflight passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
