import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const chronicleRoot = resolve(repositoryRoot, 'chronicle')
const targetRoot = resolve(chronicleRoot, 'target')
const manifestPath = resolve(chronicleRoot, 'Cargo.toml')
const resourceRoot = resolve(desktopRoot, 'resources/chronicle')

if (process.platform !== 'darwin') {
  rmSync(resourceRoot, { recursive: true, force: true })
  mkdirSync(resourceRoot, { recursive: true })
  writeFileSync(
    resolve(resourceRoot, 'README.txt'),
    'Chronicle is currently built and bundled only for macOS.\n'
  )
  console.log('Skipping Chronicle build because this host is not macOS.')
  process.exit(0)
}

const cargoPath =
  [
    process.env.CARGO?.trim(),
    resolve(homedir(), '.cargo/bin/cargo'),
    '/opt/homebrew/opt/rustup/bin/cargo',
    '/opt/homebrew/bin/cargo'
  ].find((candidate) => candidate && existsSync(candidate)) ?? 'cargo'
const cargoDirectory = cargoPath === 'cargo' ? null : dirname(cargoPath)
const result = spawnSync(cargoPath, ['build', '--release', '--manifest-path', manifestPath], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    CARGO_TARGET_DIR: targetRoot,
    ...(cargoDirectory
      ? { PATH: [cargoDirectory, process.env.PATH].filter(Boolean).join(delimiter) }
      : {})
  },
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const builtBinary = resolve(targetRoot, 'release/cradle-chronicle')
if (!existsSync(builtBinary)) {
  throw new Error(`Cargo build finished but did not produce ${builtBinary}`)
}

const outputDir = resolve(resourceRoot, `${process.platform}-${process.arch}`)
const outputBinary = resolve(outputDir, 'cradle-chronicle')
const nextOutputBinary = `${outputBinary}.next`
mkdirSync(outputDir, { recursive: true })
copyFileSync(builtBinary, nextOutputBinary)
chmodSync(nextOutputBinary, 0o755)
renameSync(nextOutputBinary, outputBinary)
console.log(`Copied Chronicle binary to ${outputBinary}`)
