import { marked } from 'marked'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface BlockInfo {
  content: string
  startOffset: number
}

export type BlockState = 'revealed' | 'animating' | 'streaming' | 'queued'

const BASE_DELAY = 18
const ACCELERATION_FACTOR = 0.3
const MAX_BLOCK_DURATION = 3000
const FADE_DURATION = 280

function countChars(text: string): number {
  return [...text].length
}

function computeCharDelay(queueLength: number, charCount: number): number {
  const acceleration = 1 + queueLength * ACCELERATION_FACTOR
  let delay = BASE_DELAY / acceleration
  delay = Math.min(delay, MAX_BLOCK_DURATION / Math.max(charCount, 1))
  return delay
}

export interface UseStreamQueueReturn {
  charDelay: number
  getBlockState: (index: number) => BlockState
  queueLength: number
}

/**
 * Block-level state machine (Lobe pattern).
 * Tracks revealed count and promotes blocks synchronously during render
 * so there is never an intermediate "animating" frame that would restart
 * animations on the old streaming block.
 */
export function useStreamQueue(blocks: BlockInfo[]): UseStreamQueueReturn {
  const [revealedCount, setRevealedCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevBlocksLenRef = useRef(0)
  const minRevealedRef = useRef(0)

  // Synchronous auto-reveal during render.
  // When blocks grow, the previous tail (streaming block) is instantly
  // promoted to revealed — its chars are already visible via birth timestamps.
  // NOTE: Reading refs during render is intentional here (Lobe pattern) —
  // this data is mutable state that must be synchronous with the render frame.

  if (blocks.length === 0 && prevBlocksLenRef.current !== 0) {
    minRevealedRef.current = 0
  }
  if (blocks.length > prevBlocksLenRef.current && prevBlocksLenRef.current > 0) {
    const prevTail = prevBlocksLenRef.current - 1
    minRevealedRef.current = Math.max(minRevealedRef.current, prevTail + 1)
  }
  prevBlocksLenRef.current = blocks.length

  // State reset when stream restarts
  useEffect(() => {
    if (blocks.length === 0) {
      setRevealedCount(0)
      minRevealedRef.current = 0
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [blocks.length])

  const effectiveRevealedCount = Math.max(revealedCount, minRevealedRef.current)
  const tailIndex = blocks.length - 1

  const getBlockState = useCallback(
    (index: number): BlockState => {
      if (index < effectiveRevealedCount) {
        return 'revealed'
      }
      if (index === effectiveRevealedCount && index < tailIndex) {
        return 'animating'
      }
      if (index === effectiveRevealedCount && index === tailIndex) {
        return 'streaming'
      }
      return 'queued'
    },
    [effectiveRevealedCount, tailIndex],
  )

  const queueLength = Math.max(0, tailIndex - effectiveRevealedCount - 1)

  const animatingIndex = effectiveRevealedCount < tailIndex ? effectiveRevealedCount : -1
  const animatingCharCount
    = animatingIndex >= 0 ? countChars(blocks[animatingIndex]?.content ?? '') : 0

  const streamingIndex = animatingIndex < 0 && tailIndex >= effectiveRevealedCount ? tailIndex : -1
  const activeIndex = animatingIndex >= 0 ? animatingIndex : streamingIndex
  const activeCharCount = activeIndex >= 0 ? countChars(blocks[activeIndex]?.content ?? '') : 0

  // Freeze charDelay when entering a new active block
  const frozenRef = useRef({ delay: BASE_DELAY, index: -1 })
  if (activeIndex >= 0 && activeIndex !== frozenRef.current.index) {
    frozenRef.current = {
      delay: computeCharDelay(queueLength, activeCharCount),
      index: activeIndex,
    }
  }
  const charDelay = activeIndex >= 0 ? frozenRef.current.delay : BASE_DELAY

  const onAnimationDone = useCallback(() => {
    setRevealedCount(effectiveRevealedCount + 1)
  }, [effectiveRevealedCount])

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (animatingIndex < 0) {
      return
    }

    const totalTime = Math.max(0, (animatingCharCount - 1) * charDelay) + FADE_DURATION
    timerRef.current = setTimeout(onAnimationDone, totalTime)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [animatingIndex, animatingCharCount, charDelay, onAnimationDone])

  return { charDelay, getBlockState, queueLength }
}

/**
 * Tokenize content into blocks with stable startOffset keys.
 */
export function tokenizeBlocks(content: string): BlockInfo[] {
  if (!content) {
    return []
  }
  const tokens = marked.lexer(content)
  let offset = 0
  const result: BlockInfo[] = []
  for (const token of tokens) {
    if (token.type === 'space') {
      offset += token.raw.length
      continue
    }
    result.push({ content: token.raw, startOffset: offset })
    offset += token.raw.length
  }
  return result
}
