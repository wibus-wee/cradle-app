import type { Disposable } from '@cradle/plugin-sdk'
import type { SkillDefinition } from '@cradle/plugin-sdk/server'

import type { NativeSkillProjectionSource } from '../modules/skills/native-skill-projection'
import { getBuiltinSkillProjectionSources, reconcileNativeSkillProjections } from '../modules/skills/native-skill-projection'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

export interface RegisteredPluginSkill {
  owner: string
  skill: SkillDefinition
}

const skills: RegisteredPluginSkill[] = []
let skillRegistryVersion = 0

export function registerPluginSkill(owner: string, skill: SkillDefinition): void {
  skills.push({ owner, skill })
  bumpSkillRegistryVersion()
  reconcilePluginSkillProjections()
}

export function registerOwnedPluginSkill(owner: string, skill: SkillDefinition): Disposable {
  const record = registerPluginCapability(owner, 'skill', 'server', skill.name, skill.name, {
    description: skill.description,
    skillFile: skill.skillFile,
  }, [`skill.${skill.name}`])
  registerPluginSkill(owner, skill)
  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      const index = skills.findIndex(record => record.owner === owner && record.skill === skill)
      if (index >= 0) {
        skills.splice(index, 1)
        bumpSkillRegistryVersion()
      }
      reconcilePluginSkillProjections()
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function getPluginSkills(): readonly RegisteredPluginSkill[] {
  return skills
}

export function getPluginSkillProjectionSources(): NativeSkillProjectionSource[] {
  return skills.map(({ skill }) => ({
    sourceKind: 'plugin',
    skillName: skill.name,
    skillFile: skill.skillFile,
  }))
}

export function getPluginSkillRegistryVersion(): number {
  return skillRegistryVersion
}

export function resetPluginSkillRegistry(): void {
  skills.length = 0
  bumpSkillRegistryVersion()
  reconcilePluginSkillProjections()
}

function bumpSkillRegistryVersion(): void {
  skillRegistryVersion += 1
}

function reconcilePluginSkillProjections(): void {
  reconcileNativeSkillProjections([
    ...getBuiltinSkillProjectionSources(),
    ...getPluginSkillProjectionSources(),
  ])
}
