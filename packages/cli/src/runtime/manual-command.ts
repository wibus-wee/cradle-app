import type { Command } from 'commander'

interface ManualTarget {
  command: Command
  path: string[]
}

function findCommand(parent: Command, segments: string[], path: string[]): ManualTarget | undefined {
  if (segments.length === 0) {
    return { command: parent, path }
  }

  const [name, ...rest] = segments
  const child = parent.commands.find(command => command.name() === name || command.aliases().includes(name))
  if (!child) {
    return undefined
  }

  return findCommand(child, rest, [...path, child.name()])
}

function getManualChildren(command: Command): Command[] {
  return command.commands.filter(child => child.name() !== 'help')
}

function renderManual(command: Command, path: string[], depth = 0): string {
  const title = `${'#'.repeat(Math.min(depth + 1, 6))} ${path.join(' ')}`
  const help = command.helpInformation().trimEnd()
  const children = getManualChildren(command)

  if (children.length === 0) {
    return `${title}\n\n${help}`
  }

  const childManuals = children.map(child => renderManual(child, [...path, child.name()], depth + 1))
  return `${title}\n\n${help}\n\n${childManuals.join('\n\n')}`
}

export function registerManualCommand(root: Command): void {
  root
    .command('man')
    .description('Show manual help for a command')
    .argument('[command...]', 'Command path to inspect')
    .action((segments: string[] = []) => {
      const target = findCommand(root, segments, [root.name()])
      if (!target) {
        throw new Error(`Unknown command: ${segments.join(' ')}`)
      }

      console.log(renderManual(target.command, target.path))
    })
}
