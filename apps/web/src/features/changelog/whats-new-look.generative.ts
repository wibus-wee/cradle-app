// Generative (algorithmic) per-release visual identity.
//
// NOT CURRENTLY WIRED IN — whats-new-look.ts uses the curated-palette
// approach instead. Kept as an alternative: swap the implementation of
// `releaseLookForVersion` to try it again.
//
// The artwork is fully generative: a deterministic seed derived from the
// version string picks a base hue and builds an ANALOGOUS palette — all
// accents stay within a narrow hue window (same color temperature), with
// depth coming from saturation/lightness steps rather than hue contrast.
// Same version → same artwork; adjacent versions → visibly different ones.
export interface GenerativeReleaseLook {
  colors: string[]
  distortion: number
  swirl: number
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
}

/**
 * FNV-1a 32-bit hash with an fmix32 avalanche finalizer, so similar
 * version strings still land far apart on the color wheel.
 */
function hashSeed(input: string): number {
  let hash = 0x811C9DC5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85EBCA6B)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xC2B2AE35)
  hash ^= hash >>> 16
  return hash >>> 0
}

/** Map a bit range of the seed to a float in [min, max). */
function pickBand(seed: number, shift: number, min: number, max: number): number {
  const unit = ((seed >>> shift) % 1000) / 1000
  return min + unit * (max - min)
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function hsl(hue: number, saturation: number, lightness: number): string {
  // Legacy comma syntax — the shader's parser doesn't understand modern
  // space-separated hsl() and silently falls back to black.
  return `hsl(${Math.round(wrapHue(hue))}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`
}

/**
 * Tonal palette: a deep tinted base plus three accents inside a seeded hue
 * window (24–60°, random direction). Staying within one temperature keeps
 * the mesh gradient cohesive; contrast comes from lightness steps.
 */
function paletteFromSeed(seed: number): string[] {
  // High bits carry the avalanche mixing — low-bit sampling clusters hues.
  const baseHue = (seed >>> 14) % 360
  const hueWindow = pickBand(seed, 5, 24, 60)
  const direction = (seed >>> 9) % 2 === 0 ? 1 : -1
  const offsets = [0, hueWindow * direction, -hueWindow * 0.6 * direction]

  const base = hsl(baseHue, pickBand(seed, 8, 35, 55), pickBand(seed, 10, 6, 11))
  const accents = offsets.map((offset, i) => hsl(
    baseHue + offset,
    pickBand(seed, 13 + i * 3, 72, 92),
    pickBand(seed, 24 + i * 3, [58, 46, 66][i]! - 6, [58, 46, 66][i]! + 6),
  ))
  return [base, ...accents]
}

export function generativeReleaseLookForVersion(version: string): GenerativeReleaseLook {
  const seed = hashSeed(version)
  return {
    colors: paletteFromSeed(seed),
    distortion: pickBand(seed, 3, 0.25, 0.75),
    swirl: pickBand(seed, 7, 0, 0.5),
    scale: pickBand(seed, 9, 0.95, 1.4),
    rotation: Math.round(pickBand(seed, 12, 0, 360)),
    offsetX: pickBand(seed, 17, -0.3, 0.3),
    offsetY: pickBand(seed, 22, -0.3, 0.3),
  }
}
