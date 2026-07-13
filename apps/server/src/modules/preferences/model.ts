import { t } from 'elysia'
import { z } from 'zod'

const nullableString = t.Union([t.String(), t.Null()])
const nullableProfileRef = t.Union([
  t.String({ description: 'ID of the agent profile to use for Jarvis' }),
  t.Null(),
])
const runtimeKindRef = t.String({
  minLength: 1,
  description: 'Chat runtime ID used by Jarvis sessions',
})
const titleGenerationThinkingEffort = t.Union([
  t.Literal('minimal'),
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh'),
])
const appshotHotkeyTrigger = t.Union(
  [t.Literal('DoubleCommand'), t.Literal('DoubleOption'), t.Literal('DoubleShift')],
  { default: 'DoubleCommand' },
)
const networkProxyMode = t.Union(
  [t.Literal('system'), t.Literal('custom'), t.Literal('environment')],
  { default: 'system' },
)
const networkProxyStatusMode = t.Union(
  [t.Literal('system'), t.Literal('custom'), t.Literal('environment'), t.Literal('off')],
  { default: 'system' },
)
const networkProxySource = t.Union(
  [t.Literal('none'), t.Literal('system'), t.Literal('custom'), t.Literal('environment')],
  { default: 'none' },
)
const inboundAccessMode = t.Union([t.Literal('local'), t.Literal('network')], { default: 'local' })
const titleGenerationPreferences = t.Object(
  {
    providerTargetId: nullableString,
    modelId: nullableString,
    thinkingEffort: titleGenerationThinkingEffort,
  },
  { additionalProperties: false },
)

export const PreferencesModel = {
  appPreferences: t.Object(
    {
      featureFlags: t.Object(
        {
          multiWorkspacePoc: t.Boolean({ default: false }),
          localAuthForDangerousActions: t.Optional(t.Boolean({ default: false })),
          continueBlockedCodexGoals: t.Optional(t.Boolean({ default: false })),
          blockCodexAppServerLogInserts: t.Optional(t.Boolean({ default: false })),
          nativeProviderSkillProjection: t.Optional(t.Boolean({ default: false })),
        },
        { additionalProperties: false },
      ),
      worktreeCleanup: t.Optional(
        t.Object(
          {
            maxWorktrees: t.Number({ default: 25, minimum: 0 }),
            maxTotalSizeGb: t.Number({ default: 50, minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  chatPreferences: t.Object(
    {
      modelId: nullableString,
      configSelections: t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
      continuationBehavior: t.Union([t.Literal('queue'), t.Literal('steer')], { default: 'queue' }),
      titleGeneration: titleGenerationPreferences,
    },
    { additionalProperties: false },
  ),
  chatPreferencesUpdate: t.Object(
    {
      modelId: nullableString,
      configSelections: t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
      continuationBehavior: t.Optional(
        t.Union([t.Literal('queue'), t.Literal('steer')], { default: 'queue' }),
      ),
      titleGeneration: t.Optional(titleGenerationPreferences),
    },
    { additionalProperties: false },
  ),
  codexPreferences: t.Object(
    {
      useCradleUserAgent: t.Boolean({ default: true }),
    },
    { additionalProperties: false },
  ),
  desktopPreferences: t.Object(
    {
      requireDoubleCommandQToQuit: t.Boolean({ default: true }),
      appshotHotkeyEnabled: t.Boolean({ default: true }),
      appshotHotkeyTrigger,
      autoCheckForUpdates: t.Boolean({ default: true }),
      autoDownloadUpdates: t.Boolean({ default: false }),
      lastSeenChangelogVersion: t.Union([t.String(), t.Null()], { default: null }),
      externalTerminalApp: t.Union([t.String(), t.Null()], { default: null }),
    },
    { additionalProperties: false },
  ),
  networkPreferences: t.Object(
    {
      proxyEnabled: t.Boolean({ default: true }),
      proxyMode: networkProxyMode,
      customProxyUrl: nullableString,
      inbound: t.Optional(
        t.Object(
          {
            serverAccessMode: inboundAccessMode,
            managedRelayAccessMode: inboundAccessMode,
            managedRelayPublicUrl: nullableString,
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  networkProxyStatus: t.Object(
    {
      enabled: t.Boolean(),
      mode: networkProxyStatusMode,
      source: networkProxySource,
      proxyUrl: nullableString,
      reason: nullableString,
      checkedAt: t.String(),
    },
    { additionalProperties: false },
  ),
  jarvisPreferences: t.Object(
    {
      runtimeKind: t.Optional(runtimeKindRef),
      profileId: nullableProfileRef,
      model: t.Optional(
        t.String({ description: 'Explicit model ID for Jarvis (e.g. gpt-4o, claude-3-7-sonnet)' }),
      ),
      thinkingLevel: t.Union(
        [
          t.Literal('minimal'),
          t.Literal('low'),
          t.Literal('medium'),
          t.Literal('high'),
          t.Literal('xhigh'),
        ],
        { default: 'medium' },
      ),
    },
    { additionalProperties: false },
  ),
  keybindingsPreferences: t.Object(
    {
      configPath: t.String({ minLength: 1 }),
      rules: t.Array(
        t.Object(
          {
            command: t.String({ minLength: 1 }),
            key: t.String({ minLength: 1 }),
            when: t.Optional(t.String({ minLength: 1 })),
          },
          { additionalProperties: false },
        ),
      ),
      errors: t.Array(t.String()),
    },
    { additionalProperties: false },
  ),
  savedResponse: t.Object({
    ok: t.Literal(true),
  }),
} as const

export const KeybindingsPreferencesJsonSchema = z.array(
  z.object({
    command: z.string().min(1),
    key: z.string().min(1),
    when: z.string().min(1).optional(),
  }),
)

export const ChatPreferencesJsonSchema = z
  .union([z.string().transform(raw => JSON.parse(raw)), z.undefined()])
  .pipe(
    z
      .object({
        modelId: z.string().nullable().default(null),
        configSelections: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
        continuationBehavior: z.enum(['queue', 'steer']).default('queue'),
        titleGeneration: z
          .object({
            providerTargetId: z.string().nullable().default(null),
            modelId: z.string().nullable().default(null),
            thinkingEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('minimal'),
          })
          .default({
            providerTargetId: null,
            modelId: null,
            thinkingEffort: 'minimal',
          }),
      })
      .default({
        modelId: null,
        configSelections: {},
        continuationBehavior: 'queue',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
      }),
  )

export const AppPreferencesJsonSchema = z
  .union([z.string().transform(raw => JSON.parse(raw)), z.undefined()])
  .pipe(
    z
      .object({
        featureFlags: z
          .object({
            multiWorkspacePoc: z.boolean().default(false),
            localAuthForDangerousActions: z.boolean().default(false),
            continueBlockedCodexGoals: z.boolean().default(false),
            blockCodexAppServerLogInserts: z.boolean().default(false),
            nativeProviderSkillProjection: z.boolean().default(false),
          })
          .default({
            multiWorkspacePoc: false,
            localAuthForDangerousActions: false,
            continueBlockedCodexGoals: false,
            blockCodexAppServerLogInserts: false,
            nativeProviderSkillProjection: false,
          }),
        worktreeCleanup: z
          .object({
            maxWorktrees: z.number().min(0).default(25),
            maxTotalSizeGb: z.number().min(0).default(50),
          })
          .default({
            maxWorktrees: 25,
            maxTotalSizeGb: 50,
          }),
      })
      .default({
        featureFlags: {
          multiWorkspacePoc: false,
          localAuthForDangerousActions: false,
          continueBlockedCodexGoals: false,
          blockCodexAppServerLogInserts: false,
          nativeProviderSkillProjection: false,
        },
        worktreeCleanup: {
          maxWorktrees: 25,
          maxTotalSizeGb: 50,
        },
      }),
  )

export const CodexPreferencesJsonSchema = z
  .union([z.string().transform(raw => JSON.parse(raw)), z.undefined()])
  .pipe(
    z
      .object({
        useCradleUserAgent: z.boolean().default(true),
      })
      .default({
        useCradleUserAgent: true,
      }),
  )

export const DesktopPreferencesJsonSchema = z
  .union([z.string().transform(raw => JSON.parse(raw)), z.undefined()])
  .pipe(
    z
      .object({
        requireDoubleCommandQToQuit: z.boolean().default(true),
        appshotHotkeyEnabled: z.boolean().default(true),
        appshotHotkeyTrigger: z
          .enum(['DoubleCommand', 'DoubleOption', 'DoubleShift'])
          .default('DoubleCommand'),
        autoCheckForUpdates: z.boolean().default(true),
        autoDownloadUpdates: z.boolean().default(false),
        lastSeenChangelogVersion: z.string().nullable().default(null),
        externalTerminalApp: z.string().nullable().default(null),
      })
      .default({
        requireDoubleCommandQToQuit: true,
        appshotHotkeyEnabled: true,
        appshotHotkeyTrigger: 'DoubleCommand',
        autoCheckForUpdates: true,
        autoDownloadUpdates: false,
        lastSeenChangelogVersion: null,
        externalTerminalApp: null,
      }),
  )

export const NetworkPreferencesJsonSchema = z
  .union([z.string().transform(raw => JSON.parse(raw)), z.undefined()])
  .pipe(
    z
      .object({
        proxyEnabled: z.boolean().default(true),
        proxyMode: z.enum(['system', 'custom', 'environment']).default('system'),
        customProxyUrl: z
          .string()
          .trim()
          .transform(value => (value.length > 0 ? value : null))
          .nullable()
          .default(null),
        inbound: z
          .object({
            serverAccessMode: z.enum(['local', 'network']).default('local'),
            managedRelayAccessMode: z.enum(['local', 'network']).default('local'),
            managedRelayPublicUrl: z
              .string()
              .trim()
              .transform(value => (value.length > 0 ? value : null))
              .nullable()
              .default(null),
          })
          .default({
            serverAccessMode: 'local',
            managedRelayAccessMode: 'local',
            managedRelayPublicUrl: null,
          }),
      })
      .default({
        proxyEnabled: true,
        proxyMode: 'system',
        customProxyUrl: null,
        inbound: {
          serverAccessMode: 'local',
          managedRelayAccessMode: 'local',
          managedRelayPublicUrl: null,
        },
      }),
  )

export const JarvisPreferencesJsonSchema = z
  .union([z.string().transform(raw => JSON.parse(raw)), z.undefined()])
  .pipe(
    z
      .object({
        runtimeKind: z.string().min(1).default('jar-core'),
        profileId: z.string().nullable().default(null),
        model: z.string().optional(),
        thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('medium'),
      })
      .default({
        runtimeKind: 'jar-core',
        profileId: null,
        thinkingLevel: 'medium',
      }),
  )
