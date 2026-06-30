import { memo, useEffect, useId, useMemo, useRef } from 'react'

import { Block } from './blocks/block'
import { StreamErrorBoundary } from './components/error-boundary'
import type { BlockInfo } from './hooks/use-block-queue'
import { tokenizeBlocks, useStreamQueue } from './hooks/use-block-queue'
import { useDelayedAnimated } from './hooks/use-delayed-animated'
import type { SmoothPreset } from './hooks/use-smooth-content'
import { useSmoothContent } from './hooks/use-smooth-content'
import { patchIncomplete } from './plugins/remark-incomplete'
import type { AnimationPreset, AnimationPresetName } from './presets/types'
import { PRESETS } from './presets/types'
import { useProfilerContext } from './profiler/profiler-provider'

const DEFAULT_FADE_DURATION = 280
const MAX_ANIMATED_BLOCK_CHARS = 1800

function resolvePreset(input?: AnimationPresetName | AnimationPreset): AnimationPreset {
  if (!input) {
    return PRESETS.balanced
  }
  const presetName = String(input) as AnimationPresetName
  return Object(input) === input
    ? input as AnimationPreset
    : PRESETS[presetName] ?? PRESETS.balanced
}

function countChars(text: string): number {
  return [...text].length
}

function getNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

interface StreamdownRenderProps {
  content: string
  streaming: boolean
  /** CPS smoothing preset */
  preset?: SmoothPreset
  /** Animation visual preset (minimal/balanced/dramatic or custom) */
  animationPreset?: AnimationPresetName | AnimationPreset
  animateMode?: 'char' | 'word'
  /** Show blinking cursor at stream edge (default: true) */
  showCursor?: boolean
  /** Custom ReactMarkdown components map */
  components?: Record<string, React.ComponentType<unknown>>
  /** Additional rehype plugins (applied after core plugins) */
  rehypePlugins?: unknown[]
  /** Additional remark plugins (applied after core plugins) */
  remarkPlugins?: unknown[]
  className?: string
  animatedTailMs?: number
}

export const StreamdownRender = memo<StreamdownRenderProps>(({
  content,
  streaming,
  preset = 'balanced',
  animationPreset,
  animateMode = 'word',
  showCursor = true,
  components,
  rehypePlugins,
  remarkPlugins,
  animatedTailMs = 1000,
  className,
}) => {
  const profilerCtx = useProfilerContext()
  const generatedId = useId()
  const animPreset = resolvePreset(animationPreset)
  const fadeDuration = animPreset.fadeDuration || DEFAULT_FADE_DURATION
  const smoothed = useSmoothContent(content, streaming, preset, profilerCtx?.profiler)
  const showStreamingClass = useDelayedAnimated(streaming, animatedTailMs)

  // Tokenize content into blocks with stable startOffset keys
  const blocks: BlockInfo[] = useMemo(() => {
    const patched = streaming ? patchIncomplete(smoothed) : smoothed
    return tokenizeBlocks(patched)
  }, [smoothed, streaming])

  // Block-level state machine
  const { getBlockState, charDelay } = useStreamQueue(blocks)

  // === PERSISTENT BIRTHS ===
  // Each char gets a birth timestamp assigned ONCE and it never changes.
  // We use a ref to persist across renders. Reading ref.current during render
  // is intentional here (same pattern as Lobe) — births are append-only data
  // that doesn't trigger re-renders.
  const blockBirthsRef = useRef<Map<number, number[]>>(new Map())

  const renderNow = getNow()

  // Compute births for this frame (reads ref intentionally during render)

  const prevBirths = blockBirthsRef.current
  const birthsForRender = new Map<number, number[]>()
  const animatedBlockOffsets = new Set<number>()

  for (const [index, block] of blocks.entries()) {
    const state = getBlockState(index)
    if (state === 'queued') {
      continue
    }

    const blockCharCount = countChars(block.content)
    if (blockCharCount > MAX_ANIMATED_BLOCK_CHARS) {
      continue
    }

    animatedBlockOffsets.add(block.startOffset)
    const prev = prevBirths.get(block.startOffset)
    let arr: number[]

    if (prev && prev.length === blockCharCount) {
      arr = prev
    }
 else if (prev && prev.length > blockCharCount) {
      arr = prev.slice(0, blockCharCount)
    }
 else {
      arr = prev ? prev.slice() : []
      const startIdx = arr.length
      const cap = renderNow + fadeDuration
      for (let i = startIdx; i < blockCharCount; i++) {
        const prevBirth = i > 0 ? (arr[i - 1] as number) : renderNow - charDelay
        const chained = prevBirth + charDelay
        arr.push(Math.min(cap, Math.max(chained, renderNow)))
      }
    }

    birthsForRender.set(block.startOffset, arr)
  }

  // Persist births after render
  useEffect(() => {
    blockBirthsRef.current = birthsForRender
  })

  // Determine if block is fully settled (all chars past fade window)
  const isBlockSettled = (block: BlockInfo, index: number): boolean => {
    const state = getBlockState(index)
    if (state !== 'revealed') {
      return false
    }
    const births = birthsForRender.get(block.startOffset)
    if (!births || births.length === 0) {
      return true
    }
    const lastBirth = births.at(-1)!
    return renderNow - lastBirth >= fadeDuration
  }

  const containerClasses = [
    'streamdown-root',
    animPreset.containerClass,
    showStreamingClass ? 'streaming-response' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={containerClasses}>
      <StreamErrorBoundary>
        {blocks.map((block, index) => {
          const state = getBlockState(index)
          if (state === 'queued') {
            return null
          }

          const settled = isBlockSettled(block, index)
          const births = birthsForRender.get(block.startOffset)
          const animated = animatedBlockOffsets.has(block.startOffset)
          const key = `${generatedId}-${block.startOffset}`
          const isLastVisible = index === blocks.length - 1 || getBlockState(index + 1) === 'queued'

          return (
            <Block
              key={key}
              content={block.content}
              state={state}
              births={births}
              animated={animated}
              nowMs={renderNow}
              fadeDuration={fadeDuration}
              settled={settled}
              animateMode={animateMode}
              isActiveEnd={showCursor && streaming && isLastVisible}
              components={components}
              extraRehypePlugins={rehypePlugins}
              extraRemarkPlugins={remarkPlugins}
            />
          )
        })}
      </StreamErrorBoundary>
    </div>
  )
})

StreamdownRender.displayName = 'StreamdownRender'
