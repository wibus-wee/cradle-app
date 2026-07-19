#!/usr/bin/env node
/**
 * Local Sparkle update smoke helper.
 *
 * Prepares a static feed directory with a versioned zip + placeholder appcast
 * and optionally launches an old packaged Cradle.app pointed at that feed.
 *
 * Full end-to-end Sparkle install still requires a real EdDSA-signed appcast
 * produced by `electron-sparkle-updater generate-appcast`.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, '..')

function printUsage() {
  console.log(`Usage: pnpm --filter @cradle/desktop smoke:update -- [options]

Options:
  --zip <path>       New macOS zip artifact (required unless --feed-dir already has one).
  --version <value>  New app version written into a placeholder appcast.xml.
  --old-app <path>   Existing packaged Cradle.app to launch against the local feed.
  --feed-dir <path>  Feed output directory. Defaults to release/update-smoke.
  --port <n>         Local static server port. Defaults to 8765.
  --public-key <k>   SPARKLE_ED_PUBLIC_KEY for the launched app.
  --launch           Launch old app executable with CRADLE_DESKTOP_SPARKLE_APPCAST_URL set.
`)
}

function parseArgs(argv) {
  const options = {
    zip: null,
    version: '9.9.9',
    oldApp: null,
    feedDir: path.resolve(desktopRoot, 'release/update-smoke'),
    port: 8765,
    publicKey: process.env.SPARKLE_ED_PUBLIC_KEY ?? 'SMOKE_PUBLIC_KEY_PLACEHOLDER',
    launch: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--launch') {
      options.launch = true
      continue
    }
    const value = argv[++i]
    if (!value) {
      throw new Error(`Missing value for ${arg}`)
    }
    switch (arg) {
      case '--zip':
        options.zip = path.resolve(value)
        break
      case '--version':
        options.version = value
        break
      case '--old-app':
        options.oldApp = path.resolve(value)
        break
      case '--feed-dir':
        options.feedDir = path.resolve(value)
        break
      case '--port':
        options.port = Number(value)
        break
      case '--public-key':
        options.publicKey = value
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function writePlaceholderAppcast({ feedDir, version, zipName, baseUrl, size }) {
  const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Cradle</title>
    <item>
      <title>Cradle ${version}</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<p>Local smoke update ${version}</p>]]></description>
      <enclosure
        url="${baseUrl}${zipName}"
        sparkle:version="${version}"
        sparkle:shortVersionString="${version}"
        length="${size}"
        type="application/octet-stream"
        sparkle:edSignature="SMOKE_UNSIGNED" />
    </item>
  </channel>
</rss>
`
  writeFileSync(path.join(feedDir, 'appcast.xml'), appcast, 'utf8')
}

async function serveFeed(feedDir, port) {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const filePath = path.join(feedDir, urlPath === '/' ? 'appcast.xml' : urlPath.replace(/^\//, ''))
    if (!filePath.startsWith(feedDir) || !existsSync(filePath)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': filePath.endsWith('.xml') ? 'application/xml' : 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    createReadStream(filePath).pipe(res)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.feedDir, { recursive: true })

  let zipName = null
  let zipSize = 0
  if (options.zip) {
    if (!existsSync(options.zip)) {
      throw new Error(`Zip not found: ${options.zip}`)
    }
    zipName = `Cradle-${options.version}-mac-arm64.zip`
    const dest = path.join(options.feedDir, zipName)
    copyFileSync(options.zip, dest)
    zipSize = statSync(dest).size
  }
  else {
    zipName = readdirSync(options.feedDir).find(entry => entry.endsWith('.zip'))
    if (!zipName) {
      throw new Error('--zip is required when feed-dir has no zip')
    }
    zipSize = statSync(path.join(options.feedDir, zipName)).size
  }

  const baseUrl = `http://127.0.0.1:${options.port}/`
  writePlaceholderAppcast({
    feedDir: options.feedDir,
    version: options.version,
    zipName,
    baseUrl,
    size: zipSize,
  })

  const server = await serveFeed(options.feedDir, options.port)
  const appcastUrl = `${baseUrl}appcast.xml`
  console.log(`Serving Sparkle smoke feed at ${baseUrl}`)
  console.log(`Appcast: ${appcastUrl}`)
  console.log(`Zip: ${path.join(options.feedDir, zipName)}`)
  console.log('Note: placeholder appcast is NOT EdDSA-signed. For real installs run generate-appcast with SPARKLE_ED_PRIVATE_KEY.')

  if (options.launch) {
    if (!options.oldApp) {
      throw new Error('--old-app is required with --launch')
    }
    const executablePath = path.join(options.oldApp, 'Contents/MacOS/Cradle')
    if (!existsSync(executablePath)) {
      throw new Error(`Executable not found: ${executablePath}`)
    }
    console.log(`Launching ${executablePath}`)
    spawn(executablePath, [], {
      env: {
        ...process.env,
        CRADLE_DESKTOP_UPDATE_URL: baseUrl,
        CRADLE_DESKTOP_SPARKLE_APPCAST_URL: appcastUrl,
        SPARKLE_ED_PUBLIC_KEY: options.publicKey,
        CRADLE_DESKTOP_ALLOW_DEV_UPDATES: 'true',
      },
      detached: true,
      stdio: 'ignore',
    }).unref()
  }

  console.log('Press Ctrl+C to stop the feed server.')
  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
