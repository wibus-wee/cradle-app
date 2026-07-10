import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gitMarkerPath = resolve(rootDirectory, '.git')

if (!existsSync(gitMarkerPath)) {
  process.exit(0)
}

const runGit = (...args) => execFileSync('git', args, {
  cwd: rootDirectory,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim()

let configuredHooksPath = ''
try {
  configuredHooksPath = runGit('config', '--local', '--get', 'core.hooksPath')
}
catch {
  // A missing local hooks path is the normal case.
}

const needsWorktreeCompatibility = statSync(gitMarkerPath).isFile() && !configuredHooksPath

if (needsWorktreeCompatibility) {
  const hooksPath = runGit('rev-parse', '--path-format=absolute', '--git-path', 'hooks')
  runGit('config', '--local', 'core.hooksPath', hooksPath)
}

try {
  execFileSync(process.execPath, [resolve(rootDirectory, 'node_modules/simple-git-hooks/cli.js')], {
    cwd: rootDirectory,
    stdio: 'inherit',
  })
}
finally {
  if (needsWorktreeCompatibility) {
    runGit('config', '--local', '--unset', 'core.hooksPath')
  }
}
