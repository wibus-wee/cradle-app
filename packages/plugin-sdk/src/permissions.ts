/* Evaluates host-provided permission grants for plugin layer activation. */

import { z } from 'zod'

import type { PluginDescriptor, PluginLayer, PluginSourceKind } from './index'

export interface PluginPermissionDecision {
  allowed: boolean
  missingRequiredPermissions: string[]
  reason?: string
}

export interface PluginRuntimeCapabilityRegistration {
  type: string
  layer: PluginLayer
  localId: string
  candidateDeclaredLocalIds?: string[]
}

export interface PluginRuntimeCapabilityDecision {
  allowed: boolean
  matchedDeclaredCapabilityId?: string
  reason?: string
  warning?: string
}

function permissionEnvKey(routeSegment: string): string {
  return `CRADLE_PLUGIN_ALLOWED_${routeSegment.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PERMISSIONS`
}

const PermissionTextListSchema = z.string()
  .optional()
  .default('')
  .transform(value => value.split(',').map(permission => permission.trim()).filter(Boolean))

const GrantedPermissionListSchema = z.array(z.string())
  .optional()
  .default([])
  .transform(values => values.map(permission => permission.trim()).filter(Boolean))

const RuntimeCapabilityRegistrationSchema = z.object({
  type: z.string(),
  layer: z.enum(['server', 'web', 'desktop']),
  localId: z.string(),
  candidateDeclaredLocalIds: z.array(z.string()).default([]),
})

function requiredPermissionsForLayer(descriptor: PluginDescriptor, layer: PluginLayer): string[] {
  const required = new Set<string>()
  for (const permission of descriptor.declaredPermissions) {
    if (permission.required === true) {
      required.add(permission.localId)
    }
  }
  for (const capability of descriptor.declaredCapabilities) {
    if (capability.layer !== undefined && capability.layer !== layer) { continue }
    for (const permission of capability.permissions) {
      required.add(permission)
    }
  }
  return [...required].sort()
}

function isPermissionEnforcedSource(sourceKind: PluginSourceKind): boolean {
  return sourceKind === 'externalLocal'
}

function isDeclaredCapabilityInLayer(
  declaredLayer: PluginLayer | undefined,
  runtimeLayer: PluginLayer,
): boolean {
  return declaredLayer === undefined || declaredLayer === runtimeLayer
}

export function evaluatePluginPermissionPolicy(
  descriptor: PluginDescriptor,
  layer: PluginLayer,
  env: Record<string, string | undefined> = {},
): PluginPermissionDecision {
  const requiredPermissions = requiredPermissionsForLayer(descriptor, layer)
  if (requiredPermissions.length === 0) {
    return { allowed: true, missingRequiredPermissions: [] }
  }

  if (!isPermissionEnforcedSource(descriptor.source.kind)) {
    return {
      allowed: true,
      missingRequiredPermissions: [],
      reason: 'First-party or bundled plugin permissions are trusted by source policy.',
    }
  }

  const allowedPermissions = new Set([
    ...PermissionTextListSchema.parse(env.CRADLE_PLUGIN_ALLOWED_PERMISSIONS),
    ...PermissionTextListSchema.parse(env[permissionEnvKey(descriptor.routeSegment)]),
    ...GrantedPermissionListSchema.parse(descriptor.source.grantedPermissions),
  ])
  const missingRequiredPermissions = requiredPermissions.filter(permission => !allowedPermissions.has(permission))

  return {
    allowed: missingRequiredPermissions.length === 0,
    missingRequiredPermissions,
    reason: missingRequiredPermissions.length > 0
      ? `Missing required plugin permission grants: ${missingRequiredPermissions.join(', ')}.`
      : 'Required plugin permissions are explicitly granted by operator or Marketplace install consent.',
  }
}

export function evaluatePluginRuntimeCapabilityPolicy(
  descriptor: PluginDescriptor,
  registration: PluginRuntimeCapabilityRegistration,
): PluginRuntimeCapabilityDecision {
  const parsedRegistration = RuntimeCapabilityRegistrationSchema.parse(registration)
  const candidates = new Set([
    parsedRegistration.localId,
    ...parsedRegistration.candidateDeclaredLocalIds,
  ])
  const declaredByTypeAndLayer = descriptor.declaredCapabilities.filter(capability =>
    capability.type === parsedRegistration.type && isDeclaredCapabilityInLayer(capability.layer, parsedRegistration.layer))
  const exactMatch = declaredByTypeAndLayer.find(capability => candidates.has(capability.localId))
  if (exactMatch) {
    return {
      allowed: true,
      matchedDeclaredCapabilityId: exactMatch.id,
    }
  }

  const reason = `Runtime capability ${registration.type}:${registration.localId} is not declared in cradle.contributes.capabilities.`
  if (isPermissionEnforcedSource(descriptor.source.kind)) {
    return {
      allowed: false,
      reason,
    }
  }

  const typeMatch = declaredByTypeAndLayer[0]
  if (typeMatch) {
    return {
      allowed: true,
      matchedDeclaredCapabilityId: typeMatch.id,
      warning: `Runtime capability ${registration.type}:${registration.localId} matched declared capability category ${typeMatch.localId}, but not an exact declared local id.`,
    }
  }

  return {
    allowed: true,
    warning: reason,
  }
}
