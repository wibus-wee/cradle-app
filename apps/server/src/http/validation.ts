import type { ValidationError } from 'elysia'
import { z } from 'zod'

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationErrorProfile {
  code: string
  message: string
  status?: number
}

const RE_LEADING_SLASHES = /^\/+/
const RE_SLASH = /\//g
const ValidationIssueSummarySchema = z.object({
  summary: z.string().optional(),
}).passthrough()

export function normalizeTypeBoxPath(path: string | undefined): string {
  if (!path || path === '/' || path === 'root') {
    return 'root'
  }

  const normalized = path.replace(RE_LEADING_SLASHES, '').replace(RE_SLASH, '.')
  return normalized.length > 0 ? normalized : 'root'
}

export function normalizeValidationIssues(error: Readonly<ValidationError>): ValidationIssue[] {
  const issues = error.all.length > 0
    ? error.all
    : error.valueError
      ? [error.valueError]
      : []

  return issues.map((issue) => {
    const { summary } = ValidationIssueSummarySchema.parse(issue)
    return {
      path: normalizeTypeBoxPath(issue.path),
      message: summary ?? issue.message,
    }
  })
}

export function normalizeValidationError(
  error: Readonly<ValidationError>,
  profile: ValidationErrorProfile,
) {
  return {
    status: profile.status ?? 400,
    body: {
      code: profile.code,
      message: profile.message,
      details: {
        source: error.type,
        issues: normalizeValidationIssues(error),
      },
    },
  }
}
