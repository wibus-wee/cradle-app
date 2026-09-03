import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const MAESTRO_VERSION = '2.9.0'
const MAESTRO_SHA256 = '855bb2ce1399d82f4f4a73d84a4d945f70b0d43eb86127e027af82809f63f0bd'
const MAESTRO_URL = `https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip`
const APP_ID = 'app.cradle.mobile'

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  quiet?: boolean
}

function commandError(command: string, args: string[], status: number | null, output: string): Error {
  return new Error(`${command} ${args.join(' ')} failed (${status ?? 'signal'}).${output ? `\n${output}` : ''}`)
}

function run(command: string, args: string[], options: CommandOptions = {}): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: options.quiet ? 64 * 1024 * 1024 : undefined,
    stdio: options.quiet ? 'pipe' : 'inherit',
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw commandError(command, args, result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`.trim())
  }
}

function capture(command: string, args: string[], options: CommandOptions = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw commandError(command, args, result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`.trim())
  }
  return result.stdout.trim()
}

function tryRun(command: string, args: string[], options: CommandOptions = {}): void {
  spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: 'ignore',
  })
}

function resolveJavaHome(): string {
  const configured = process.env.JAVA_HOME?.trim()
  if (configured && existsSync(join(configured, 'bin', 'java'))) {
    return configured
  }

  const homebrew = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
  if (existsSync(join(homebrew, 'bin', 'java'))) {
    return homebrew
  }

  return capture('/usr/libexec/java_home', ['-v', '17'])
}

function ensureMaestro(): string {
  const cacheDir = join(ROOT, 'node_modules', '.cache', 'maestro', MAESTRO_VERSION)
  const binary = join(cacheDir, 'maestro', 'bin', 'maestro')
  if (existsSync(binary)) {
    return binary
  }

  mkdirSync(cacheDir, { recursive: true })
  const archive = join(cacheDir, 'maestro.zip')
  run('curl', ['--fail', '--location', '--retry', '3', '--output', archive, MAESTRO_URL])
  const actualHash = capture('shasum', ['-a', '256', archive]).split(/\s+/u)[0]
  if (actualHash !== MAESTRO_SHA256) {
    unlinkSync(archive)
    throw new Error(`Maestro ${MAESTRO_VERSION} checksum mismatch: ${actualHash}`)
  }
  run('unzip', ['-q', '-o', archive, '-d', cacheDir])
  if (!existsSync(binary)) {
    throw new Error(`Maestro archive did not contain ${binary}.`)
  }
  return binary
}

interface SimulatorRuntime {
  identifier: string
  isAvailable: boolean
  name: string
  version: string
}

interface SimulatorDeviceType {
  identifier: string
  name: string
}

function versionParts(version: string): number[] {
  return version.split('.').map(part => Number.parseInt(part, 10) || 0)
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

function createSimulator(): string {
  const runtimeOutput = JSON.parse(capture('xcrun', ['simctl', 'list', 'runtimes', '--json'])) as {
    runtimes: SimulatorRuntime[]
  }
  const runtime = runtimeOutput.runtimes
    .filter(candidate => candidate.isAvailable && candidate.identifier.includes('.iOS-'))
    .sort((left, right) => compareVersions(right.version, left.version))[0]
  if (!runtime) {
    throw new Error('No available iOS Simulator runtime was found.')
  }

  const deviceOutput = JSON.parse(capture('xcrun', ['simctl', 'list', 'devicetypes', '--json'])) as {
    devicetypes: SimulatorDeviceType[]
  }
  const requestedType = process.env.CRADLE_E2E_IOS_DEVICE_TYPE?.trim()
  const deviceType = deviceOutput.devicetypes.find(candidate => candidate.identifier === requestedType || candidate.name === requestedType)
    ?? deviceOutput.devicetypes.find(candidate => candidate.name === 'iPhone 17 Pro')
    ?? [...deviceOutput.devicetypes].reverse().find(candidate => candidate.name.startsWith('iPhone') && candidate.name.includes('Pro'))
    ?? [...deviceOutput.devicetypes].reverse().find(candidate => candidate.name.startsWith('iPhone'))
  if (!deviceType) {
    throw new Error('No iPhone Simulator device type was found.')
  }

  return capture('xcrun', [
    'simctl',
    'create',
    `Cradle Mobile Fabric E2E ${process.pid}`,
    deviceType.identifier,
    runtime.identifier,
  ])
}

function main(): void {
  if (process.platform !== 'darwin') {
    throw new Error('The Mobile Fabric iOS E2E requires macOS and Xcode.')
  }

  const javaHome = resolveJavaHome()
  const maestroPath = ensureMaestro()
  const artifactsRoot = join(ROOT, 'e2e', 'artifacts', 'mobile-fabric')
  mkdirSync(artifactsRoot, { recursive: true })
  const runArtifacts = mkdtempSync(join(artifactsRoot, 'run-'))
  const derivedData = join(ROOT, 'node_modules', '.cache', 'cradle-mobile-fabric-ios', 'DerivedData')
  mkdirSync(derivedData, { recursive: true })
  const providedUdid = process.env.CRADLE_E2E_IOS_UDID?.trim()
  const providedAppPath = process.env.CRADLE_E2E_IOS_APP_PATH?.trim()
  const simulatorUdid = providedUdid || createSimulator()
  const ownsSimulator = !providedUdid
  const commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    MAESTRO_CLI_NO_ANALYTICS: '1',
  }

  try {
    if (providedUdid) {
      tryRun('xcrun', ['simctl', 'boot', simulatorUdid])
    }
    else {
      run('xcrun', ['simctl', 'boot', simulatorUdid])
    }
    run('xcrun', ['simctl', 'bootstatus', simulatorUdid, '-b'])

    if (!providedAppPath) {
      // Expo's dynamic podspec checksum changes with precompiled module availability.
      // A clean CI runner must install the locked versions without deployment checksum enforcement.
      run('pod', ['install'], {
        cwd: join(ROOT, 'apps', 'mobile', 'ios'),
        env: commandEnv,
      })

      run('xcodebuild', [
        '-quiet',
        '-workspace',
        'Cradle.xcworkspace',
        '-scheme',
        'Cradle',
        '-configuration',
        'Release',
        '-sdk',
        'iphonesimulator',
        '-destination',
        `id=${simulatorUdid}`,
        '-derivedDataPath',
        derivedData,
        '-resultBundlePath',
        join(runArtifacts, 'mobile-build.xcresult'),
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'ONLY_ACTIVE_ARCH=YES',
        `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
        'build',
      ], {
        cwd: join(ROOT, 'apps', 'mobile', 'ios'),
        env: commandEnv,
        quiet: true,
      })
    }

    const appPath = providedAppPath
      || join(derivedData, 'Build', 'Products', 'Release-iphonesimulator', 'Cradle.app')
    if (!existsSync(appPath)) {
      throw new Error(`The iOS build did not produce ${appPath}.`)
    }
    tryRun('xcrun', ['simctl', 'uninstall', simulatorUdid, APP_ID])
    run('xcrun', ['simctl', 'install', simulatorUdid, appPath])

    run(process.execPath, [
      '--import',
      'tsx',
      join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--config',
      join(ROOT, 'e2e', 'playwright.fabric.config.ts'),
      '--grep',
      'CRADLE-FABRIC-002',
    ], {
      cwd: ROOT,
      env: {
        ...commandEnv,
        CRADLE_E2E_IOS_UDID: simulatorUdid,
        CRADLE_E2E_MOBILE_ARTIFACTS_DIR: runArtifacts,
        CRADLE_E2E_MOBILE_IOS: '1',
        MAESTRO_CLI_PATH: maestroPath,
      },
    })
  }
  finally {
    if (ownsSimulator) {
      tryRun('xcrun', ['simctl', 'shutdown', simulatorUdid])
      tryRun('xcrun', ['simctl', 'delete', simulatorUdid])
    }
    else {
      tryRun('xcrun', ['simctl', 'terminate', simulatorUdid, APP_ID])
    }
  }
}

main()
