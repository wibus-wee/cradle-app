import { z } from 'zod'

const PluginEntryPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(value => !value.includes('\\') && !value.startsWith('/'), {
    message: 'must be a safe relative path',
  })
  .refine((value) => {
    const normalizedEntry = value.startsWith('./') ? value.slice(2) : value
    const segments = normalizedEntry.split('/')
    return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
  }, {
    message: 'must not contain empty or traversal segments',
  })

const NonEmptyStringSchema = z.string().trim().min(1)

const CradlePluginCapabilityContributionSchema = z.object({
  id: NonEmptyStringSchema,
  type: NonEmptyStringSchema,
  layer: z.enum(['server', 'web', 'desktop']).optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  permissions: z.array(NonEmptyStringSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const CradlePluginPermissionContributionSchema = z.object({
  id: NonEmptyStringSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
})

const CradlePluginContributionsSchema = z.object({
  capabilities: z.array(CradlePluginCapabilityContributionSchema),
  permissions: z.array(CradlePluginPermissionContributionSchema),
})

const CradlePluginMetaSchema = z
  .object({
    apiVersion: z.literal('1'),
    displayName: z.string().optional(),
    description: z.string().optional(),
    icon: PluginEntryPathSchema.optional(),
    deployments: z.array(z.enum(['desktop', 'web'])).optional(),
    server: PluginEntryPathSchema.optional(),
    web: PluginEntryPathSchema.optional(),
    desktop: PluginEntryPathSchema.optional(),
    contributes: CradlePluginContributionsSchema,
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if ('capabilities' in value) {
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'cradle.capabilities is not supported in apiVersion 1; use cradle.contributes.capabilities.',
      })
    }
    if ('permissions' in value) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'cradle.permissions is not supported in apiVersion 1; use cradle.contributes.permissions.',
      })
    }
  })
  .transform(({ apiVersion, displayName, description, icon, deployments, server, web, desktop, contributes }) => ({
    apiVersion,
    displayName,
    description,
    icon,
    deployments,
    server,
    web,
    desktop,
    contributes,
  }))

export const CradlePluginPackageJsonSchema = z.object({
  name: NonEmptyStringSchema,
  version: z.string().default('0.0.0'),
  cradle: CradlePluginMetaSchema,
})

export type ParsedCradlePluginPackage = z.infer<typeof CradlePluginPackageJsonSchema>

export const CradlePluginPackageJsonTextSchema = z
  .string()
  .transform(value => JSON.parse(value))
  .pipe(CradlePluginPackageJsonSchema)

export class CradlePluginManifestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CradlePluginManifestError'
  }
}

function formatManifestParseError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'package.json'
        return `${path}: ${issue.message}`
      })
      .join('; ')
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function parseCradlePluginPackageJson(value: unknown): ParsedCradlePluginPackage {
  try {
    return CradlePluginPackageJsonSchema.parse(value)
  }
 catch (error) {
    throw new CradlePluginManifestError(formatManifestParseError(error), { cause: error })
  }
}

export function parseCradlePluginPackageJsonText(value: string): ParsedCradlePluginPackage {
  try {
    return CradlePluginPackageJsonTextSchema.parse(value)
  }
 catch (error) {
    throw new CradlePluginManifestError(formatManifestParseError(error), { cause: error })
  }
}

export function validatePluginEntryPath(value: unknown, path = 'entry'): string {
  try {
    return PluginEntryPathSchema.parse(value)
  }
  catch (error) {
    throw new CradlePluginManifestError(
      error instanceof z.ZodError
        ? error.issues
          .map(issue => `${path}: ${issue.message}`)
          .join('; ')
        : formatManifestParseError(error),
      { cause: error },
    )
  }
}
