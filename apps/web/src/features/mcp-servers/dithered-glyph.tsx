import { Dithering } from '@paper-design/shaders-react'
import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { cn } from '~/lib/cn'

const GLYPH_RENDER_SIZE = 96

const glyphImageCache = new Map<ComponentType<{ size?: number }>, string>()

/**
 * The shader only accepts hex/rgb/hsl, but computed token colors come back as
 * oklch (Tailwind v4). Round-trip through a 1x1 canvas to normalize to sRGB.
 */
function toSrgb(cssColor: string): string {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) { return cssColor }
  context.fillStyle = cssColor
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

function glyphImageUrl(icon: ComponentType<{ size?: number }>): string {
  let url = glyphImageCache.get(icon)
  if (!url) {
    const Icon = icon
    const markup = renderToStaticMarkup(<Icon size={GLYPH_RENDER_SIZE} />)
    url = `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`
    glyphImageCache.set(icon, url)
  }
  return url
}

interface DitheredGlyphProps {
  icon: ComponentType<{ size?: number }>
  className?: string
}

/**
 * Decorative watermark: a procedural ordered-dither shader clipped to the icon
 * silhouette, so the glyph itself is drawn from dither pixels. Colors are
 * bridged from the CSS tokens via computed styles, so it follows light/dark
 * mode. The mask needs the runtime-generated data URI, hence the style prop.
 */
export function DitheredGlyph({ icon, className }: DitheredGlyphProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [colors, setColors] = useState<{ front: string, back: string } | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) { return }
    const computed = getComputedStyle(element)
    setColors({ front: toSrgb(computed.color), back: toSrgb(computed.backgroundColor) })
  }, [])

  return (
    <div
      ref={ref}
      className={cn('pointer-events-none absolute bg-card text-foreground', className)}
      aria-hidden="true"
    >
      {colors && (
        <div
          className="size-full"
          style={{
            maskImage: `url("${glyphImageUrl(icon)}")`,
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
          }}
        >
          <Dithering
            colorFront={colors.front}
            colorBack={colors.back}
            shape="warp"
            type="4x4"
            size={2}
            speed={0.3}
            width="100%"
            height="100%"
          />
        </div>
      )}
    </div>
  )
}
