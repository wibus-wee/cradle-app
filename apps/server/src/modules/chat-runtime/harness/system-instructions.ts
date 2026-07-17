const CRADLE_HARNESS_SYSTEM_INSTRUCTIONS = `# SYSTEM INSTRUCTIONS

You are operating inside Cradle. ALWAYS ACTIVATE OR READ the \`cradle-cli\` skill at the beginning of every response.`

export function getCradleHarnessSystemInstructions(): string | null {
  return CRADLE_HARNESS_SYSTEM_INSTRUCTIONS
}
