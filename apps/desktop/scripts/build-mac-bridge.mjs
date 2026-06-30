import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const packageRoot = resolve(desktopRoot, 'native/macos/mac-bridge')
const outputDir = resolve(packageRoot, '.build/cradle-dist')
const builtBinary = resolve(packageRoot, '.build/release/cradle-mac-bridge')
const resourceSourceDir = resolve(packageRoot, 'Resources')
const outputBinary = resolve(outputDir, 'cradle-mac-bridge')
const nextOutputBinary = resolve(outputDir, 'cradle-mac-bridge.next')
const outputResourceDir = resolve(outputDir, 'resources')

mkdirSync(outputDir, { recursive: true })

if (process.platform !== 'darwin') {
  const markerPath = resolve(outputDir, 'README.txt')
  copyFileSync(resolve(packageRoot, 'README.md'), markerPath)
  console.log('Skipping Mac Bridge build because this host is not macOS.')
  process.exit(0)
}

const result = spawnSync('swift', ['build', '-c', 'release'], {
  cwd: packageRoot,
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
if (!existsSync(builtBinary)) {
  throw new Error(`Swift build finished but did not produce ${builtBinary}`)
}

rmSync(nextOutputBinary, { force: true })
copyFileSync(builtBinary, nextOutputBinary)
chmodSync(nextOutputBinary, 0o755)
renameSync(nextOutputBinary, outputBinary)
rmSync(outputResourceDir, { recursive: true, force: true })
if (existsSync(resourceSourceDir)) {
  cpSync(resourceSourceDir, outputResourceDir, { recursive: true })
}
console.log(`Copied Mac Bridge binary to ${outputBinary}`)
