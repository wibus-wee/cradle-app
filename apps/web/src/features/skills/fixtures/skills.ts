import type { DiscoveredSkill, SkillDocument, SkillInventoryEntry } from '../types'

export const workspaceSkillFixture = {
  name: 'release-checklist',
  description: 'Prepare a release, validate artifacts, and summarize the final verification.',
  location: '/workspaces/cradle/.agents/skills/release-checklist/SKILL.md',
  scope: 'workspace',
  rootDir: '/workspaces/cradle/.agents/skills',
  skillDir: '/workspaces/cradle/.agents/skills/release-checklist',
  active: true,
  shadowedBy: null,
} satisfies SkillInventoryEntry

export const legacySkillFixture = {
  name: 'frontend-review',
  description: 'Review frontend changes for behavior, accessibility, and visual regressions.',
  location: '/Users/dev/.agents/skills/frontend-review/SKILL.md',
  scope: 'legacy',
  rootDir: '/Users/dev/.agents/skills',
  skillDir: '/Users/dev/.agents/skills/frontend-review',
  active: true,
  shadowedBy: null,
} satisfies SkillInventoryEntry

export const builtinSkillFixture = {
  name: 'cradle-cli',
  description: 'Operate Cradle-owned state and workflows through the generated command line.',
  location: '/Applications/Cradle.app/Contents/Resources/skills/cradle-cli/SKILL.md',
  scope: 'builtin',
  rootDir: '/Applications/Cradle.app/Contents/Resources/skills',
  skillDir: '/Applications/Cradle.app/Contents/Resources/skills/cradle-cli',
  active: true,
  shadowedBy: null,
} satisfies SkillInventoryEntry

export const skillInventoryFixtures = [
  workspaceSkillFixture,
  legacySkillFixture,
  builtinSkillFixture,
] satisfies SkillInventoryEntry[]

export const workspaceSkillDocumentFixture = {
  ...workspaceSkillFixture,
  body: [
    '# Release checklist',
    '',
    'Use this skill when preparing a desktop or SDK release.',
    '',
    '1. Collect changes since the last published tag.',
    '2. Run the package verification suite.',
    '3. Record artifacts and any remaining risk.',
  ].join('\n'),
  frontmatter: {
    name: workspaceSkillFixture.name,
    description: workspaceSkillFixture.description,
  },
} satisfies SkillDocument

export const discoveredSkillFixtures = [
  {
    name: 'release-checklist',
    description: 'Prepare a release, validate artifacts, and summarize final verification.',
    skillDir: '/tmp/skill-source/release-checklist',
    relativePath: 'skills/release-checklist',
  },
  {
    name: 'frontend-review',
    description: 'Review frontend behavior, accessibility, and visual regressions.',
    skillDir: '/tmp/skill-source/frontend-review',
    relativePath: 'skills/frontend-review',
  },
  {
    name: 'incident-triage',
    description: 'Collect runtime evidence and narrow an incident to its owning subsystem.',
    skillDir: '/tmp/skill-source/incident-triage',
    relativePath: 'skills/incident-triage',
  },
] satisfies DiscoveredSkill[]
