import type { AnimationPresetName, SmoothPreset } from '@cradle/streamdown'
import { PRESETS } from '@cradle/streamdown'
import * as EssentialsPlugin from '@tweakpane/plugin-essentials'
import { useEffect, useRef } from 'react'
import type { TpChangeEvent } from 'tweakpane'
import { Pane } from 'tweakpane'

import type { SampleSource } from '../data/samples'
import { SAMPLES } from '../data/samples'

type TweakpaneBinding<T> = {
  on: (eventName: 'change', handler: (ev: TpChangeEvent<T>) => void) => unknown
  off: (eventName: 'change', handler: (ev: TpChangeEvent<T>) => void) => unknown
}

type TweakpaneButton = {
  on: (eventName: 'click', handler: () => void) => unknown
  off: (eventName: 'click', handler: () => void) => unknown
}

interface ControlPanelParams {
  preset: SmoothPreset
  animateMode: 'char' | 'word'
  animationPreset: AnimationPresetName
  showCursor: boolean
  cps: number
  sampleId: string
  showProfiler: boolean
  dark: boolean
}

interface ControlPanelCallbacks {
  onPresetChange: (p: SmoothPreset) => void
  onAnimateModeChange: (m: 'char' | 'word') => void
  onAnimationPresetChange: (p: AnimationPresetName) => void
  onShowCursorChange: (v: boolean) => void
  onCpsChange: (c: number) => void
  onSampleChange: (id: string) => void
  onStart: () => void
  onStop: () => void
  onReset: () => void
  onProfilerChange: (v: boolean) => void
  onDarkChange: (v: boolean) => void
}

function mountControlPane({
  container,
  paneRef,
  paramsRef,
  callbacksRef,
  animationPreset,
}: {
  container: HTMLDivElement
  paneRef: React.MutableRefObject<Pane | null>
  paramsRef: React.MutableRefObject<ControlPanelParams>
  callbacksRef: React.MutableRefObject<ControlPanelCallbacks>
  animationPreset: AnimationPresetName
}): () => void {
  const pane = new Pane({
    container,
    title: 'Streamdown Playground',
  })
  pane.registerPlugin(EssentialsPlugin)
  paneRef.current = pane
  const cleanupListeners: Array<() => void> = []

  const listenChange = <T,>(binding: TweakpaneBinding<T>, handler: (ev: TpChangeEvent<T>) => void) => {
    binding.on('change', handler)
    cleanupListeners.push(() => binding.off('change', handler))
  }

  const listenClick = (button: TweakpaneButton, handler: () => void) => {
    button.on('click', handler)
    cleanupListeners.push(() => button.off('click', handler))
  }

  // --- Source ---
  const sourceFolder = pane.addFolder({ title: 'Source' })
  const sampleOptions: Record<string, string> = {}
  SAMPLES.forEach((s: SampleSource) => {
    sampleOptions[s.label] = s.id
  })
  listenChange(sourceFolder.addBinding(paramsRef.current, 'sampleId', {
    label: 'Sample',
    options: sampleOptions,
  }), ev => callbacksRef.current.onSampleChange(ev.value))

  listenChange(sourceFolder.addBinding(paramsRef.current, 'cps', {
    label: 'CPS',
    min: 10,
    max: 300,
    step: 1,
  }), ev => callbacksRef.current.onCpsChange(ev.value))

  // --- Smoothing ---
  const smoothFolder = pane.addFolder({ title: 'CPS Smoothing' })
  listenChange(smoothFolder.addBinding(paramsRef.current, 'preset', {
    label: 'Preset',
    options: { balanced: 'balanced', realtime: 'realtime', silky: 'silky' },
  }), ev => callbacksRef.current.onPresetChange(ev.value as SmoothPreset))

  // --- Animation ---
  const animFolder = pane.addFolder({ title: 'Animation' })
  listenChange(animFolder.addBinding(paramsRef.current, 'animationPreset', {
    label: 'Preset',
    options: { minimal: 'minimal', balanced: 'balanced', dramatic: 'dramatic' },
  }), ev => callbacksRef.current.onAnimationPresetChange(ev.value as AnimationPresetName))

  listenChange(animFolder.addBinding(paramsRef.current, 'animateMode', {
    label: 'Granularity',
    options: { word: 'word', char: 'char' },
  }), ev => callbacksRef.current.onAnimateModeChange(ev.value as 'char' | 'word'))

  listenChange(animFolder.addBinding(paramsRef.current, 'showCursor', {
    label: 'Show Cursor',
  }), ev => callbacksRef.current.onShowCursorChange(ev.value as boolean))

  // Show resolved preset info (read-only)
  const resolved = PRESETS[animationPreset]
  const infoFolder = animFolder.addFolder({ title: 'Resolved Preset', expanded: false })
  infoFolder.addBinding({ fadeDuration: resolved.fadeDuration }, 'fadeDuration', {
    label: 'Fade Duration',
    readonly: true,
  })
  infoFolder.addBinding({ timingFunction: resolved.timingFunction }, 'timingFunction', {
    label: 'Timing Fn',
    readonly: true,
  })
  infoFolder.addBinding({ blockGlow: resolved.blockGlow }, 'blockGlow', {
    label: 'Block Glow',
    readonly: true,
  })
  infoFolder.addBinding({ cursorTrail: resolved.cursorTrail }, 'cursorTrail', {
    label: 'Cursor Trail',
    readonly: true,
  })

  // --- Controls ---
  const controlFolder = pane.addFolder({ title: 'Actions' })
  listenClick(controlFolder.addButton({ title: 'Stream / Continue' }), () => {
    callbacksRef.current.onStart()
  })
  listenClick(controlFolder.addButton({ title: 'Stop' }), () => {
    callbacksRef.current.onStop()
  })
  listenClick(controlFolder.addButton({ title: 'Reset' }), () => {
    callbacksRef.current.onReset()
  })

  // --- Display ---
  const displayFolder = pane.addFolder({ title: 'Display' })
  listenChange(displayFolder.addBinding(paramsRef.current, 'showProfiler', {
    label: 'Profiler',
  }), ev => callbacksRef.current.onProfilerChange(ev.value))
  listenChange(displayFolder.addBinding(paramsRef.current, 'dark', {
    label: 'Dark Mode',
  }), ev => callbacksRef.current.onDarkChange(ev.value))

  return () => {
    for (const cleanupListener of cleanupListeners) {
      cleanupListener()
    }
    pane.dispose()
    paneRef.current = null
  }
}

interface ControlPanelProps {
  preset: SmoothPreset
  onPresetChange: (p: SmoothPreset) => void
  animateMode: 'char' | 'word'
  onAnimateModeChange: (m: 'char' | 'word') => void
  animationPreset: AnimationPresetName
  onAnimationPresetChange: (p: AnimationPresetName) => void
  showCursor: boolean
  onShowCursorChange: (v: boolean) => void
  cps: number
  onCpsChange: (c: number) => void
  sampleId: string
  onSampleChange: (id: string) => void
  streaming: boolean
  onStart: () => void
  onStop: () => void
  onReset: () => void
  showProfiler: boolean
  onProfilerChange: (v: boolean) => void
  dark: boolean
  onDarkChange: (v: boolean) => void
}

export function ControlPanel({
  preset,
  onPresetChange,
  animateMode,
  onAnimateModeChange,
  animationPreset,
  onAnimationPresetChange,
  showCursor,
  onShowCursorChange,
  cps,
  onCpsChange,
  sampleId,
  onSampleChange,
  streaming: _streaming,
  onStart,
  onStop,
  onReset,
  showProfiler,
  onProfilerChange,
  dark,
  onDarkChange,
}: ControlPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<Pane | null>(null)
  const paramsRef = useRef<ControlPanelParams>({
    preset,
    animateMode,
    animationPreset,
    showCursor,
    cps,
    sampleId,
    showProfiler,
    dark,
  })

  // Use refs for callbacks to avoid stale closures in Tweakpane
  const callbacksRef = useRef<ControlPanelCallbacks>({
    onStart,
onStop,
onReset,
onPresetChange,
onAnimateModeChange,
    onAnimationPresetChange,
onShowCursorChange,
onCpsChange,
onSampleChange,
onProfilerChange,
onDarkChange,
  })
  callbacksRef.current = {
    onStart,
onStop,
onReset,
onPresetChange,
onAnimateModeChange,
    onAnimationPresetChange,
onShowCursorChange,
onCpsChange,
onSampleChange,
onProfilerChange,
onDarkChange,
  }

  // Keep params ref in sync
  paramsRef.current = {
    preset,
    animateMode,
    animationPreset,
    showCursor,
    cps,
    sampleId,
    showProfiler,
    dark,
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    return mountControlPane({
      container,
      paneRef,
      paramsRef,
      callbacksRef,
      animationPreset,
    })
    // Only rebuild pane on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh pane values when props change externally
  useEffect(() => {
    if (paneRef.current) {
      paneRef.current.refresh()
    }
  }, [preset, animateMode, animationPreset, showCursor, cps, sampleId, showProfiler, dark])

  return (
    <div
      ref={containerRef}
      className="fixed right-4 top-4 z-50 max-h-[calc(100vh-2rem)] w-70 overflow-y-auto"
    />
  )
}
