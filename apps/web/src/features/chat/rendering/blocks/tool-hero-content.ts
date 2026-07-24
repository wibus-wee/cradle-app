import { projectChatTodos } from '../../capabilities/chat-todo-projection'
import type { ToolPayload, ToolUiDescriptor } from '../tool-ui-classifier'
import { hasDiffHeroContent } from './tool-call-details'

export function hasHeroContent(
  descriptor: ToolUiDescriptor,
  input: ToolPayload,
  output: ToolPayload,
  errorText?: string,
): boolean {
  if (errorText) {
    return true
  }
  switch (descriptor.kind) {
    case 'terminal':
      return !!errorText
    case 'file-read':
      return output.file !== null
    case 'file-diff':
    case 'notebook-diff':
      return hasDiffHeroContent(input, output)
    case 'web':
      return output.results.some(item => item.content.length > 0)
    case 'subagent':
      return !!(
        output.status
        || output.contentBlocks.length > 0
        || output.workflowName
        || output.workflowDescription
        || output.workflowPhases.length > 0
        || output.workflowRunId
        || output.workflowScriptPath
        || output.workflowSessionUrl
        || output.warning
        || output.error
      )
    case 'todo':
      return (
        projectChatTodos(input, output).length > 0
        || output.rawText !== null
        || input.rawText !== null
      )
    case 'plan-implementation':
      return true
    case 'plan':
      return !!(
        output.planContent
        ?? input.planContent
        ?? output.plan
        ?? input.plan
        ?? output.text
        ?? input.text
        ?? output.rawText
        ?? input.rawText
      )
    case 'mcp':
      return !!(
        output.contentBlocks.length > 0
        || output.contents.length > 0
        || output.error
        || output.rawText
        || output.outputText
        || output.contentText
        || output.text
      )
    default:
      return (
        output.rawText !== null
        || output.outputText !== null
        || output.contentText !== null
        || output.text !== null
      )
  }
}
