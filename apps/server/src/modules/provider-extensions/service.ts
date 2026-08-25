import { createHash } from 'node:crypto'

import type { ProviderExtensionBinding, ProviderTarget } from '@cradle/db'
import {
  agentCredentials,
  providerExtensionBindings,
  providerTargets,
} from '@cradle/db'
import type {
  ProviderExtension,
  ProviderExtensionActivation,
  ProviderExtensionCredentialMaterial,
  ProviderExtensionJsonValue,
} from '@cradle/plugin-sdk/server'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { findProviderExtension, listProviderExtensions } from '../../plugins/provider-extension-registry'
import {
  readSecretValueWithMetadata,
  removeSecret,
  upsertSecret,
  upsertSecretInDb,
} from '../secrets/service'
import { createProviderExtensionTargetDescriptor } from './descriptor'
import { publishProviderExtensionLifecycle } from './events'
import { getProviderExtensionHost } from './host'
import type {
  ProviderExtensionBindingView,
  ProviderExtensionLifecycleEventType,
  ProviderExtensionRuntimeRoute,
  ProviderExtensionStatus,
} from './types'

const operations = new Map<string, Promise<void>>()
const EMPTY_JSON = '{}'
const logger = createChildLogger({ module: 'provider-extensions' })

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function deriveBindingId(providerTargetId: string, extensionOwner: string, extensionId: string): string {
  const hash = createHash('sha256')
    .update(`${providerTargetId}\0${extensionOwner}\0${extensionId}`)
    .digest('hex')
    .slice(0, 32)
  return `provider_extension_binding_${hash}`
}

function deriveOutputCredentialId(bindingId: string): string {
  return `system-provider-extension-${createHash('sha256').update(bindingId).digest('hex').slice(0, 32)}`
}

async function serializeBindingOperation<T>(bindingId: string, operation: () => Promise<T>): Promise<T> {
  const prior = operations.get(bindingId) ?? Promise.resolve()
  let release: () => void = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = prior.then(() => current)
  operations.set(bindingId, tail)
  await prior
  try {
    return await operation()
  }
  finally {
    release()
    if (operations.get(bindingId) === tail) {
      operations.delete(bindingId)
    }
  }
}

function readJsonObject(raw: string): { [key: string]: ProviderExtensionJsonValue } {
  return JSON.parse(raw) as { [key: string]: ProviderExtensionJsonValue }
}

function readProviderKinds(binding: ProviderExtensionBinding): ProviderExtensionBindingView['providerKinds'] {
  if (!binding.activationJson || binding.activationJson === EMPTY_JSON) {
    return []
  }
  const activation = readJsonObject(binding.activationJson)
  return Array.isArray(activation.providerKinds)
    ? activation.providerKinds as ProviderExtensionBindingView['providerKinds']
    : []
}

function readTarget(providerTargetId: string): ProviderTarget {
  const target = db().select().from(providerTargets).where(eq(providerTargets.id, providerTargetId)).get()
  if (!target) {
    throw new AppError({
      code: 'provider_target_not_found',
      status: 404,
      message: 'Provider target not found',
      details: { providerTargetId },
    })
  }
  return target
}

function readCredentialMetadata(target: ProviderTarget) {
  if (!target.credentialRef) {
    return null
  }
  return db().select({
    id: agentCredentials.id,
    kind: agentCredentials.kind,
    label: agentCredentials.label,
    updatedAt: agentCredentials.updatedAt,
  }).from(agentCredentials).where(eq(agentCredentials.id, target.credentialRef)).get() ?? null
}

function createDescriptor(target: ProviderTarget) {
  return createProviderExtensionTargetDescriptor({
    target,
    credentialKind: readCredentialMetadata(target)?.kind ?? null,
  })
}

function readSourceCredential(target: ProviderTarget): ProviderExtensionCredentialMaterial | null {
  if (!target.credentialRef) {
    return null
  }
  const credential = readSecretValueWithMetadata(target.credentialRef)
  return {
    kind: credential.kind === 'chatgpt-auth' ? 'chatgpt-auth' : 'api-key',
    value: credential.secret,
  }
}

function sourceFingerprint(target: ProviderTarget): string {
  const credential = readCredentialMetadata(target)
  return createHash('sha256').update(JSON.stringify({
    providerKind: target.providerKind,
    connectionConfigJson: target.connectionConfigJson,
    enabledModelsJson: target.enabledModelsJson,
    customModelsJson: target.customModelsJson,
    credential: credential
      ? { id: credential.id, kind: credential.kind, updatedAt: credential.updatedAt }
      : null,
  })).digest('hex')
}

function assertNoActiveRun(providerTargetId: string): void {
  const activeRunId = getProviderExtensionHost().findActiveRunId(providerTargetId)
  if (activeRunId) {
    throw new AppError({
      code: 'provider_extension_active_run_conflict',
      status: 409,
      message: 'Provider extension routing cannot change while a run is active',
      details: { providerTargetId, runId: activeRunId },
    })
  }
}

function allowedProviderKinds(extension: ProviderExtension, target: ProviderTarget): Set<string> {
  return new Set(extension.conversions
    .filter(conversion => conversion.fromProviderKind === target.providerKind)
    .flatMap(conversion => conversion.routedProviderKinds))
}

function addedProviderKinds(extension: ProviderExtension, target: ProviderTarget): Set<string> {
  return new Set(extension.conversions
    .filter(conversion => conversion.fromProviderKind === target.providerKind)
    .flatMap(conversion => conversion.addedProviderKinds))
}

function bindingIsApplicable(binding: ProviderExtensionBinding, target: ProviderTarget): boolean {
  const registered = findProviderExtension(binding.extensionOwner, binding.extensionId)
  return registered?.extension.getApplicability(createDescriptor(target)).applicable ?? false
}

function validateActivation(
  extension: ProviderExtension,
  target: ProviderTarget,
  activation: ProviderExtensionActivation,
): void {
  const allowed = allowedProviderKinds(extension, target)
  if (activation.providerKinds.length === 0 || activation.providerKinds.some(kind => !allowed.has(kind))) {
    throw new Error('Provider extension returned undeclared runtime Provider kinds')
  }
  JSON.stringify(activation.state)
}

function persistActivation(
  binding: ProviderExtensionBinding,
  activation: ProviderExtensionActivation,
  fingerprint: string | null,
): ProviderExtensionBinding {
  let outputCredentialRef: string | null = null
  if (activation.outputCredential) {
    outputCredentialRef = deriveOutputCredentialId(binding.id)
    upsertSecret({
      id: outputCredentialRef,
      kind: `system-provider-extension-${activation.outputCredential.kind}`,
      label: activation.outputCredential.label,
      secret: activation.outputCredential.value,
    })
  }

  const now = nowUnix()
  db().update(providerExtensionBindings).set({
    activationJson: JSON.stringify({
      providerKinds: activation.providerKinds,
      state: activation.state,
    }),
    outputCredentialRef,
    sourceFingerprint: fingerprint,
    status: 'enabled',
    lastError: null,
    updatedAt: now,
  }).where(eq(providerExtensionBindings.id, binding.id)).run()
  return readBinding(binding.id)
}

function readBinding(bindingId: string): ProviderExtensionBinding {
  const binding = db().select().from(providerExtensionBindings).where(eq(providerExtensionBindings.id, bindingId)).get()
  if (!binding) {
    throw new AppError({
      code: 'provider_extension_binding_not_found',
      status: 404,
      message: 'Provider extension binding not found',
      details: { bindingId },
    })
  }
  return binding
}

function findBinding(providerTargetId: string, owner: string, extensionId: string): ProviderExtensionBinding | null {
  return db().select().from(providerExtensionBindings).where(and(
    eq(providerExtensionBindings.providerTargetId, providerTargetId),
    eq(providerExtensionBindings.extensionOwner, owner),
    eq(providerExtensionBindings.extensionId, extensionId),
  )).get() ?? null
}

function lifecycleContext(binding: ProviderExtensionBinding, target: ProviderTarget) {
  const activation = readJsonObject(binding.activationJson)
  const state = activation.state
  return {
    bindingId: binding.id,
    target: createDescriptor(target),
    activationState: state && !Array.isArray(state) && typeof state === 'object'
      ? state as { [key: string]: ProviderExtensionJsonValue }
      : {},
  }
}

function emit(
  type: ProviderExtensionLifecycleEventType,
  binding: ProviderExtensionBinding,
  previousStatus: ProviderExtensionStatus,
  reason?: string,
  errorCode?: string,
): void {
  publishProviderExtensionLifecycle({
    type,
    bindingId: binding.id,
    providerTargetId: binding.providerTargetId,
    extensionOwner: binding.extensionOwner,
    extensionId: binding.extensionId,
    previousStatus,
    status: binding.status,
    reason,
    errorCode,
  })
}

function projectBinding(
  target: ProviderTarget,
  binding: ProviderExtensionBinding | null,
  owner: string,
  extension: ProviderExtension | null,
): ProviderExtensionBindingView {
  const applicability = extension?.getApplicability(createDescriptor(target)) ?? {
    applicable: false as const,
    reason: 'Extension plugin is unavailable',
  }
  const id = binding?.id ?? deriveBindingId(target.id, owner, extension?.id ?? 'unavailable')
  const providerKinds = binding ? readProviderKinds(binding) : []
  const observedStatus = binding?.desiredEnabled
    && binding.status === 'enabled'
    && !applicability.applicable
    ? 'suspended'
    : binding?.status ?? 'disabled'
  return {
    id,
    providerTargetId: target.id,
    extensionOwner: owner,
    extensionId: extension?.id ?? binding?.extensionId ?? '',
    extensionKey: extension ? `${owner}:${extension.id}` : `${owner}:${binding?.extensionId ?? ''}`,
    label: extension?.label ?? binding?.extensionId ?? 'Unavailable extension',
    description: extension?.description ?? null,
    applicable: applicability.applicable,
    unavailableReason: applicability.applicable ? null : applicability.reason,
    desiredEnabled: binding?.desiredEnabled ?? false,
    status: observedStatus,
    credentialStrategy: binding?.credentialStrategy
      ?? (applicability.applicable ? applicability.credentialStrategy : null),
    credentialOwner: binding?.credentialOwner ?? 'host',
    providerKinds,
    addedProviderKinds: extension?.conversions
      .filter(conversion => conversion.fromProviderKind === target.providerKind)
      .flatMap(conversion => conversion.addedProviderKinds) ?? [],
    lastError: binding?.lastError ?? null,
    updatedAt: binding?.updatedAt ?? 0,
  }
}

export function listProviderTargetExtensions(providerTargetId: string): ProviderExtensionBindingView[] {
  const target = readTarget(providerTargetId)
  const bindings = db().select().from(providerExtensionBindings).where(eq(providerExtensionBindings.providerTargetId, providerTargetId)).all()
  const bindingByKey = new Map(bindings.map(binding => [
    `${binding.extensionOwner}\0${binding.extensionId}`,
    binding,
  ]))
  const views = listProviderExtensions().map((registered) => {
    const key = `${registered.owner}\0${registered.extension.id}`
    const binding = bindingByKey.get(key) ?? null
    bindingByKey.delete(key)
    return projectBinding(target, binding, registered.owner, registered.extension)
  })
  for (const binding of bindingByKey.values()) {
    views.push(projectBinding(target, binding, binding.extensionOwner, null))
  }
  return views.sort((a, b) => a.label.localeCompare(b.label))
}

async function returnExclusiveCredential(
  binding: ProviderExtensionBinding,
  target: ProviderTarget,
  extension: ProviderExtension,
): Promise<ProviderExtensionBinding> {
  const lease = extension.credentialLease
  if (!lease || !target.credentialRef) {
    throw new Error('Exclusive Provider extension credential lease is incomplete')
  }
  const context = lifecycleContext(binding, target)
  const prepared = await lease.prepareRelease({
    ...context,
    leaseEpoch: binding.leaseEpoch,
    leaseState: readJsonObject(binding.leaseStateJson),
  })
  if (
    prepared.credential.kind !== 'chatgpt-auth'
    || !getProviderExtensionHost().validateRefreshableCredential(
      target.credentialRef,
      prepared.credential.value,
    )
  ) {
    throw new Error('Provider extension returned an invalid Codex OAuth credential')
  }

  upsertSecretInDb(db(), {
    id: target.credentialRef,
    kind: 'chatgpt-auth',
    label: readCredentialMetadata(target)?.label ?? target.displayName,
    secret: prepared.credential.value,
  })
  const now = nowUnix()
  db().update(providerExtensionBindings).set({
    credentialOwner: 'host',
    leasePhase: 'release-pending',
    leaseStateJson: JSON.stringify(prepared.leaseState),
    updatedAt: now,
  }).where(eq(providerExtensionBindings.id, binding.id)).run()

  return await commitExclusiveCredentialRelease(readBinding(binding.id), target, extension)
}

async function commitExclusiveCredentialRelease(
  binding: ProviderExtensionBinding,
  target: ProviderTarget,
  extension: ProviderExtension,
): Promise<ProviderExtensionBinding> {
  if (binding.credentialOwner !== 'host' || binding.leasePhase !== 'release-pending') {
    return binding
  }
  const lease = extension.credentialLease
  if (!lease) {
    throw new Error('Exclusive Provider extension credential lease is incomplete')
  }
  await lease.commitRelease({
    ...lifecycleContext(binding, target),
    leaseEpoch: binding.leaseEpoch,
    leaseState: readJsonObject(binding.leaseStateJson),
  })
  db().update(providerExtensionBindings).set({
    leasePhase: 'none',
    leaseStateJson: EMPTY_JSON,
    updatedAt: nowUnix(),
  }).where(eq(providerExtensionBindings.id, binding.id)).run()
  return readBinding(binding.id)
}

async function enableBinding(
  providerTargetId: string,
  extensionOwner: string,
  extensionId: string,
): Promise<ProviderExtensionBindingView> {
  const registered = findProviderExtension(extensionOwner, extensionId)
  if (!registered) {
    throw new AppError({
      code: 'provider_extension_unavailable',
      status: 409,
      message: 'Provider extension is unavailable',
      details: { extensionOwner, extensionId },
    })
  }
  const target = readTarget(providerTargetId)
  if (!target.enabled) {
    throw new AppError({
      code: 'provider_target_disabled',
      status: 409,
      message: 'Provider target must be enabled before enabling an extension',
    })
  }
  const applicability = registered.extension.getApplicability(createDescriptor(target))
  if (!applicability.applicable) {
    throw new AppError({
      code: 'provider_extension_not_applicable',
      status: 409,
      message: applicability.reason,
    })
  }
  const existing = findBinding(providerTargetId, extensionOwner, extensionId)
  if (existing?.status === 'enabled' && existing.desiredEnabled) {
    return projectBinding(target, existing, extensionOwner, registered.extension)
  }
  const bindingId = existing?.id ?? deriveBindingId(providerTargetId, extensionOwner, extensionId)
  const declaredAddedKinds = addedProviderKinds(registered.extension, target)
  const conflicting = db().select().from(providerExtensionBindings).where(and(
    eq(providerExtensionBindings.providerTargetId, providerTargetId),
    eq(providerExtensionBindings.desiredEnabled, true),
  )).all().find((binding) => {
    if (binding.id === bindingId) {
      return false
    }
    const existingExtension = findProviderExtension(binding.extensionOwner, binding.extensionId)?.extension
    if (!existingExtension) {
      return false
    }
    return [...addedProviderKinds(existingExtension, target)].some(kind => declaredAddedKinds.has(kind))
  })
  if (conflicting) {
    throw new AppError({
      code: 'provider_extension_kind_conflict',
      status: 409,
      message: 'Another enabled Provider extension routes the same Provider kind',
      details: { bindingId: conflicting.id },
    })
  }
  if (applicability.credentialStrategy === 'exclusive-refreshable') {
    assertNoActiveRun(providerTargetId)
    const leaseConflict = db().select().from(providerExtensionBindings).where(and(
      eq(providerExtensionBindings.providerTargetId, providerTargetId),
      eq(providerExtensionBindings.desiredEnabled, true),
    )).all().find(binding => binding.id !== bindingId && (
      binding.credentialStrategy === 'exclusive-refreshable'
      || binding.credentialOwner === 'extension'
    ))
    if (leaseConflict) {
      throw new AppError({
        code: 'provider_extension_credential_lease_conflict',
        status: 409,
        message: 'Another Provider extension already owns this Provider credential lease',
        details: { bindingId: leaseConflict.id },
      })
    }
    if (!registered.extension.credentialLease) {
      throw new Error('Exclusive Provider extension must implement credentialLease')
    }
  }

  const previousStatus = existing?.status ?? 'disabled'
  const now = nowUnix()
  db().insert(providerExtensionBindings).values({
    id: bindingId,
    providerTargetId,
    extensionOwner,
    extensionId,
    desiredEnabled: true,
    status: 'enabling',
    credentialStrategy: applicability.credentialStrategy,
    credentialOwner: existing?.credentialOwner ?? 'host',
    leaseEpoch: existing?.leaseEpoch ?? 0,
    leasePhase: existing?.leasePhase ?? 'none',
    leaseStateJson: existing?.leaseStateJson ?? EMPTY_JSON,
    activationJson: existing?.activationJson ?? EMPTY_JSON,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: providerExtensionBindings.id,
    set: {
      desiredEnabled: true,
      status: 'enabling',
      credentialStrategy: applicability.credentialStrategy,
      lastError: null,
      updatedAt: now,
    },
  }).run()
  let binding = readBinding(bindingId)
  emit('enabling', binding, previousStatus)
  getProviderExtensionHost().releaseRuntimeSessions(providerTargetId)

  try {
    if (
      binding.credentialStrategy === 'exclusive-refreshable'
      && binding.credentialOwner === 'host'
      && binding.leasePhase === 'release-pending'
    ) {
      binding = await commitExclusiveCredentialRelease(binding, target, registered.extension)
    }
    const sourceCredential = binding.credentialOwner === 'extension'
      ? null
      : readSourceCredential(target)
    if (applicability.credentialStrategy === 'exclusive-refreshable') {
      if (binding.credentialOwner === 'host') {
        if (!sourceCredential || sourceCredential.kind !== 'chatgpt-auth') {
          throw new Error('Exclusive Provider extension requires a Codex OAuth credential')
        }
        const leaseEpoch = binding.leaseEpoch + 1
        const prepared = await registered.extension.credentialLease!.prepareAcquire({
          ...lifecycleContext(binding, target),
          sourceCredential,
          leaseEpoch,
        })
        db().update(providerExtensionBindings).set({
          credentialOwner: 'extension',
          leaseEpoch,
          leasePhase: 'acquired',
          leaseStateJson: JSON.stringify(prepared.leaseState),
          updatedAt: nowUnix(),
        }).where(eq(providerExtensionBindings.id, bindingId)).run()
        binding = readBinding(bindingId)
      }
      await registered.extension.credentialLease!.commitAcquire({
        ...lifecycleContext(binding, target),
        leaseEpoch: binding.leaseEpoch,
        leaseState: readJsonObject(binding.leaseStateJson),
      })
    }

    const activation = await registered.extension.onEnable({
      ...lifecycleContext(binding, target),
      sourceCredential,
    })
    validateActivation(registered.extension, target, activation)
    binding = persistActivation(
      binding,
      activation,
      applicability.credentialStrategy === 'borrowed-static' ? sourceFingerprint(target) : null,
    )
    emit('enabled', binding, 'enabling')
    getProviderExtensionHost().releaseRuntimeSessions(providerTargetId)
    return projectBinding(target, binding, extensionOwner, registered.extension)
  }
  catch {
    try {
      await registered.extension.onDisable({
        ...lifecycleContext(readBinding(bindingId), target),
        reason: 'user-disabled',
      })
      const current = readBinding(bindingId)
      if (current.credentialOwner === 'extension') {
        await returnExclusiveCredential(current, target, registered.extension)
      }
    }
    catch {
      // The durable lease phase remains recoverable for the next retry.
    }
    const current = readBinding(bindingId)
    if (current.outputCredentialRef) {
      removeSecret(current.outputCredentialRef)
    }
    db().update(providerExtensionBindings).set({
      status: 'error',
      activationJson: EMPTY_JSON,
      outputCredentialRef: null,
      lastError: 'Provider extension activation failed',
      updatedAt: nowUnix(),
    }).where(eq(providerExtensionBindings.id, bindingId)).run()
    const failed = readBinding(bindingId)
    emit('failed', failed, 'enabling', undefined, 'provider_extension_activation_failed')
    throw new AppError({
      code: 'provider_extension_activation_failed',
      status: 409,
      message: 'Provider extension activation failed',
      details: { bindingId },
    })
  }
}

async function disableBinding(
  providerTargetId: string,
  extensionOwner: string,
  extensionId: string,
): Promise<ProviderExtensionBindingView> {
  const target = readTarget(providerTargetId)
  const registered = findProviderExtension(extensionOwner, extensionId)
  const binding = findBinding(providerTargetId, extensionOwner, extensionId)
  if (!binding) {
    if (!registered) {
      throw new AppError({
        code: 'provider_extension_unavailable',
        status: 409,
        message: 'Provider extension is unavailable',
      })
    }
    return projectBinding(target, null, extensionOwner, registered.extension)
  }
  assertNoActiveRun(providerTargetId)
  if (!registered && binding.status === 'suspended' && binding.credentialOwner === 'host') {
    if (binding.outputCredentialRef) {
      removeSecret(binding.outputCredentialRef)
    }
    db().update(providerExtensionBindings).set({
      desiredEnabled: false,
      status: 'disabled',
      activationJson: EMPTY_JSON,
      outputCredentialRef: null,
      sourceFingerprint: null,
      lastError: null,
      updatedAt: nowUnix(),
    }).where(eq(providerExtensionBindings.id, binding.id)).run()
    const disabled = readBinding(binding.id)
    emit('disabled', disabled, binding.status, 'user-disabled')
    return projectBinding(target, disabled, extensionOwner, null)
  }
  if (!registered && (binding.status !== 'disabled' || binding.credentialOwner === 'extension')) {
    throw new AppError({
      code: 'provider_extension_cleanup_unavailable',
      status: 409,
      message: 'Provider extension must be available to clean up this binding',
    })
  }
  if (binding.status === 'disabled' && binding.credentialOwner === 'host') {
    db().update(providerExtensionBindings).set({ desiredEnabled: false, updatedAt: nowUnix() }).where(eq(providerExtensionBindings.id, binding.id)).run()
    return projectBinding(target, readBinding(binding.id), extensionOwner, registered?.extension ?? null)
  }

  const previousStatus = binding.status
  db().update(providerExtensionBindings).set({
    desiredEnabled: false,
    status: 'disabling',
    lastError: null,
    updatedAt: nowUnix(),
  }).where(eq(providerExtensionBindings.id, binding.id)).run()
  let current = readBinding(binding.id)
  emit('disabling', current, previousStatus, 'user-disabled')
  getProviderExtensionHost().releaseRuntimeSessions(providerTargetId)

  try {
    if (registered) {
      await registered.extension.onDisable({
        ...lifecycleContext(current, target),
        reason: 'user-disabled',
      })
      if (current.credentialOwner === 'extension') {
        current = await returnExclusiveCredential(current, target, registered.extension)
      }
      else if (current.leasePhase === 'release-pending') {
        current = await commitExclusiveCredentialRelease(current, target, registered.extension)
      }
    }
    if (current.outputCredentialRef) {
      removeSecret(current.outputCredentialRef)
    }
    db().update(providerExtensionBindings).set({
      desiredEnabled: false,
      status: 'disabled',
      activationJson: EMPTY_JSON,
      outputCredentialRef: null,
      sourceFingerprint: null,
      lastError: null,
      updatedAt: nowUnix(),
    }).where(eq(providerExtensionBindings.id, binding.id)).run()
    current = readBinding(binding.id)
    emit('disabled', current, 'disabling', 'user-disabled')
    return projectBinding(target, current, extensionOwner, registered?.extension ?? null)
  }
  catch {
    db().update(providerExtensionBindings).set({
      status: 'error',
      lastError: 'Provider extension cleanup failed',
      updatedAt: nowUnix(),
    }).where(eq(providerExtensionBindings.id, binding.id)).run()
    current = readBinding(binding.id)
    emit('failed', current, 'disabling', 'user-disabled', 'provider_extension_cleanup_failed')
    throw new AppError({
      code: 'provider_extension_cleanup_failed',
      status: 409,
      message: 'Provider extension cleanup failed',
      details: { bindingId: binding.id },
    })
  }
}

export async function setProviderTargetExtensionEnabled(input: {
  providerTargetId: string
  owner: string
  id: string
  enabled: boolean
}): Promise<ProviderExtensionBindingView> {
  const bindingId = deriveBindingId(input.providerTargetId, input.owner, input.id)
  return await serializeBindingOperation(bindingId, async () => input.enabled
    ? await enableBinding(input.providerTargetId, input.owner, input.id)
    : await disableBinding(input.providerTargetId, input.owner, input.id))
}

export async function prepareProviderTargetExtensionDeletion(providerTargetId: string): Promise<void> {
  const target = readTarget(providerTargetId)
  const bindings = db().select().from(providerExtensionBindings).where(eq(providerExtensionBindings.providerTargetId, providerTargetId)).all()
  for (const binding of bindings) {
    await serializeBindingOperation(binding.id, async () => {
      let current = readBinding(binding.id)
      assertNoActiveRun(providerTargetId)
      const registered = findProviderExtension(current.extensionOwner, current.extensionId)
      if (
        !registered
        && (current.status !== 'disabled' || current.credentialOwner === 'extension')
      ) {
        throw new AppError({
          code: 'provider_extension_cleanup_unavailable',
          status: 409,
          message: 'Provider extension cleanup is required before deleting this Provider',
          details: { bindingId: current.id },
        })
      }
      if (registered && current.status !== 'disabled') {
        await registered.extension.onDisable({
          ...lifecycleContext(current, target),
          reason: 'provider-deleted',
        })
      }
      if (registered && current.credentialOwner === 'extension') {
        current = await returnExclusiveCredential(current, target, registered.extension)
      }
      else if (registered && current.leasePhase === 'release-pending') {
        current = await commitExclusiveCredentialRelease(current, target, registered.extension)
      }
      if (current.outputCredentialRef) {
        removeSecret(current.outputCredentialRef)
      }
      db().delete(providerExtensionBindings).where(eq(providerExtensionBindings.id, current.id)).run()
    })
  }
}

export async function suspendProviderExtensionsForOwner(
  extensionOwner: string,
  reason: 'plugin-disabled' | 'permission-revoked' = 'plugin-disabled',
): Promise<void> {
  const bindings = db().select().from(providerExtensionBindings).where(and(
    eq(providerExtensionBindings.extensionOwner, extensionOwner),
    eq(providerExtensionBindings.desiredEnabled, true),
  )).all()
  for (const binding of bindings) {
    await serializeBindingOperation(binding.id, async () => {
      const current = readBinding(binding.id)
      if (current.status === 'suspended') {
        return
      }
      assertNoActiveRun(current.providerTargetId)
      const registered = findProviderExtension(current.extensionOwner, current.extensionId)
      if (!registered) {
        throw new AppError({
          code: 'provider_extension_cleanup_unavailable',
          status: 409,
          message: 'Provider extension callback is unavailable for suspension',
        })
      }
      const target = readTarget(current.providerTargetId)
      await registered.extension.onDisable({
        ...lifecycleContext(current, target),
        reason,
      })
      if (current.outputCredentialRef) {
        removeSecret(current.outputCredentialRef)
      }
      db().update(providerExtensionBindings).set({
        status: 'suspended',
        outputCredentialRef: null,
        lastError: null,
        updatedAt: nowUnix(),
      }).where(eq(providerExtensionBindings.id, current.id)).run()
      const suspended = readBinding(current.id)
      emit('suspended', suspended, current.status, reason)
      getProviderExtensionHost().releaseRuntimeSessions(current.providerTargetId)
    })
  }
}

export async function suspendProviderExtensionsForTarget(providerTargetId: string): Promise<void> {
  const owners = [...new Set(db().select({ owner: providerExtensionBindings.extensionOwner }).from(providerExtensionBindings).where(and(
      eq(providerExtensionBindings.providerTargetId, providerTargetId),
      eq(providerExtensionBindings.desiredEnabled, true),
    )).all().map(row => row.owner))]
  for (const owner of owners) {
    const ownerBindings = db().select().from(providerExtensionBindings).where(and(
      eq(providerExtensionBindings.providerTargetId, providerTargetId),
      eq(providerExtensionBindings.extensionOwner, owner),
      eq(providerExtensionBindings.desiredEnabled, true),
    )).all()
    for (const binding of ownerBindings) {
      await serializeBindingOperation(binding.id, async () => {
        const current = readBinding(binding.id)
        if (current.status === 'suspended') {
          return
        }
        assertNoActiveRun(providerTargetId)
        const registered = findProviderExtension(current.extensionOwner, current.extensionId)
        if (!registered) {
          throw new AppError({
            code: 'provider_extension_cleanup_unavailable',
            status: 409,
            message: 'Provider extension callback is unavailable for Provider suspension',
          })
        }
        const target = readTarget(providerTargetId)
        await registered.extension.onDisable({
          ...lifecycleContext(current, target),
          reason: 'provider-disabled',
        })
        if (current.outputCredentialRef) {
          removeSecret(current.outputCredentialRef)
        }
        db().update(providerExtensionBindings).set({
          status: 'suspended',
          outputCredentialRef: null,
          lastError: null,
          updatedAt: nowUnix(),
        }).where(eq(providerExtensionBindings.id, current.id)).run()
        const suspended = readBinding(current.id)
        emit('suspended', suspended, current.status, 'provider-disabled')
        getProviderExtensionHost().releaseRuntimeSessions(providerTargetId)
      })
    }
  }
}

async function reconcileProviderExtensions(input: {
  extensionOwner?: string
  providerTargetId?: string
}, options: {
  continueOnError?: boolean
} = {}): Promise<void> {
  const conditions = [eq(providerExtensionBindings.desiredEnabled, true)]
  if (input.extensionOwner) {
    conditions.push(eq(providerExtensionBindings.extensionOwner, input.extensionOwner))
  }
  if (input.providerTargetId) {
    conditions.push(eq(providerExtensionBindings.providerTargetId, input.providerTargetId))
  }
  const bindings = db().select().from(providerExtensionBindings).where(and(...conditions)).all()
  for (const binding of bindings) {
    await serializeBindingOperation(binding.id, async () => {
      let current = readBinding(binding.id)
      const registered = findProviderExtension(current.extensionOwner, current.extensionId)
      if (!registered) {
        return
      }
      const target = readTarget(current.providerTargetId)
      if (!target.enabled) {
        return
      }
      try {
        const applicability = registered.extension.getApplicability(createDescriptor(target))
        if (!applicability.applicable) {
          if (current.status !== 'suspended') {
            await registered.extension.onDisable({
              ...lifecycleContext(current, target),
              reason: 'extension-inapplicable',
            })
            if (current.credentialOwner === 'extension') {
              current = await returnExclusiveCredential(current, target, registered.extension)
            }
            else if (current.leasePhase === 'release-pending') {
              current = await commitExclusiveCredentialRelease(current, target, registered.extension)
            }
            if (current.outputCredentialRef) {
              removeSecret(current.outputCredentialRef)
            }
            db().update(providerExtensionBindings).set({
              status: 'suspended',
              outputCredentialRef: null,
              lastError: applicability.reason,
              updatedAt: nowUnix(),
            }).where(eq(providerExtensionBindings.id, current.id)).run()
            const suspended = readBinding(current.id)
            emit('suspended', suspended, current.status, 'extension-inapplicable')
            getProviderExtensionHost().releaseRuntimeSessions(current.providerTargetId)
          }
          return
        }
        if (
          current.credentialStrategy === 'exclusive-refreshable'
          && current.credentialOwner !== 'extension'
        ) {
          await enableBinding(current.providerTargetId, current.extensionOwner, current.extensionId)
          return
        }
        const activation = await registered.extension.onReconcile({
          ...lifecycleContext(current, target),
          sourceCredential: current.credentialOwner === 'extension' ? null : readSourceCredential(target),
          credentialStrategy: current.credentialStrategy ?? 'borrowed-static',
          leaseEpoch: current.leaseEpoch,
        })
        validateActivation(registered.extension, target, activation)
        current = persistActivation(
          current,
          activation,
          current.credentialStrategy === 'borrowed-static' ? sourceFingerprint(target) : null,
        )
        emit('reconciled', current, binding.status)
        getProviderExtensionHost().releaseRuntimeSessions(current.providerTargetId)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const lastError = message.trim() || 'Provider extension reconcile failed'
        db().update(providerExtensionBindings).set({
          status: 'error',
          lastError,
          updatedAt: nowUnix(),
        }).where(eq(providerExtensionBindings.id, current.id)).run()
        const failed = readBinding(current.id)
        emit('failed', failed, binding.status, undefined, 'provider_extension_reconcile_failed')
        logger.warn('provider extension reconcile failed', {
          bindingId: current.id,
          providerTargetId: current.providerTargetId,
          extensionOwner: current.extensionOwner,
          extensionId: current.extensionId,
          error: lastError,
        })
        if (options.continueOnError) {
          return
        }
        throw new AppError({
          code: 'provider_extension_reconcile_failed',
          status: 409,
          message: lastError,
          details: { bindingId: current.id, cause: lastError },
        })
      }
    })
  }
}

export async function reconcileProviderExtensionsForOwner(extensionOwner: string): Promise<void> {
  await reconcileProviderExtensions({ extensionOwner }, { continueOnError: true })
}

export async function reconcileProviderExtensionsForTarget(providerTargetId: string): Promise<void> {
  await reconcileProviderExtensions({ providerTargetId })
}

export function isProviderTargetCredentialLeased(providerTargetId: string): boolean {
  return !!db().select({ id: providerExtensionBindings.id }).from(providerExtensionBindings).where(and(
    eq(providerExtensionBindings.providerTargetId, providerTargetId),
    eq(providerExtensionBindings.credentialOwner, 'extension'),
  )).get()
}

export async function removeProviderExtensionsForOwner(extensionOwner: string): Promise<void> {
  const bindings = db().select().from(providerExtensionBindings).where(eq(providerExtensionBindings.extensionOwner, extensionOwner)).all()
  for (const binding of bindings) {
    await serializeBindingOperation(binding.id, async () => {
      let current = readBinding(binding.id)
      assertNoActiveRun(current.providerTargetId)
      const registered = findProviderExtension(current.extensionOwner, current.extensionId)
      if (!registered && (current.status !== 'disabled' || current.credentialOwner === 'extension')) {
        throw new AppError({
          code: 'provider_extension_cleanup_unavailable',
          status: 409,
          message: 'Provider extension callback is unavailable for uninstall cleanup',
        })
      }
      const target = readTarget(current.providerTargetId)
      if (registered && current.status !== 'disabled') {
        await registered.extension.onDisable({
          ...lifecycleContext(current, target),
          reason: 'plugin-uninstalled',
        })
      }
      if (registered && current.credentialOwner === 'extension') {
        current = await returnExclusiveCredential(current, target, registered.extension)
      }
      else if (registered && current.leasePhase === 'release-pending') {
        current = await commitExclusiveCredentialRelease(current, target, registered.extension)
      }
      if (current.outputCredentialRef) {
        removeSecret(current.outputCredentialRef)
      }
      db().delete(providerExtensionBindings).where(eq(providerExtensionBindings.id, current.id)).run()
    })
  }
}

export async function ensureProviderExtensionReady(bindingId: string): Promise<ProviderExtensionBinding> {
  return await serializeBindingOperation(bindingId, async () => {
    let binding = readBinding(bindingId)
    if (!binding.desiredEnabled || binding.status !== 'enabled') {
      throw new AppError({
        code: 'provider_extension_not_ready',
        status: 409,
        message: 'Provider extension is not ready',
      })
    }
    const registered = findProviderExtension(binding.extensionOwner, binding.extensionId)
    if (!registered) {
      throw new AppError({
        code: 'provider_extension_unavailable',
        status: 409,
        message: 'Provider extension is unavailable',
      })
    }
    const target = readTarget(binding.providerTargetId)
    if (!target.enabled) {
      throw new AppError({
        code: 'provider_target_disabled',
        status: 409,
        message: 'Provider target is disabled',
      })
    }
    if (
      binding.credentialStrategy === 'borrowed-static'
      && binding.sourceFingerprint !== sourceFingerprint(target)
    ) {
      const activation = await registered.extension.onReconcile({
        ...lifecycleContext(binding, target),
        sourceCredential: readSourceCredential(target),
        credentialStrategy: 'borrowed-static',
        leaseEpoch: binding.leaseEpoch,
      })
      validateActivation(registered.extension, target, activation)
      binding = persistActivation(binding, activation, sourceFingerprint(target))
      emit('reconciled', binding, 'enabled')
    }
    return binding
  })
}

function selectRuntimeBinding(input: {
  providerTargetId: string
  acceptedProviderKinds: string[]
  exclusiveOnly?: boolean
}): ProviderExtensionBinding | null {
  const rows = db().select().from(providerExtensionBindings).where(and(
    eq(providerExtensionBindings.providerTargetId, input.providerTargetId),
    eq(providerExtensionBindings.desiredEnabled, true),
    eq(providerExtensionBindings.status, 'enabled'),
  )).all().filter(binding => (
    (!input.exclusiveOnly || binding.credentialStrategy === 'exclusive-refreshable')
    && bindingIsApplicable(binding, readTarget(binding.providerTargetId))
  ))

  const candidates = rows.filter(binding => readProviderKinds(binding).some(
    kind => input.acceptedProviderKinds.includes(kind),
  ))
  if (candidates.length === 0) {
    return null
  }
  if (candidates.length > 1) {
    throw new AppError({
      code: 'provider_extension_route_ambiguous',
      status: 409,
      message: 'Multiple Provider extensions can route this runtime',
    })
  }
  return candidates[0]!
}

export function readProviderExtensionRuntimeRoute(input: {
  providerTargetId: string
  acceptedProviderKinds: string[]
  publicModelId?: string | null
  exclusiveOnly?: boolean
}): ProviderExtensionRuntimeRoute | null {
  const binding = selectRuntimeBinding(input)
  if (!binding) {
    return null
  }
  const registered = findProviderExtension(binding.extensionOwner, binding.extensionId)
  if (!registered) {
    return null
  }
  const target = readTarget(binding.providerTargetId)
  const projection = registered.extension.resolveRuntime({
    ...lifecycleContext(binding, target),
    runtimeProviderKinds: input.acceptedProviderKinds as Array<'openai-compatible' | 'anthropic' | 'universal'>,
    publicModelId: input.publicModelId ?? undefined,
  })
  if (!readProviderKinds(binding).includes(projection.providerKind)) {
    throw new Error('Provider extension resolved an inactive Provider kind')
  }
  return {
    bindingId: binding.id,
    extensionOwner: binding.extensionOwner,
    extensionId: binding.extensionId,
    providerKind: projection.providerKind,
    configJson: JSON.stringify(projection.config),
    credentialRef: binding.outputCredentialRef,
    effectiveModelId: projection.effectiveModelId ?? input.publicModelId ?? null,
  }
}

export async function ensureProviderExtensionRuntimeRouteReady(input: {
  providerTargetId: string
  acceptedProviderKinds: string[]
  exclusiveOnly?: boolean
}): Promise<void> {
  const binding = selectRuntimeBinding(input)
  if (binding) {
    await ensureProviderExtensionReady(binding.id)
  }
}

export function readEffectiveProviderKinds(
  providerTargetId: string,
  nativeProviderKind: 'openai-compatible' | 'anthropic' | 'universal',
): Array<'openai-compatible' | 'anthropic' | 'universal'> {
  const target = db().select().from(providerTargets).where(eq(providerTargets.id, providerTargetId)).get()
  if (!target?.enabled) {
    return []
  }
  const desiredBindings = db().select().from(providerExtensionBindings).where(and(
    eq(providerExtensionBindings.providerTargetId, providerTargetId),
    eq(providerExtensionBindings.desiredEnabled, true),
    eq(providerExtensionBindings.status, 'enabled'),
  )).all()
  const exclusive = desiredBindings.find(binding => binding.credentialOwner === 'extension')
  if (exclusive) {
    return bindingIsApplicable(exclusive, target) ? readProviderKinds(exclusive) : []
  }
  const bindings = desiredBindings.filter(binding => bindingIsApplicable(binding, target))
  return [...new Set([
    nativeProviderKind,
    ...bindings.flatMap(readProviderKinds),
  ])]
}

export function resetProviderExtensionOperationsForTests(): void {
  operations.clear()
}
