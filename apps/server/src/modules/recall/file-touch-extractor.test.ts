import { describe, expect, it } from 'vitest'

import { extractRecallFileTouchPaths } from './file-touch-extractor'

describe('extractRecallFileTouchPaths', () => {
  it('projects only documented provider file-input fields', () => {
    expect(extractRecallFileTouchPaths({
      phase: 'tool_call_input_available',
      toolName: 'file_change',
      payloadJson: JSON.stringify({ input: { filenames: ['./src/app.ts', 'src/app.ts', 'README.md'] } }),
    })).toEqual(['src/app.ts', 'README.md'])
    expect(extractRecallFileTouchPaths({
      phase: 'tool_call_input_available',
      toolName: 'Write',
      payloadJson: JSON.stringify({ input: { file_path: 'src/recall.ts' } }),
    })).toEqual(['src/recall.ts'])
  })

  it('does not infer paths from shell commands or tool output', () => {
    expect(extractRecallFileTouchPaths({
      phase: 'tool_call_input_available',
      toolName: 'command_execution',
      payloadJson: JSON.stringify({ input: { command: 'cat src/app.ts' } }),
    })).toEqual([])
    expect(extractRecallFileTouchPaths({
      phase: 'tool_call_output_available',
      toolName: 'file_change',
      payloadJson: JSON.stringify({ output: { filenames: ['src/app.ts'] } }),
    })).toEqual([])
  })
})
