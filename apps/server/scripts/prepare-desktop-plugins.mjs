#!/usr/bin/env node
/**
 * Output: Creates apps/server/dist/desktop-plugins as the first-party plugin artifact consumed by Cradle desktop packaging.
 * Input: plugins/* package manifests and built plugin dist directories.
 * Position: Server-owned desktop plugin packaging boundary; desktop includes this artifact without enumerating plugin packages.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { init, parse } from 'es-module-lexer'

await init

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '../..')
const pluginsRoot = join(repoRoot, 'plugins')
const artifactDir = join(serverRoot, 'dist', 'desktop-plugins')
const tempRoot = join(repoRoot, 'tmp')
const desktopRuntimeExternalsPath = join(serverRoot, 'desktop-runtime.externals.json')
const desktopRuntimeExternals = JSON.parse(readFileSync(desktopRuntimeExternalsPath, 'utf8'))
const serverRuntimeExternalPackages = new Set(desktopRuntimeExternals.packages ?? [])
const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
])

rmSync(artifactDir, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })

const includedPlugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => preparePlugin(entry.name))
  .filter(plugin => plugin !== null)

writeFileSync(
  join(artifactDir, 'desktop-plugins.json'),
  `${JSON.stringify(
    {
      kind: 'cradle.desktop-plugins',
      plugins: includedPlugins,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`Prepared desktop plugins at ${relative(repoRoot, artifactDir)}`)

function preparePlugin(directoryName) {
  const packageDir = join(pluginsRoot, directoryName)
  const packageJsonPath = join(packageDir, 'package.json')
  const distDir = join(packageDir, 'dist')

  if (!existsSync(packageJsonPath)) {
    return null
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const cradle = packageJson.cradle
  if (!cradle || !isDesktopDeployment(cradle.deployments)) {
    return null
  }

  if (!existsSync(distDir)) {
    throw new Error(`Plugin ${packageJson.name ?? directoryName} has no dist directory. Run its build before preparing desktop plugins.`)
  }

  validateDeclaredEntry({
    packageDir,
    packageName: packageJson.name ?? directoryName,
    entryPath: cradle.server,
    label: 'server',
  })
  validateDeclaredEntry({
    packageDir,
    packageName: packageJson.name ?? directoryName,
    entryPath: cradle.web,
    label: 'web',
  })
  validateDeclaredEntry({
    packageDir,
    packageName: packageJson.name ?? directoryName,
    entryPath: cradle.desktop,
    label: 'desktop',
  })

  const pluginArtifactDir = join(artifactDir, directoryName)
  mkdirSync(pluginArtifactDir, { recursive: true })
  cpSync(packageJsonPath, join(pluginArtifactDir, 'package.json'))
  cpSync(distDir, join(pluginArtifactDir, 'dist'), { recursive: true })
  copyPackageRelativeAsset({
    packageDir,
    pluginArtifactDir,
    packageName: packageJson.name ?? directoryName,
    assetPath: cradle.icon,
    label: 'icon',
  })
  copyPluginRuntimeDependencies({
    packageDir,
    pluginArtifactDir,
    packageJson,
    cradle,
    packageName: packageJson.name ?? directoryName,
  })

  return {
    name: packageJson.name,
    version: packageJson.version ?? '0.0.0',
    directoryName,
  }
}

function isDesktopDeployment(deployments) {
  if (deployments === undefined) {
    return true
  }
  return Array.isArray(deployments) && deployments.includes('desktop')
}

function validateDeclaredEntry({ packageDir, packageName, entryPath, label }) {
  if (typeof entryPath !== 'string' || entryPath.trim() === '') {
    return
  }

  const normalizedEntryPath = entryPath.trim()
  if (isAbsolute(normalizedEntryPath)) {
    throw new Error(`Plugin ${packageName} ${label} entry must be package-relative: ${entryPath}`)
  }

  const sourcePath = resolve(packageDir, normalizedEntryPath)
  const packageRelativePath = relative(packageDir, sourcePath)
  if (
    packageRelativePath === ''
    || packageRelativePath === '..'
    || packageRelativePath.startsWith(`..${sep}`)
    || isAbsolute(packageRelativePath)
  ) {
    throw new Error(`Plugin ${packageName} ${label} entry escapes the package directory: ${entryPath}`)
  }

  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error(`Plugin ${packageName} declares missing ${label} entry: ${entryPath}`)
  }
}

function copyPackageRelativeAsset({ packageDir, pluginArtifactDir, packageName, assetPath, label }) {
  if (typeof assetPath !== 'string' || assetPath.trim() === '') {
    return
  }

  const normalizedAssetPath = assetPath.trim()
  if (isAbsolute(normalizedAssetPath)) {
    throw new Error(`Plugin ${packageName} ${label} path must be package-relative: ${assetPath}`)
  }

  const sourcePath = resolve(packageDir, normalizedAssetPath)
  const packageRelativePath = relative(packageDir, sourcePath)
  if (
    packageRelativePath === ''
    || packageRelativePath === '..'
    || packageRelativePath.startsWith(`..${sep}`)
    || isAbsolute(packageRelativePath)
  ) {
    throw new Error(`Plugin ${packageName} ${label} path escapes the package directory: ${assetPath}`)
  }

  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error(`Plugin ${packageName} ${label} asset is missing: ${assetPath}`)
  }

  const targetPath = join(pluginArtifactDir, packageRelativePath)
  mkdirSync(dirname(targetPath), { recursive: true })
  cpSync(sourcePath, targetPath)
}

function copyPluginRuntimeDependencies({ packageDir, pluginArtifactDir, packageJson, cradle, packageName }) {
  const productionDependencies = new Set(Object.keys(packageJson.dependencies ?? {}))
  if (productionDependencies.size === 0) {
    return
  }

  const runtimeEntries = [cradle.server, cradle.desktop]
    .filter(entryPath => typeof entryPath === 'string' && entryPath.trim() !== '')
    .map(entryPath => entryPath.trim())
  if (runtimeEntries.length === 0) {
    return
  }

  const runtimeImports = collectRuntimePackageImports(packageDir, runtimeEntries)
  const pluginLocalRuntimeDependencies = []
  for (const importedPackage of runtimeImports) {
    if (serverRuntimeExternalPackages.has(importedPackage)) {
      continue
    }
    if (productionDependencies.has(importedPackage)) {
      pluginLocalRuntimeDependencies.push(importedPackage)
      continue
    }
    throw new Error(
      `Plugin ${packageName} runtime entry imports ${importedPackage}, `
      + 'but that package is neither a production dependency nor a desktop server runtime external.',
    )
  }

  if (pluginLocalRuntimeDependencies.length === 0) {
    return
  }

  const deployDir = join(tempRoot, `desktop-plugin-${sanitizePackageName(packageName)}-${process.pid}`)
  rmSync(deployDir, { recursive: true, force: true })
  mkdirSync(tempRoot, { recursive: true })

  const result = spawnPnpmSync(
    [
      '--offline',
      '--config.inject-workspace-packages=true',
      '--filter',
      packageJson.name,
      'deploy',
      '--prod',
      deployDir,
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  )

  if (result.error) {
    rmSync(deployDir, { recursive: true, force: true })
    throw result.error
  }
  if (result.status !== 0) {
    rmSync(deployDir, { recursive: true, force: true })
    throw new Error(`Failed to deploy production dependencies for plugin ${packageName}.`)
  }

  const deployedNodeModules = join(deployDir, 'node_modules')
  if (!existsSync(deployedNodeModules)) {
    rmSync(deployDir, { recursive: true, force: true })
    throw new Error(`Plugin ${packageName} production dependency deploy did not create node_modules.`)
  }

  const targetNodeModules = join(pluginArtifactDir, 'node_modules')
  rmSync(targetNodeModules, { recursive: true, force: true })
  cpSync(deployedNodeModules, targetNodeModules, { recursive: true, verbatimSymlinks: true })
  removeUnusedTopLevelDependencies(targetNodeModules, new Set(pluginLocalRuntimeDependencies))
  rmSync(deployDir, { recursive: true, force: true })
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

function collectRuntimePackageImports(packageDir, entryPaths) {
  const visitedFiles = new Set()
  const importedPackages = new Set()

  for (const entryPath of entryPaths) {
    collectModuleImports(resolve(packageDir, entryPath), visitedFiles, importedPackages)
  }

  return importedPackages
}

function collectModuleImports(filePath, visitedFiles, importedPackages) {
  const absolutePath = resolve(filePath)
  if (visitedFiles.has(absolutePath)) {
    return
  }
  visitedFiles.add(absolutePath)

  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error(`Plugin runtime module is missing: ${absolutePath}`)
  }

  const source = readFileSync(absolutePath, 'utf8')
  const [imports] = parse(source)
  for (const importRecord of imports) {
    const specifier = importRecord.n
    if (!specifier) {
      continue
    }

    if (isRelativeSpecifier(specifier)) {
      const resolvedModule = resolveLocalModule(dirname(absolutePath), specifier)
      collectModuleImports(resolvedModule, visitedFiles, importedPackages)
      continue
    }

    if (isBuiltinSpecifier(specifier)) {
      continue
    }

    const packageSpecifier = packageNameFromSpecifier(specifier)
    if (packageSpecifier) {
      importedPackages.add(packageSpecifier)
    }
  }
}

function resolveLocalModule(fromDir, specifier) {
  const basePath = resolve(fromDir, specifier)
  for (const candidate of [
    basePath,
    `${basePath}.mjs`,
    `${basePath}.js`,
    join(basePath, 'index.mjs'),
    join(basePath, 'index.js'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }

  throw new Error(`Cannot resolve plugin runtime import ${specifier} from ${fromDir}`)
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function isBuiltinSpecifier(specifier) {
  return builtinSpecifiers.has(specifier)
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope && name ? `${scope}/${name}` : null
  }
  return specifier.split('/')[0] || null
}

function removeUnusedTopLevelDependencies(nodeModulesDir, retainedPackages) {
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = join(nodeModulesDir, entry.name)
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        const packageName = `${entry.name}/${scopedEntry.name}`
        if (!retainedPackages.has(packageName)) {
          rmSync(join(entryPath, scopedEntry.name), { recursive: true, force: true })
        }
      }
      if (readdirSync(entryPath).length === 0) {
        rmSync(entryPath, { recursive: true, force: true })
      }
      continue
    }

    if (!retainedPackages.has(entry.name)) {
      rmSync(entryPath, { recursive: true, force: true })
    }
  }
}

function sanitizePackageName(packageName) {
  return packageName.replace(/[^\w.-]+/g, '-')
}
