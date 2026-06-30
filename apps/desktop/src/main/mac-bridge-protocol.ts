/* Defines the NDJSON protocol shared by Electron main and Cradle Mac Bridge. */
import { z } from 'zod'

export const MacBridgeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

export const MacBridgeResponseSchema = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: MacBridgeErrorSchema.optional(),
})

export const MacBridgeEventSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
})

export const MacBridgeStatusSchema = z.object({
  name: z.literal('cradle-mac-bridge'),
  version: z.string(),
  pid: z.number().int().positive(),
  platform: z.string(),
})

export const MacPermissionStateSchema = z.enum([
  'granted',
  'denied',
  'notDetermined',
  'unsupported',
  'unknown',
])

export const MacPermissionsStatusSchema = z.object({
  accessibility: MacPermissionStateSchema,
  screenRecording: MacPermissionStateSchema,
  inputMonitoring: MacPermissionStateSchema,
})

export const MacPermissionKindSchema = z.enum([
  'accessibility',
  'screenRecording',
  'inputMonitoring',
])

export const MacPermissionsRequestSchema = z.object({
  permissions: z.array(MacPermissionKindSchema).optional(),
})

export const MacPermissionsRequestResultSchema = z.object({
  requested: z.array(MacPermissionKindSchema),
  status: MacPermissionsStatusSchema,
})

export const MacPermissionSettingsTargetSchema = z.enum([
  'privacy',
  'accessibility',
  'screenRecording',
  'inputMonitoring',
])

export const MacPermissionSettingsRequestSchema = z.object({
  target: MacPermissionSettingsTargetSchema.optional(),
})

export const MacPermissionSettingsResultSchema = z.object({
  target: MacPermissionSettingsTargetSchema,
  url: z.string(),
  opened: z.boolean(),
})

export const MacInputBareModifierSchema = z.enum([
  'DoubleCommand',
  'DoubleOption',
  'DoubleShift',
])

export const MacInputConfigureRequestSchema = z.object({
  trigger: MacInputBareModifierSchema,
  enabled: z.boolean(),
})

export const MacInputConfigureResultSchema = z.object({
  trigger: MacInputBareModifierSchema,
  enabled: z.boolean(),
  diagnostics: z.unknown().optional(),
})

export const MacInputSyntheticBothCommandRequestSchema = z.object({
  holdMilliseconds: z.number().min(20).max(1000).optional(),
})

export const MacInputSyntheticBothCommandResultSchema = z.object({
  trigger: z.literal('bothCommand'),
  holdMilliseconds: z.number().min(20).max(1000),
  postedEventCount: z.number().int().nonnegative(),
  postedAt: z.string(),
})

export const MacInputSyntheticBareModifierRequestSchema = z.object({
  modifier: MacInputBareModifierSchema,
  holdMilliseconds: z.number().min(20).max(1000).optional(),
})

export const MacInputSyntheticBareModifierResultSchema = z.object({
  trigger: MacInputBareModifierSchema,
  modifier: MacInputBareModifierSchema.optional(),
  holdMilliseconds: z.number().min(20).max(1000),
  postedEventCount: z.number().int().nonnegative(),
  postedAt: z.string(),
})

export const MacCaptureWindowTargetSchema = z.object({
  windowId: z.number().int().nonnegative(),
  processId: z.number().int().nonnegative().optional(),
  bundleId: z.string().min(1).optional(),
})

export const MacCaptureFrontmostWindowRequestSchema = z.object({
  outputDir: z.string().min(1),
  targetWindow: MacCaptureWindowTargetSchema.optional(),
  privacySensitiveAppBundleIds: z.array(z.string()).optional(),
  privacySensitiveTitlePatterns: z.array(z.string()).optional(),
})

export const MacWindowFrameEvidenceSchema = z.object({
  coreGraphicsBounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).nullable(),
  accessibilityFrame: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).nullable(),
})

export const MacCapturedWindowSchema = z.object({
  windowId: z.number().int().nonnegative(),
  appName: z.string().nullable(),
  bundleId: z.string().nullable(),
  appIconDataUrl: z.string().nullable().optional(),
  axTree: z.string().nullable().optional(),
  processId: z.number().int().nonnegative(),
  title: z.string().nullable(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).nullable(),
  frameEvidence: MacWindowFrameEvidenceSchema.optional(),
})

export const MacCaptureImageSizeSchema = z.object({
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
})

export const MacCaptureFrontmostWindowResultSchema = z.object({
  filePath: z.string(),
  metadataPath: z.string(),
  capturedAt: z.string(),
  captureBackend: z.enum([
    'screen-capture-kit',
    'screencapture-fallback',
    'screencapture',
  ]).optional(),
  captureImageSize: MacCaptureImageSizeSchema.nullable().optional(),
  screenCaptureKitError: z.unknown().optional().nullable(),
  window: MacCapturedWindowSchema,
})

export const MacAppshotColorSchema = z.string().min(1)

export const MacAppshotRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const MacAppshotDisplaySchema = z.object({
  id: z.number().int(),
  scaleFactor: z.number().positive(),
  bounds: MacAppshotRectSchema,
  workArea: MacAppshotRectSchema,
})

export const MacAppshotAnimationTargetSchema = z.object({
  coordinateSpace: z.enum(['viewportPixels', 'screenPoints', 'pixels']).optional(),
  codexDisplay: MacAppshotDisplaySchema,
  destinationBackgroundColor: MacAppshotColorSchema,
  destinationCornerRadius: z.number().nonnegative(),
  destinationFrame: MacAppshotRectSchema,
  destinationPrimaryTextColor: MacAppshotColorSchema,
  transitionSnapshotScale: z.number().positive().optional(),
})

export const MacAppshotCaptureFrontmostWindowRequestSchema = MacCaptureFrontmostWindowRequestSchema.extend({
  animationTarget: MacAppshotAnimationTargetSchema.optional(),
  animationDuration: z.number().positive().optional(),
  soundEnabled: z.boolean().optional(),
  transitionSnapshotHeight: z.number().positive().optional(),
  transitionSpringDampingFraction: z.number().positive().optional(),
  transitionSpringResponse: z.number().positive().optional(),
})

export const MacAppshotFrontmostContextSchema = z.object({
  window: MacCapturedWindowSchema,
  bundleIdentifier: z.string().nullable(),
  animationTarget: MacAppshotAnimationTargetSchema,
})

export const MacAppshotCaptureFrontmostWindowResultSchema = MacCaptureFrontmostWindowResultSchema.extend({
  appshot: z.object({
    strategy: z.literal('cradle-native'),
    animationDuration: z.number().nonnegative(),
    transitionSnapshotPath: z.string().nullable(),
    transitionSnapshotHeight: z.number().positive().nullable(),
    transitionSnapshotImageSize: MacCaptureImageSizeSchema.nullable().optional(),
    transitionSpringDampingFraction: z.number().positive().nullable(),
    transitionSpringResponse: z.number().positive().nullable(),
    transitionGeometry: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const MacAppshotProbeTransitionRequestSchema = z.object({
  outputDir: z.string().min(1),
  screenshotPath: z.string().min(1),
  sourceWindow: MacCapturedWindowSchema.optional(),
  animationTarget: MacAppshotAnimationTargetSchema.optional(),
  animationDuration: z.number().positive().optional(),
  soundEnabled: z.boolean().optional(),
  sampleCount: z.number().int().positive().optional(),
  sampleIntervalSeconds: z.number().positive().optional(),
  renderImages: z.boolean().optional(),
  transitionSnapshotHeight: z.number().positive().optional(),
  transitionSpringDampingFraction: z.number().positive().optional(),
  transitionSpringResponse: z.number().positive().optional(),
})

export const MacAppshotProbeSampleSchema = z.object({
  index: z.number().int().nonnegative(),
  capturedAt: z.string(),
  imagePath: z.string().nullable().optional(),
  imageStatus: z.string(),
}).passthrough()

export const MacAppshotProbeTransitionResultSchema = z.object({
  panelWindowNumber: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  sampleIntervalSeconds: z.number().nonnegative(),
  animationDuration: z.number().nonnegative(),
  samples: z.array(MacAppshotProbeSampleSchema),
}).passthrough()

export const MacDisplayRecordingBackendSchema = z.enum([
  'screen-capture-kit-display',
  'screen-capture-kit-window',
  'core-graphics-window-list-polling',
  'core-graphics-window-polling',
])

export const MacRecordingRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const MacDisplayRecordingStartRequestSchema = z.object({
  outputPath: z.string().min(1),
  recordingId: z.string().min(1).optional(),
  frameRate: z.number().positive().optional(),
  displayId: z.number().int().nonnegative().optional(),
})

export const MacWindowRecordingStartRequestSchema = z.object({
  outputPath: z.string().min(1),
  recordingId: z.string().min(1).optional(),
  frameRate: z.number().positive().optional(),
  windowId: z.number().int().positive().optional(),
  processId: z.number().int().positive().optional(),
  bundleIdentifier: z.string().min(1).optional(),
  displayBounds: MacRecordingRectSchema.optional(),
  discoveryTimeoutSeconds: z.number().positive().optional(),
  discoveryPollIntervalSeconds: z.number().positive().optional(),
  captureSecondsAfterDiscovery: z.number().positive().optional(),
  recordingBackend: z.enum(['screen-capture-kit-window', 'core-graphics-window-polling']).optional(),
})

export const MacDisplayRecordingStartResultSchema = z.object({
  recordingId: z.string().min(1),
  outputPath: z.string().min(1),
  backend: MacDisplayRecordingBackendSchema,
  displayId: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
  windowId: z.number().int().positive().nullable().optional(),
  processId: z.number().int().positive().nullable().optional(),
  bundleIdentifier: z.string().nullable().optional(),
  displayBounds: MacRecordingRectSchema.nullable().optional(),
  windowBounds: MacRecordingRectSchema.nullable().optional(),
  ownerName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  imageMissCount: z.number().int().nonnegative().optional(),
  discoveryTimeoutSeconds: z.number().positive().optional(),
  discoveryPollIntervalSeconds: z.number().positive().optional(),
  captureSecondsAfterDiscovery: z.number().positive().optional(),
  fallbackFrom: MacDisplayRecordingBackendSchema.optional(),
  fallbackError: z.unknown().optional().nullable(),
  startedAt: z.string(),
})

export const MacDisplayRecordingFinishRequestSchema = z.object({
  recordingId: z.string().min(1),
})

export const MacDisplayRecordingFinishResultSchema = MacDisplayRecordingStartResultSchema.omit({
  startedAt: true,
}).extend({
  frameCount: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  finishedAt: z.string(),
})

export const MacScreenCaptureKitDiagnosticsSchema = z.object({
  supported: z.boolean(),
  permissions: MacPermissionsStatusSchema.optional(),
  status: z.string(),
}).passthrough()

export const MacHotkeyTriggeredEventSchema = z.object({
  trigger: MacInputBareModifierSchema,
  capturedAt: z.string(),
  targetWindow: MacCaptureWindowTargetSchema.optional(),
  sourceWindow: MacCapturedWindowSchema.optional(),
  bundleIdentifier: z.string().nullable().optional(),
  context: MacAppshotFrontmostContextSchema.optional(),
})

export type MacBridgeError = z.infer<typeof MacBridgeErrorSchema>
export type MacBridgeStatus = z.infer<typeof MacBridgeStatusSchema>
export type MacPermissionKind = z.infer<typeof MacPermissionKindSchema>
export type MacPermissionsStatus = z.infer<typeof MacPermissionsStatusSchema>
export type MacPermissionsRequest = z.infer<typeof MacPermissionsRequestSchema>
export type MacPermissionsRequestResult = z.infer<typeof MacPermissionsRequestResultSchema>
export type MacPermissionSettingsTarget = z.infer<typeof MacPermissionSettingsTargetSchema>
export type MacPermissionSettingsRequest = z.infer<typeof MacPermissionSettingsRequestSchema>
export type MacPermissionSettingsResult = z.infer<typeof MacPermissionSettingsResultSchema>
export type MacInputConfigureRequest = z.infer<typeof MacInputConfigureRequestSchema>
export type MacInputConfigureResult = z.infer<typeof MacInputConfigureResultSchema>
export type MacInputSyntheticBothCommandRequest = z.infer<typeof MacInputSyntheticBothCommandRequestSchema>
export type MacInputSyntheticBothCommandResult = z.infer<typeof MacInputSyntheticBothCommandResultSchema>
export type MacInputBareModifier = z.infer<typeof MacInputBareModifierSchema>
export type MacInputSyntheticBareModifierRequest = z.infer<typeof MacInputSyntheticBareModifierRequestSchema>
export type MacInputSyntheticBareModifierResult = z.infer<typeof MacInputSyntheticBareModifierResultSchema>
export type MacCaptureWindowTarget = z.infer<typeof MacCaptureWindowTargetSchema>
export type MacCaptureFrontmostWindowRequest = z.infer<typeof MacCaptureFrontmostWindowRequestSchema>
export type MacCaptureFrontmostWindowResult = z.infer<typeof MacCaptureFrontmostWindowResultSchema>
export type MacAppshotAnimationTarget = z.infer<typeof MacAppshotAnimationTargetSchema>
export type MacAppshotFrontmostContext = z.infer<typeof MacAppshotFrontmostContextSchema>
export type MacAppshotCaptureFrontmostWindowRequest = z.infer<typeof MacAppshotCaptureFrontmostWindowRequestSchema>
export type MacAppshotCaptureFrontmostWindowResult = z.infer<typeof MacAppshotCaptureFrontmostWindowResultSchema>
export type MacAppshotProbeTransitionRequest = z.infer<typeof MacAppshotProbeTransitionRequestSchema>
export type MacAppshotProbeTransitionResult = z.infer<typeof MacAppshotProbeTransitionResultSchema>
export type MacDisplayRecordingStartRequest = z.infer<typeof MacDisplayRecordingStartRequestSchema>
export type MacWindowRecordingStartRequest = z.infer<typeof MacWindowRecordingStartRequestSchema>
export type MacDisplayRecordingStartResult = z.infer<typeof MacDisplayRecordingStartResultSchema>
export type MacDisplayRecordingFinishRequest = z.infer<typeof MacDisplayRecordingFinishRequestSchema>
export type MacDisplayRecordingFinishResult = z.infer<typeof MacDisplayRecordingFinishResultSchema>
export type MacScreenCaptureKitDiagnostics = z.infer<typeof MacScreenCaptureKitDiagnosticsSchema>
export type MacHotkeyTriggeredEvent = z.infer<typeof MacHotkeyTriggeredEventSchema>

export interface MacBridgeRuntimeStatus {
  available: boolean
  running: boolean
  platform: NodeJS.Platform
  binaryPath: string | null
  pid: number | null
  startedAt: string | null
  lastError: string | null
}
