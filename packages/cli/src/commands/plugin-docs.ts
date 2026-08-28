import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { Command } from 'commander'
import { marked } from 'marked'

export interface PluginGuideSection {
  id: string
  title: string
  markdown: string
}

function findChild(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name)
}

function readChild(parent: Command, name: string, description: string): Command {
  return findChild(parent, name) ?? parent.command(name).description(description)
}

export function pluginGuideSectionId(title: string): string {
  return title
    .replace(/^\d+\.\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function parsePluginGuideSections(source: string): PluginGuideSection[] {
  let offset = 0
  const headings = marked.lexer(source).flatMap((token) => {
    const tokenOffset = offset
    offset += token.raw.length
    return token.type === 'heading' && token.depth === 2
      ? [{ offset: tokenOffset, title: token.text.trim() }]
      : []
  })
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.offset ?? source.length
    return {
      id: pluginGuideSectionId(heading.title),
      title: heading.title,
      markdown: source.slice(heading.offset, end).trimEnd(),
    }
  })
}

export function selectPluginGuideSection(
  sections: readonly PluginGuideSection[],
  topic: string,
): PluginGuideSection {
  const requested = pluginGuideSectionId(topic)
  const exact = sections.find(section => section.id === requested)
  if (exact) { return exact }

  const candidates = sections.filter(section => section.id.startsWith(requested))
  if (candidates.length === 1) { return candidates[0]! }
  if (candidates.length > 1) {
    throw new Error(`Plugin guide topic "${topic}" is ambiguous: ${candidates.map(section => section.id).join(', ')}`)
  }
  throw new Error(`Unknown Plugin guide topic "${topic}". Run \`cradle plugin docs\` to list topics.`)
}

export function resolvePluginDeveloperGuidePath(options: {
  executablePath?: string
  cwd?: string
  configuredPath?: string
} = {}): string {
  const executableDir = dirname(resolve(options.executablePath ?? process.argv[1] ?? process.execPath))
  const cwd = resolve(options.cwd ?? process.cwd())
  const candidates = [
    options.configuredPath?.trim(),
    process.env.CRADLE_PLUGIN_SDK_DOCS_PATH?.trim(),
    resolve(executableDir, '../../plugin-sdk/DEVELOPERS.md'),
    resolve(executableDir, '../plugin-sdk/DEVELOPERS.md'),
    resolve(cwd, 'packages/plugin-sdk/DEVELOPERS.md'),
  ].filter((candidate): candidate is string => !!candidate)

  const guidePath = candidates.find(candidate => existsSync(candidate))
  if (!guidePath) {
    throw new Error('Cradle Plugin developer guide is unavailable. Reinstall Cradle or set CRADLE_PLUGIN_SDK_DOCS_PATH.')
  }
  return guidePath
}

export function renderPluginGuideIndex(sections: readonly PluginGuideSection[]): string {
  return [
    '# Cradle Plugin Developer Guide',
    '',
    ...sections.map(section => `${section.id}\t${section.title.replace(/^\d+\.\s*/, '')}`),
    '',
    'Read one topic with `cradle plugin docs <topic>` or the complete guide with `cradle plugin docs all`.',
  ].join('\n')
}

export function registerPluginDocsCommand(root: Command): void {
  const plugin = readChild(root, 'plugin', 'Manage plugins')
  plugin
    .command('docs')
    .description('Read the Plugin SDK developer guide bundled with this Cradle version')
    .argument('[topic]', 'Guide topic, topic prefix, or "all"')
    .action((topic: string | undefined) => {
      const guide = readFileSync(resolvePluginDeveloperGuidePath(), 'utf8')
      const sections = parsePluginGuideSections(guide)
      if (!topic) {
        console.log(renderPluginGuideIndex(sections))
        return
      }
      console.log(topic === 'all' ? guide.trimEnd() : selectPluginGuideSection(sections, topic).markdown)
    })
}
