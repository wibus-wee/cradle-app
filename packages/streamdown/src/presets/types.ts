/**
 * Animation preset configuration.
 * Controls visual parameters of the streaming animation.
 * The correctness layer (birth timestamps, block state machine) is never affected.
 */
export interface AnimationPreset {
  /** Unique preset identifier */
  name: string

  /** CSS class applied to the streaming container */
  containerClass: string

  /** Duration of the reveal animation in ms */
  fadeDuration: number

  /** CSS timing function */
  timingFunction: string

  /** Blur amount during reveal (0 = no blur) */
  revealBlur: string

  /** TranslateY distance during reveal (0px = no movement) */
  revealTranslateY: string

  /** Whether active streaming blocks have glow effect */
  blockGlow: boolean

  /** Whether cursor has trail effect */
  cursorTrail: boolean

  /** Whether blocks get entrance animation */
  blockEntrance: boolean
}

export const PRESETS = {
  minimal: {
    name: 'minimal',
    containerClass: 'stream-preset-minimal',
    fadeDuration: 200,
    timingFunction: 'ease-out',
    revealBlur: '0px',
    revealTranslateY: '0px',
    blockGlow: false,
    cursorTrail: false,
    blockEntrance: false,
  },
  balanced: {
    name: 'balanced',
    containerClass: 'stream-preset-balanced',
    fadeDuration: 280,
    timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    revealBlur: '0px',
    revealTranslateY: '2px',
    blockGlow: true,
    cursorTrail: false,
    blockEntrance: false,
  },
  dramatic: {
    name: 'dramatic',
    containerClass: 'stream-preset-dramatic',
    fadeDuration: 350,
    timingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    revealBlur: '2px',
    revealTranslateY: '4px',
    blockGlow: true,
    cursorTrail: true,
    blockEntrance: true,
  },
} as const satisfies Record<string, AnimationPreset>

export type AnimationPresetName = keyof typeof PRESETS
