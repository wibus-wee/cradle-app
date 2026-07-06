// Core renderers
export { StaticRender } from './static-render'
export { Streamdown } from './streamdown'
export { StreamdownRender } from './streamdown-render'
export { defaultUrlTransform as defaultMarkdownUrlTransform } from 'react-markdown'

// Hooks
export { useDelayedAnimated } from './hooks/use-delayed-animated'
export { computeSettlingDrain, shouldSleepSmoother } from './hooks/use-settling-drain'
export { useSmoothContent } from './hooks/use-smooth-content'

// Components
export { CodeBlockStreaming } from './blocks/code-block-streaming'
export { CitationPopover } from './components/citation-popover'
export { StreamErrorBoundary } from './components/error-boundary'
export { fadeComponents, makeFader } from './components/fade-components'
export { HighlightedCode, HighlightedPre } from './components/highlighted-code'
export {
  handleExternalMarkdownLinkClick,
  isExternalMarkdownHref,
  MarkdownLink,
  resolveExternalMarkdownHref,
} from './components/markdown-link'
export { StreamingErrorBoundary } from './components/streaming-error-boundary'

// Context
export { StreamingProvider, useStreamingContext } from './context/streaming-context'

// Scroll layer
export { AutoScroll } from './scroll/auto-scroll'
export { BackBottomButton } from './scroll/back-bottom-button'
export { ConversationSpacer } from './scroll/conversation-spacer'
export { getKeepMountedIndices, shouldKeepMounted } from './scroll/keep-mounted'
export { useScrollIntent } from './scroll/scroll-intent'
export { buildMessageIndexMap, scrollToMessage } from './scroll/scroll-to-message'
export { useSpringScroll } from './scroll/spring-scroll'
export { clearScrollPositions, useTopicScrollPersist } from './scroll/topic-scroll-persist'

// Profiler & Debug
export { DebugInspector } from './profiler/debug-inspector'
export { getDebugState, resetDebugState, updateDebugState, useStreamDebugState } from './profiler/debug-store'
export { StreamProfiler } from './profiler/profiler'
export { StreamdownProfilerProvider, useProfilerContext } from './profiler/profiler-provider'
export { logScrollEvent, updateScrollDebug, useScrollDebugState } from './profiler/scroll-debug-state'

// Animation presets
export { PRESETS } from './presets/types'

// Utilities
export { findOpenFenceLanguage, shouldBypassSmoother } from './core/fence-state'
export { patchIncomplete } from './plugins/remark-incomplete'

// Types
export type { Citation } from './components/citation-popover'
export type { FadableTag } from './components/fade-components'
export type { AnimationPreset, AnimationPresetName } from './presets/types'
export type { StreamDebugState } from './profiler/debug-store'
export type { FrameMetrics, ProfilerSnapshot } from './profiler/profiler'
export type { ScrollDebugState, ScrollLogEntry } from './profiler/scroll-debug-state'
export type { BlockState, SmoothPreset, StreamdownProps } from './types'
export type {
  Components as MarkdownComponents,
  UrlTransform as MarkdownUrlTransform,
} from 'react-markdown'
