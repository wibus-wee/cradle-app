import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Static } from 'elysia'

import { AppError } from '../../errors/app-error'
import { getServerConfig } from '../../infra'
import { getPluginSkillProjectionSources } from '../../plugins/skill-registry'
import {
  createClaudeGlobalNativeSkillProjectionTarget,
  createCodexGlobalNativeSkillProjectionTarget,
  getBuiltinSkillProjectionSources,
  reconcileNativeSkillProjections,
  registerNativeSkillProjectionTarget,
  unregisterNativeSkillProjectionTarget,
} from '../skills/native-skill-projection'
import type { PreferencesModel } from './model'
import {
  AppPreferencesJsonSchema,
  ChatPreferencesJsonSchema,
  CodexPreferencesJsonSchema,
  DesktopPreferencesJsonSchema,
  JarvisPreferencesJsonSchema,
  KeybindingsPreferencesJsonSchema,
  NetworkPreferencesJsonSchema,
} from './model'

export type AppFeatureFlagKey = keyof Static<
  (typeof PreferencesModel)['appPreferences']
>['featureFlags']

function getPath(name: string): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return join(baseDir, 'preferences', `${name}.json`)
}

export async function getChatPreferences(): Promise<
  Static<(typeof PreferencesModel)['chatPreferences']>
> {
  const filePath = getPath('chat')
  try {
    return ChatPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ChatPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function getAppPreferences(): Promise<
  Static<(typeof PreferencesModel)['appPreferences']>
> {
  const filePath = getPath('app')
  try {
    return AppPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return AppPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export function getAppPreferencesSync(): Static<(typeof PreferencesModel)['appPreferences']> {
  const filePath = getPath('app')
  try {
    return AppPreferencesJsonSchema.parse(readFileSync(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return AppPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export function isAppFeatureFlagEnabled(key: AppFeatureFlagKey): boolean {
  return getAppPreferencesSync().featureFlags[key] === true
}

export function assertAppFeatureFlagEnabled(
  key: AppFeatureFlagKey,
  error: ConstructorParameters<typeof AppError>[0],
): void {
  if (isAppFeatureFlagEnabled(key)) {
    return
  }

  throw new AppError(error)
}

export async function setAppPreferences(
  preferences: Static<(typeof PreferencesModel)['appPreferences']>,
): Promise<void> {
  const filePath = getPath('app')
  const normalized = AppPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
  if (normalized.featureFlags.nativeProviderSkillProjection) {
    applyNativeProviderSkillProjections()
  }
 else {
    removeNativeProviderSkillProjections()
  }
  const { setCodexAppServerLogInsertBlocker }
    = await import('../chat-runtime-providers/codex/app-server/log-insert-blocker')
  const result = setCodexAppServerLogInsertBlocker(
    normalized.featureFlags.blockCodexAppServerLogInserts,
  )
  if (result.status === 'failed') {
    console.warn(
      '[preferences] Failed to apply Codex app-server log insert blocker feature flag:',
      result,
    )
  }
}

function applyNativeProviderSkillProjections(): void {
  const targets = [
    createCodexGlobalNativeSkillProjectionTarget(),
    createClaudeGlobalNativeSkillProjectionTarget(),
  ]
  for (const target of targets) {
    registerNativeSkillProjectionTarget(target)
  }
  reconcileNativeSkillProjections(
    [...getBuiltinSkillProjectionSources(), ...getPluginSkillProjectionSources()],
    targets,
  )
}

function removeNativeProviderSkillProjections(): void {
  const targets = [
    createCodexGlobalNativeSkillProjectionTarget(),
    createClaudeGlobalNativeSkillProjectionTarget(),
  ]
  reconcileNativeSkillProjections([], targets)
  for (const target of targets) {
    unregisterNativeSkillProjectionTarget(target.id)
  }
}

export function getChatPreferencesSync(): Static<(typeof PreferencesModel)['chatPreferences']> {
  const filePath = getPath('chat')
  try {
    return ChatPreferencesJsonSchema.parse(readFileSync(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ChatPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setChatPreferences(
  preferences: Static<(typeof PreferencesModel)['chatPreferencesUpdate']>,
): Promise<void> {
  const filePath = getPath('chat')
  const normalized = ChatPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export async function getCodexPreferences(): Promise<
  Static<(typeof PreferencesModel)['codexPreferences']>
> {
  const filePath = getPath('codex')
  try {
    return CodexPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return CodexPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export function getCodexPreferencesSync(): Static<(typeof PreferencesModel)['codexPreferences']> {
  const filePath = getPath('codex')
  try {
    return CodexPreferencesJsonSchema.parse(readFileSync(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return CodexPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setCodexPreferences(
  preferences: Static<(typeof PreferencesModel)['codexPreferences']>,
): Promise<void> {
  const filePath = getPath('codex')
  const normalized = CodexPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export async function getDesktopPreferences(): Promise<
  Static<(typeof PreferencesModel)['desktopPreferences']>
> {
  const filePath = getPath('desktop')
  try {
    return DesktopPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DesktopPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setDesktopPreferences(
  preferences: Static<(typeof PreferencesModel)['desktopPreferences']>,
): Promise<void> {
  const filePath = getPath('desktop')
  const normalized = DesktopPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export async function getNetworkPreferences(): Promise<
  Static<(typeof PreferencesModel)['networkPreferences']>
> {
  const filePath = getPath('network')
  try {
    return NetworkPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NetworkPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export function getNetworkPreferencesSync(): Static<
  (typeof PreferencesModel)['networkPreferences']
> {
  const filePath = getPath('network')
  try {
    return NetworkPreferencesJsonSchema.parse(readFileSync(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NetworkPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setNetworkPreferences(
  preferences: Static<(typeof PreferencesModel)['networkPreferences']>,
): Promise<void> {
  const filePath = getPath('network')
  const normalized = NetworkPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export async function getJarvisPreferences(): Promise<
  Static<(typeof PreferencesModel)['jarvisPreferences']>
> {
  const filePath = getPath('jarvis')
  try {
    return JarvisPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return JarvisPreferencesJsonSchema.parse(undefined)
    }
    throw error
  }
}

export async function setJarvisPreferences(
  preferences: Static<(typeof PreferencesModel)['jarvisPreferences']>,
): Promise<void> {
  const filePath = getPath('jarvis')
  const normalized = JarvisPreferencesJsonSchema.parse(JSON.stringify(preferences))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export async function getKeybindingsPreferences(): Promise<
  Static<(typeof PreferencesModel)['keybindingsPreferences']>
> {
  const filePath = getPath('keybindings')
  try {
    const rules = KeybindingsPreferencesJsonSchema.parse(await readFile(filePath, 'utf8'))
    return { configPath: filePath, rules, errors: [] }
  }
 catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, '[]\n', 'utf8')
      return { configPath: filePath, rules: [], errors: [] }
    }
    return {
      configPath: filePath,
      rules: [],
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}
