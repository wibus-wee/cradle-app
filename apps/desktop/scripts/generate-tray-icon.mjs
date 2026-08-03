/**
 * Generate macOS menubar Template PNGs from Cradle's app icon.
 *
 * Pipeline:
 * 1. Measure the light disc + cradle occlusion curve from resources/icon.png
 * 2. Paint a black+alpha silhouette (disc above fold + thick cradle band)
 * 3. Normalize into a padded square and export trayTemplate.png / @2x
 *
 * Requires `sharp` (available via @cradle/server in this monorepo).
 *
 * Usage (from apps/desktop):
 *   node --import ../server/node_modules/sharp/lib/index.js scripts/generate-tray-icon.mjs
 *   # or, with sharp resolvable:
 *   node scripts/generate-tray-icon.mjs
 */

import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const workspaceRoot = resolve(desktopRoot, '../..')
const sourceIconPath = resolve(workspaceRoot, 'resources/icon.png')
const outputDir = resolve(desktopRoot, 'resources/tray')

const TRAY_SIZE = 18
const TRAY_SIZE_2X = 36
const HI_RES = 512
const CONTENT_PAD = 0.10

async function loadSharp() {
  const require = createRequire(resolve(desktopRoot, 'package.json'))
  try {
    return require('sharp')
  }
  catch {
    // Fall back to the server package's sharp install in this monorepo.
    return require(resolve(workspaceRoot, 'apps/server/node_modules/sharp'))
  }
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function measureDisc(data, width, height) {
  const points = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (luminance(data[i], data[i + 1], data[i + 2]) > 160) {
        points.push([x, y])
      }
    }
  }
  if (points.length === 0) {
    throw new Error('No bright disc pixels found in Cradle icon')
  }

  let sumX = 0
  let sumY = 0
  for (const [x, y] of points) {
    sumX += x
    sumY += y
  }
  const cx = sumX / points.length
  const cy = sumY / points.length
  let maxR = 0
  for (const [x, y] of points) {
    maxR = Math.max(maxR, Math.hypot(x - cx, y - cy))
  }
  return { cx, cy, maxR }
}

function fitCradleFold(data, width, height, cx, maxR) {
  const edge = []
  for (let x = Math.floor(cx - maxR * 0.95); x <= Math.ceil(cx + maxR * 0.95); x++) {
    let lastY = -1
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4
      if (luminance(data[i], data[i + 1], data[i + 2]) > 145) {
        lastY = y
      }
    }
    if (lastY >= 0) {
      edge.push([x, lastY])
    }
  }
  if (edge.length < 8) {
    throw new Error('Could not sample cradle fold edge from Cradle icon')
  }

  // Fit y = a*(x-cx)^2 + b
  let sumU4 = 0
  let sumU2 = 0
  let sumU2Y = 0
  let sumY = 0
  for (const [x, y] of edge) {
    const u = x - cx
    const u2 = u * u
    sumU4 += u2 * u2
    sumU2 += u2
    sumU2Y += u2 * y
    sumY += y
  }
  const n = edge.length
  const det = sumU4 * n - sumU2 * sumU2
  if (Math.abs(det) < 1e-9) {
    throw new Error('Degenerate cradle fold fit')
  }
  const a = (sumU2Y * n - sumU2 * sumY) / det
  const b = (sumU4 * sumY - sumU2 * sumU2Y) / det
  return { a, b }
}

function buildMask(data, width, height, geometry) {
  const { cx, cy, maxR, a, b } = geometry
  const mask = Buffer.alloc(HI_RES * HI_RES)

  const armHalf = maxR * 1.12
  const contentMinX = cx - armHalf
  const contentMaxX = cx + armHalf
  const contentMinY = cy - maxR
  const contentMaxY = b + maxR * 0.22
  const side = Math.max(contentMaxX - contentMinX, contentMaxY - contentMinY)
  const outMinX = (contentMinX + contentMaxX) / 2 - side / 2
  const outMinY = (contentMinY + contentMaxY) / 2 - side / 2

  const srcToOut = (sx, sy) => {
    const nx = (sx - outMinX) / side
    const ny = (sy - outMinY) / side
    const ox = CONTENT_PAD + nx * (1 - 2 * CONTENT_PAD)
    const oy = CONTENT_PAD + ny * (1 - 2 * CONTENT_PAD)
    return [ox * (HI_RES - 1), oy * (HI_RES - 1)]
  }

  const stamp = (ox, oy, alpha) => {
    for (let py = -1; py <= 1; py++) {
      for (let px = -1; px <= 1; px++) {
        const ix = Math.round(ox + px)
        const iy = Math.round(oy + py)
        if (ix < 0 || iy < 0 || ix >= HI_RES || iy >= HI_RES) {
          continue
        }
        const dist = Math.hypot(px, py)
        const stamped = dist < 0.5 ? alpha : dist < 1.2 ? Math.round(alpha * 0.7) : 0
        const oi = iy * HI_RES + ix
        mask[oi] = Math.max(mask[oi], stamped)
      }
    }
  }

  // Disc: bright pixels above the cradle fold.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const lum = luminance(data[i], data[i + 1], data[i + 2])
      if (lum < 130) {
        continue
      }
      const foldY = a * (x - cx) * (x - cx) + b
      if (y > foldY + 2) {
        continue
      }
      const [ox, oy] = srcToOut(x, y)
      const ix = Math.round(ox)
      const iy = Math.round(oy)
      if (ix < 0 || iy < 0 || ix >= HI_RES || iy >= HI_RES) {
        continue
      }
      const alpha = Math.min(255, Math.round((lum - 100) * 2.2))
      const oi = iy * HI_RES + ix
      mask[oi] = Math.max(mask[oi], alpha)
    }
  }

  // Cradle band: thick stroke along the fitted fold, arms slightly past the disc.
  const thickness = maxR * 0.16
  for (let x = cx - armHalf; x <= cx + armHalf; x += 0.5) {
    const foldY = a * (x - cx) * (x - cx) + b
    const t = Math.abs(x - cx) / armHalf
    const localThick = thickness * (0.75 + 0.35 * (1 - t * t))
    for (let dy = -localThick * 0.35; dy <= localThick * 0.65; dy += 0.5) {
      const [ox, oy] = srcToOut(x, foldY + dy)
      stamp(ox, oy, 255)
    }
  }

  return mask
}

async function exportPng(sharp, mask, size, filePath, { preview = false } = {}) {
  const rgba = Buffer.alloc(HI_RES * HI_RES * 4)
  for (let i = 0; i < HI_RES * HI_RES; i++) {
    const alpha = mask[i]
    if (preview) {
      rgba[i * 4] = 255
      rgba[i * 4 + 1] = 255
      rgba[i * 4 + 2] = 255
      rgba[i * 4 + 3] = alpha
    }
    else {
      rgba[i * 4] = 0
      rgba[i * 4 + 1] = 0
      rgba[i * 4 + 2] = 0
      rgba[i * 4 + 3] = alpha
    }
  }

  const resized = await sharp(rgba, {
    raw: { width: HI_RES, height: HI_RES, channels: 4 },
  })
    .resize(size, size, { kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const out = resized.data
  for (let i = 0; i < resized.info.width * resized.info.height; i++) {
    if (preview) {
      continue
    }
    out[i * 4] = 0
    out[i * 4 + 1] = 0
    out[i * 4 + 2] = 0
    const alpha = out[i * 4 + 3]
    // Drop faint haze; slightly boost mid alphas for tiny menubar legibility.
    out[i * 4 + 3] = alpha > 20 ? Math.min(255, Math.round(alpha * 1.15)) : 0
  }

  if (preview) {
    const glyph = await sharp(out, {
      raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
    }).png().toBuffer()
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 40, g: 40, b: 45, alpha: 1 },
      },
    })
      .composite([{ input: glyph, blend: 'over' }])
      .png()
      .toFile(filePath)
    return
  }

  await sharp(out, {
    raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
  })
    .png()
    .toFile(filePath)
}

async function main() {
  const sharp = await loadSharp()
  const { data, info } = await sharp(sourceIconPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const disc = measureDisc(data, info.width, info.height)
  const fold = fitCradleFold(data, info.width, info.height, disc.cx, disc.maxR)
  const geometry = { ...disc, ...fold }
  const mask = buildMask(data, info.width, info.height, geometry)

  await mkdir(outputDir, { recursive: true })
  const templatePath = resolve(outputDir, 'trayTemplate.png')
  const template2xPath = resolve(outputDir, 'wendy.h@example.net')
  await exportPng(sharp, mask, TRAY_SIZE, templatePath)
  await exportPng(sharp, mask, TRAY_SIZE_2X, template2xPath)

  if (process.env.CRADLE_TRAY_ICON_PREVIEW === '1') {
    const previewDir = resolve(workspaceRoot, 'tmp-tray-preview')
    await mkdir(previewDir, { recursive: true })
    await exportPng(sharp, mask, 128, resolve(previewDir, 'preview-128.png'), { preview: true })
    await exportPng(sharp, mask, 64, resolve(previewDir, 'preview-64.png'), { preview: true })
    await exportPng(sharp, mask, TRAY_SIZE_2X, resolve(previewDir, 'preview-36.png'), { preview: true })
    await exportPng(sharp, mask, TRAY_SIZE, resolve(previewDir, 'preview-18.png'), { preview: true })
    console.log(`Previews in ${previewDir}`)
  }

  console.log(`Wrote ${templatePath}`)
  console.log(`Wrote ${template2xPath}`)
  console.log('geometry', {
    cx: Number(geometry.cx.toFixed(2)),
    cy: Number(geometry.cy.toFixed(2)),
    maxR: Number(geometry.maxR.toFixed(2)),
    foldB: Number(geometry.b.toFixed(2)),
  })
}

await main()
