// Per-release visual identity for the What's New surfaces.
// A deterministic seed derived from the version string picks a curated
// palette and shader params, so every release gets a distinct but stable
// look — the same version always renders the same artwork.
//
// A generative (color-theory) alternative lives in
// whats-new-look.generative.ts — swap it in if curated palettes ever feel
// too limited.
export interface ReleaseLook {
  colors: string[]
  distortion: number
  swirl: number
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
}

// Curated dark, cinematic palettes — the hero always renders white text on
// top, so every set starts from a deep base and layers vivid accents.
const PALETTES: string[][] = [
  ['#0f0524', '#4f46e5', '#8b5cf6', '#38bdf8'], // aurora indigo
  ['#1a0505', '#f43f5e', '#f97316', '#fbbf24'], // ember
  ['#02121a', '#0ea5e9', '#10b981', '#67e8f9'], // lagoon
  ['#12041f', '#7c3aed', '#ec4899', '#818cf8'], // ultraviolet
  ['#04120c', '#059669', '#34d399', '#a3e635'], // forest
  ['#020617', '#2563eb', '#06b6d4', '#a78bfa'], // ocean
  ['#170316', '#db2777', '#f59e0b', '#f472b6'], // magenta dusk
  ['#020d1a', '#0d9488', '#38bdf8', '#7dd3fc'], // glacier
]

/** FNV-1a 32-bit hash — stable across runs and platforms. */
function hashSeed(input: string): number {
  let hash = 0x811C9DC5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Map a bit range of the seed to a float in [min, max). */
function pickBand(seed: number, shift: number, min: number, max: number): number {
  const unit = ((seed >>> shift) % 1000) / 1000
  return min + unit * (max - min)
}

/** Rotate palette colors across the mesh so the base color doesn't dominate. */
function spreadColors(colors: string[], seed: number): string[] {
  const rotated = colors.map((_, i) => colors[(i + (seed % colors.length)) % colors.length] ?? colors[0] ?? '')
  return rotated
}

export function releaseLookForVersion(version: string): ReleaseLook {
  const seed = hashSeed(version)
  return {
    colors: spreadColors(PALETTES[seed % PALETTES.length] ?? PALETTES[0] ?? [], seed >>> 4),
    distortion: pickBand(seed, 3, 0.25, 0.75),
    swirl: pickBand(seed, 7, 0, 0.5),
    scale: pickBand(seed, 9, 0.95, 1.4),
    rotation: Math.round(pickBand(seed, 12, 0, 360)),
    offsetX: pickBand(seed, 17, -0.3, 0.3),
    offsetY: pickBand(seed, 21, -0.3, 0.3),
  }
}
