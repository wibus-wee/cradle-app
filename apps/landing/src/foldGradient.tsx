import { ShaderMount } from '@paper-design/shaders-react'
import * as React from 'react'
import { useMemo } from 'react'

import { fragmentShader } from './foldGradientShader'

export interface FoldGradientProps {
  /** up to 5 stops, darkest → hottest; bright sheet edges reach the last stop */
  colors?: string[]
  /** colour of the black gaps between sheets */
  bgColor?: string
  /** tint that bleeds into the shadowed edges */
  shadowColor?: string
  /** 0–2 · higher = softer, longer smear */
  softness?: number
  /** 0–2 · 0 = mono, 1 = natural */
  saturation?: number
  /** drape angle in degrees */
  rotation?: number
  /** 4–18 · higher = bigger sheets */
  zoom?: number
  /** 0–1 · blends in discrete strip cuts (0 = pure flow) */
  ribbon?: number
  /** strip width multiplier for ribbon mode */
  ribbonWidth?: number
  /** animation speed (0 = frozen) */
  speed?: number
  style?: React.CSSProperties
}
// hex → linear-light rgb(a); the shader mixes colour in linear space
const toLin = (c: number) => c ** 2.2
const hexRGBA = (h: string): [number, number, number, number] => {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(h.slice(i, i + 2), 16) / 255).map(toLin)
  return [r, g, b, 1]
}
const hexRGB = (h: string): [number, number, number] =>
  hexRGBA(h).slice(0, 3) as [number, number, number]

const DEFAULT_FOLD_GRADIENT_COLORS = ['#700000', '#008cff', '#75daff', '#ff0026', '#ff3626']

export default function FoldGradient({
  colors = DEFAULT_FOLD_GRADIENT_COLORS,
  bgColor = '#121212',
  shadowColor = '#0a1c2a',
  softness = 1,
  saturation = 1,
  rotation = 52,
  zoom = 9,
  ribbon = 0,
  ribbonWidth = 1,
  speed = 1,
  style,
}: FoldGradientProps) {
  const uniforms = useMemo(
    () => ({
      u_colors: colors.map(hexRGBA),
      u_ncols: colors.length,
      u_back: hexRGB(bgColor),
      u_shadow: hexRGB(shadowColor),
      u_softness: softness,
      u_saturation: saturation,
      u_noise: 0.0,
      u_rotation: rotation,
      u_folds: zoom,
      u_ribbon: ribbon,
      u_ribbonWidth: ribbonWidth,
    }),
    [colors, bgColor, shadowColor, softness, saturation, rotation, zoom, ribbon, ribbonWidth],
  )
  return (
    <ShaderMount
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
      speed={speed}
      maxPixelCount={1600 * 900}
      minPixelRatio={1}
    />
  )
}
