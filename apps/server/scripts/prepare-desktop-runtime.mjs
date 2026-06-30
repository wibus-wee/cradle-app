#!/usr/bin/env node
/**
 * Output: Creates apps/server/dist/desktop-runtime as the server-owned artifact consumed by Cradle desktop packaging.
 * Input: apps/server/dist from Vite, apps/server/package.json, and the workspace pnpm lockfile.
 * Position: Server runtime packaging boundary; desktop includes this artifact without installing or copying server internals.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '../..')
const distRoot = join(serverRoot, 'dist')
const runtimeDir = join(distRoot, 'desktop-runtime')
const tempDeployDir = join(repoRoot, 'tmp', `server-desktop-runtime-${process.pid}`)
const serverPackageJsonPath = join(serverRoot, 'package.json')
const serverPackageJson = JSON.parse(readFileSync(serverPackageJsonPath, 'utf8'))
const desktopRuntimeExternalsPath = join(serverRoot, 'desktop-runtime.externals.json')
const desktopRuntimeExternals = JSON.parse(readFileSync(desktopRuntimeExternalsPath, 'utf8'))
const externalRuntimePackages = desktopRuntimeExternals.packages ?? []
const runtimeEntry = 'dist/main.js'

if (!existsSync(join(distRoot, 'main.js'))) {
  throw new Error(`Server bundle not found at ${join(distRoot, 'main.js')}. Run pnpm --filter @cradle/server build first.`)
}

rmSync(join(distRoot, 'node_modules'), { recursive: true, force: true })
rmSync(join(distRoot, 'package.json'), { force: true })
rmSync(tempDeployDir, { recursive: true, force: true })
rmSync(runtimeDir, { recursive: true, force: true })
mkdirSync(dirname(tempDeployDir), { recursive: true })
mkdirSync(dirname(runtimeDir), { recursive: true })

const result = spawnPnpmSync(
  [
    '--config.inject-workspace-packages=true',
    '--config.node-linker=hoisted',
    '--filter',
    '@cradle/server',
    'deploy',
    '--prod',
    tempDeployDir,
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  rmSync(tempDeployDir, { recursive: true, force: true })
  process.exit(result.status ?? 1)
}

if (!existsSync(join(tempDeployDir, 'node_modules'))) {
  rmSync(tempDeployDir, { recursive: true, force: true })
  throw new Error(`pnpm deploy did not create ${join(tempDeployDir, 'node_modules')}`)
}

pruneExternalRuntimeDependencies()
pruneDeployMetadata()
writeFileSync(
  join(tempDeployDir, 'desktop-runtime.json'),
  `${JSON.stringify(
    {
      kind: 'cradle.desktop-server-runtime',
      package: serverPackageJson.name,
      version: serverPackageJson.version,
      entry: runtimeEntry,
      bundling: {
        externalPackages: externalRuntimePackages,
      },
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  'utf8',
)

renameSync(tempDeployDir, runtimeDir)
console.log(`Prepared desktop server runtime at ${relative(repoRoot, runtimeDir)}`)

function pruneDeployMetadata() {
  for (const entry of [
    'README.md',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'src',
  ]) {
    rmSync(join(tempDeployDir, entry), { recursive: true, force: true })
  }

  writeFileSync(
    join(tempDeployDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@cradle/server-desktop-runtime',
        private: true,
        type: 'module',
        version: serverPackageJson.version,
        main: runtimeEntry,
        dependencies: Object.fromEntries(
          externalRuntimePackages
            .map(packageName => [packageName, serverPackageJson.dependencies?.[packageName]])
            .filter((entry) => {
              const [, version] = entry
              return typeof version === 'string'
            }),
        ),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function pruneExternalRuntimeDependencies() {
  const nodeModulesDir = join(tempDeployDir, 'node_modules')
  if (!existsSync(nodeModulesDir)) {
    return
  }

  const reachablePackageRoots = new Set()
  const stack = []

  for (const packageName of externalRuntimePackages) {
    const packagePath = resolvePackageFrom(packageName, tempDeployDir, nodeModulesDir)
    if (!packagePath) {
      console.warn(`[desktop-runtime] External package ${packageName} was not deployed; skipping.`)
      continue
    }
    stack.push(packagePath)
  }

  while (stack.length > 0) {
    const packageRoot = realpathSync(stack.pop())
    if (!packageRoot || reachablePackageRoots.has(packageRoot)) {
      continue
    }
    reachablePackageRoots.add(packageRoot)

    const packageJson = readPackageJson(packageRoot)
    for (const dependencyName of listRuntimeDependencyNames(packageJson)) {
      const dependencyPath = resolvePackageFrom(dependencyName, packageRoot, nodeModulesDir)
      if (!dependencyPath) {
        if (packageJson.dependencies?.[dependencyName]) {
          throw new Error(
            `Runtime dependency ${dependencyName} declared by ${packageJson.name ?? packageRoot} `
            + `was not deployed under ${nodeModulesDir}.`,
          )
        }
        continue
      }
      stack.push(dependencyPath)
    }
  }

  assertInstallerSafePackageRoots(nodeModulesDir, reachablePackageRoots)
  pruneUnreachableTopLevelNodeModules(nodeModulesDir, reachablePackageRoots)
  prunePnpmVirtualStore(nodeModulesDir)
  pruneBinDirectories(nodeModulesDir)
}

function joinPackagePath(root, packageName) {
  const parts = packageName.split('/')
  return join(root, ...parts)
}

function readPackageJson(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
}

function listRuntimeDependencyNames(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ])
}

function resolvePackageFrom(packageName, startDir, nodeModulesDir) {
  let currentDir = resolve(startDir)
  const deployRoot = resolve(tempDeployDir)
  while (true) {
    const candidate = joinPackagePath(join(currentDir, 'node_modules'), packageName)
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate
    }
    if (currentDir === deployRoot || currentDir === dirname(currentDir)) {
      break
    }
    currentDir = dirname(currentDir)
  }

  const topLevelCandidate = joinPackagePath(nodeModulesDir, packageName)
  return existsSync(join(topLevelCandidate, 'package.json')) ? topLevelCandidate : null
}

function isPathInsideDirectory(parentDir, candidatePath) {
  const relativePath = relative(parentDir, candidatePath)
  return !isRelativePathOutsideDirectory(relativePath)
}

function isRelativePathOutsideDirectory(relativePath) {
  return !relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
}

function pruneUnreachableTopLevelNodeModules(nodeModulesDir, reachablePackageRoots) {
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name === '.pnpm' || entry.name === '.modules.yaml') {
      continue
    }

    const entryPath = join(nodeModulesDir, entry.name)
    if (entry.name === '.bin') {
      removePath(entryPath)
      continue
    }

    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        const scopedEntryPath = join(entryPath, scopedEntry.name)
        if (!isReachablePackagePath(scopedEntryPath, reachablePackageRoots)) {
          removePath(scopedEntryPath)
        }
      }
      if (readdirSync(entryPath).length === 0) {
        removePath(entryPath)
      }
      continue
    }

    if (!isReachablePackagePath(entryPath, reachablePackageRoots)) {
      removePath(entryPath)
    }
  }
}

function isReachablePackagePath(packagePath, reachablePackageRoots) {
  if (!existsSync(packagePath)) {
    return false
  }
  return reachablePackageRoots.has(realpathSync(packagePath))
}

function assertInstallerSafePackageRoots(nodeModulesDir, reachablePackageRoots) {
  const pnpmDir = join(nodeModulesDir, '.pnpm')
  if (!existsSync(pnpmDir)) {
    return
  }

  for (const packageRoot of reachablePackageRoots) {
    if (isPathInsideDirectory(pnpmDir, packageRoot)) {
      throw new Error(
        `Desktop runtime package ${packageRoot} still resolves through pnpm's virtual store. `
        + 'The packaged desktop runtime must use an installer-safe hoisted node_modules layout.',
      )
    }
  }
}

function prunePnpmVirtualStore(nodeModulesDir) {
  removePath(join(nodeModulesDir, '.pnpm'))
  removePath(join(nodeModulesDir, '.modules.yaml'))
}

function pruneBinDirectories(root) {
  if (!existsSync(root)) {
    return
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.bin') {
        removePath(entryPath)
        continue
      }
      pruneBinDirectories(entryPath)
    }
  }
}

function removePath(pathToRemove) {
  if (!existsSync(pathToRemove)) {
    return
  }
  const stat = lstatSync(pathToRemove)
  rmSync(pathToRemove, {
    recursive: stat.isDirectory() && !stat.isSymbolicLink(),
    force: true,
  })
}

function spawnPnpmSync(args, options) {
  if (process.platform !== 'win32') {
    return spawnSync('pnpm', args, options)
  }

  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], options)
  }

  return spawnSync('pnpm', args, { ...options, shell: true })
}
