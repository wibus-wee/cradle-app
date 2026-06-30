import type { ToolPayload } from './tool-ui-classifier'
import { readToolInputPayload, readToolPayload } from './tool-ui-classifier'

export interface TerminalOutputSection {
  label: string
  text: string
  destructive: boolean
}

export function readTerminalOutputSections(output: ToolPayload, errorText?: string): TerminalOutputSection[] {
  const sections: TerminalOutputSection[] = []
  const stderr = output.stderr
  const stdout = output.stdout
  const fallback = output.rawText ?? output.outputText ?? output.contentText ?? output.text

  if (errorText) {
    sections.push({ label: 'Error', text: errorText, destructive: true })
  }
  if (stderr && stderr !== errorText) {
    sections.push({ label: 'stderr', text: stderr, destructive: true })
  }
  if (stdout) {
    sections.push({ label: 'stdout', text: stdout, destructive: false })
  }
  if (fallback && fallback !== stdout && fallback !== stderr && fallback !== errorText) {
    sections.push({ label: 'output', text: fallback, destructive: false })
  }

  return sections
}

export function hasTerminalDetails(input: unknown, output: unknown, errorText?: string, argumentsText?: string): boolean {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)
  return inputPayload.command !== null
    || inputPayload.timeout !== null
    || outputPayload.backgroundTaskId !== null
    || readTerminalOutputSections(outputPayload, errorText).length > 0
}
