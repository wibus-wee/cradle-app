#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { arch, tmpdir } from 'node:os'
import { resolve } from 'node:path'

import appdmg from 'appdmg'

import { fixMacOSFrameworkSymlinks } from '../apps/desktop/scripts/fix-macos-framework-symlinks.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_ICON = resolve(REPO_ROOT, '.github', 'Cradle.png')
const DEFAULT_COMMAND = resolve(import.meta.dirname, 'Install Cradle.command')
const DEFAULT_OUTPUT = resolve(import.meta.dirname, 'dist', 'Cradle-Installer.dmg')
const VOLUME_NAME = 'Install Cradle'

function parseArgs(argv) {
  const args = { icon: DEFAULT_ICON, output: DEFAULT_OUTPUT, keepStage: false }
  let i = 2
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === '--app' && i + 1 < argv.length) {
      args.app = argv[++i]
    }
 else if (arg === '--icon' && i + 1 < argv.length) {
      args.icon = argv[++i]
    }
 else if (arg === '--no-icon') {
      args.icon = null
    }
 else if (arg === '--output' && i + 1 < argv.length) {
      args.output = argv[++i]
    }
 else if (arg === '--keep-stage') {
      args.keepStage = true
    }
 else if (arg === '-h' || arg === '--help') {
      console.log(`Usage: installer/build-dmg.mjs --app <path> [options]

Options:
  --app <path>       Cradle.app, a release .dmg, or a release .zip to bundle.
  --icon <path>      PNG used as the DMG volume icon.
  --no-icon          Do not set a custom DMG volume icon.
  --output <path>    Output DMG path. Defaults to installer/dist/Cradle-Installer.dmg.
  --keep-stage       Keep the temporary staging directory for inspection.
  -h, --help         Show this help.`)
      process.exit(0)
    }
 else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
    i++
  }
  if (!args.app) {
    console.error('--app <path> is required')
    process.exit(1)
  }
  return args
}

function findAppInDir(root, depth = 0) {
  if (depth > 5) { return null }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = resolve(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'Cradle.app') { return full }
      if (entry.name.endsWith('.app') && !entry.name.startsWith('.')) { return full }
      const found = findAppInDir(full, depth + 1)
      if (found) { return found }
    }
  }
  return null
}

function resolvePayload(appInput, stageDir) {
  const resolved = resolve(REPO_ROOT, appInput)
  if (!existsSync(resolved)) {
    console.error(`Input does not exist: ${resolved}`)
    process.exit(1)
  }

  const lower = resolved.toLowerCase()

  if (lower.endsWith('.app') && existsSync(resolved)) {
    return resolved
  }

  if (lower.endsWith('.zip')) {
    const extractDir = resolve(stageDir, 'extract')
    mkdirSync(extractDir, { recursive: true })
    execFileSync('/usr/bin/ditto', ['-x', '-k', resolved, extractDir], { stdio: 'inherit' })
    const app = findAppInDir(extractDir)
    if (!app) { console.error('zip did not contain a macOS app bundle'); process.exit(1) }
    return app
  }

  if (lower.endsWith('.dmg')) {
    const mountDir = resolve(stageDir, 'mounted-dmg')
    mkdirSync(mountDir, { recursive: true })
    execFileSync('/usr/bin/hdiutil', ['attach', resolved, '-nobrowse', '-readonly', '-mountpoint', mountDir, '-quiet'], { stdio: 'inherit' })
    const app = findAppInDir(mountDir)
    if (!app) { console.error('DMG did not contain a macOS app bundle'); process.exit(1) }
    return app
  }

  console.error('--app must point to Cradle.app, a .dmg, or a .zip')
  process.exit(1)
}

function stagePayload(appPath, stageDir) {
  const payloadDir = resolve(stageDir, '.payload')
  mkdirSync(payloadDir, { recursive: true })
  const payloadApp = resolve(payloadDir, 'Cradle.app')
  execFileSync('/usr/bin/ditto', [appPath, payloadApp])
  const fixResult = fixMacOSFrameworkSymlinks(payloadApp)
  if (fixResult.absoluteSymlinks.length > 0) {
    const details = fixResult.absoluteSymlinks
      .map(symlink => `${symlink.linkPath} -> ${symlink.target}`)
      .join('\n')
    throw new Error(`Unfixed absolute macOS framework symlink(s):\n${details}`)
  }
  execFileSync('/usr/bin/xattr', ['-cr', payloadApp], { stdio: 'ignore' })
  if (arch() === 'arm64') {
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', payloadApp], { stdio: 'ignore' })
  }
  return payloadDir
}

function stageCommand(stageDir) {
  const dest = resolve(stageDir, 'Install Cradle.command')
  cpSync(DEFAULT_COMMAND, dest)
  chmodSync(dest, 0o755)
  return dest
}

function applyCommandIcon(commandPath, iconPath) {
  if (!iconPath || !existsSync(iconPath)) { return }
  const script = `
    ObjC.import('AppKit')
    function run(argv) {
      const icon = $.NSImage.alloc.initWithContentsOfFile(argv[0])
      if (!icon) throw new Error('Cannot read icon: ' + argv[0])
      const ok = $.NSWorkspace.sharedWorkspace.setIconForFileOptions(icon, argv[1], 0)
      if (!ok) throw new Error('Cannot set icon on ' + argv[1])
    }
  `
  execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, iconPath, commandPath], { stdio: 'ignore' })
}

function hideExtension(dmgPath) {
  const mountDir = mkdtempSync(resolve(tmpdir(), 'dmg-mount-'))
  try {
    execFileSync('/usr/bin/hdiutil', ['attach', dmgPath, '-nobrowse', '-readwrite', '-mountpoint', mountDir, '-quiet'], { stdio: 'ignore' })
    const commandFile = resolve(mountDir, 'Install Cradle.command')
    if (existsSync(commandFile)) {
      try {
        execFileSync('/usr/bin/SetFile', ['-a', 'E', commandFile], { stdio: 'ignore' })
      }
 catch {
        // SetFile may not be available; extension will still show
      }
    }
  }
 finally {
    try {
      execFileSync('/usr/bin/hdiutil', ['detach', mountDir, '-quiet'], { stdio: 'ignore' })
    }
 catch {
      // Force-detach if the normal detach fails (e.g. a background process still holds a handle)
      try { execFileSync('/usr/bin/hdiutil', ['detach', mountDir, '-force', '-quiet'], { stdio: 'ignore' }) }
 catch {}
    }
    try { rmSync(mountDir, { recursive: true, force: true }) }
 catch {}
  }
}

async function buildDmg(spec, outputPath) {
  mkdirSync(resolve(outputPath, '..'), { recursive: true })
  return new Promise((ok, fail) => {
    const { basepath, ...cleanSpec } = spec
    const ee = appdmg({ target: outputPath, basepath, specification: cleanSpec })
    ee.on('progress', (info) => {
      if (info.type === 'step-begin') { console.log(`  ${info.title}`) }
    })
    ee.on('finish', ok)
    ee.on('error', fail)
  })
}

async function main() {
  const args = parseArgs(process.argv)
  const stageDir = mkdtempSync(resolve(tmpdir(), 'cradle-installer-dmg-'))

  try {
    console.log('Staging app bundle...')
    const appPath = resolvePayload(args.app, stageDir)
    const payloadDir = stagePayload(appPath, stageDir)

    console.log('Staging installer command...')
    const commandPath = stageCommand(stageDir)
    applyCommandIcon(commandPath, args.icon)

    const iconStaged = args.icon && existsSync(args.icon) ? resolve(stageDir, 'volume.icns') : null
    if (args.icon && existsSync(args.icon)) {
      cpSync(args.icon, iconStaged)
    }

    console.log('Building DMG with appdmg...')
    const outputAbs = resolve(REPO_ROOT, args.output)
    const rwDmg = resolve(stageDir, 'rw.dmg')
    await buildDmg({
      'title': VOLUME_NAME,
      ...(iconStaged ? { icon: iconStaged } : {}),
      'background-color': '#1c1c1c',
      'icon-size': 80,
      'format': 'UDRW',
      'window': {
        size: { width: 660, height: 400 },
      },
      'contents': [
        { x: 80, y: 320, type: 'file', path: payloadDir, name: '.payload' },
        { x: 330, y: 200, type: 'file', path: commandPath, name: 'Install Cradle' },
      ],
      'basepath': stageDir,
    }, rwDmg)

    console.log('Hiding .command extension in DMG...')
    hideExtension(rwDmg)

    console.log('Compressing DMG...')
    // Flush filesystem buffers so the rw image is fully written before convert
    try { execFileSync('/bin/sync', { stdio: 'ignore' }) }
 catch {}

    // hdiutil convert can transiently fail on CI runners when a prior detach
    // hasn't fully released the image.  Retry up to 3 times with a short delay.
    let convertErr
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execFileSync('/usr/bin/hdiutil', ['convert', rwDmg, '-format', 'UDZO', '-o', outputAbs], { stdio: 'pipe' })
        convertErr = null
        break
      }
 catch (err) {
        convertErr = err
        const stderr = err.stderr?.toString?.() ?? ''
        console.error(`hdiutil convert attempt ${attempt} failed${stderr ? `: ${stderr.trim()}` : ''}`)
        if (attempt < 3) {
          // Wait before retrying — gives APFS time to release the image
          execFileSync('/bin/sleep', ['2'])
        }
      }
    }
    if (convertErr) { throw convertErr }

    console.log(`Wrote ${outputAbs}`)
  }
 finally {
    if (!args.keepStage) {
      rmSync(stageDir, { recursive: true, force: true })
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
