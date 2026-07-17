import { readFileSync } from 'node:fs'

export function readJavaScriptProgramSource(options: { program?: string, programFile?: string }): string {
  const hasProgram = options.program !== undefined
  const hasProgramFile = options.programFile !== undefined
  if (hasProgram === hasProgramFile) {
    throw new Error('Pass exactly one program input: --program or --program-file.')
  }
  if (hasProgram) {
    return options.program!
  }
  try {
    return readFileSync(options.programFile!, 'utf8')
  }
  catch (error) {
    throw new Error(`Could not read --program-file ${options.programFile}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
