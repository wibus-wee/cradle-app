const GROUP_HELP_COMMANDS = new Set(['help', 'man'])
const TERMINAL_ROOT_OPTIONS = new Set(['--help', '--version', '-V', '-h'])

/**
 * Resolve the one generated top-level command group needed for this process.
 * Commander accepts both `help <group>` and the Cradle-specific
 * `man <group>` form, so both must look through to the requested group.
 */
export function resolveGeneratedCommandGroup(
  argv: readonly string[],
  generatedGroups: ReadonlySet<string>,
): string | undefined {
  let acceptsHelpTarget = true
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--server') {
      index += 1
      continue
    }
    if (TERMINAL_ROOT_OPTIONS.has(argument)) {
      return undefined
    }
    if (argument.startsWith('-')) {
      continue
    }
    if (acceptsHelpTarget && GROUP_HELP_COMMANDS.has(argument)) {
      acceptsHelpTarget = false
      continue
    }
    return generatedGroups.has(argument) ? argument : undefined
  }
  return undefined
}
