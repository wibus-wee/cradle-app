export function isCodexAppServerUserInputRequest(method: string): boolean {
  return method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request'
}

export function isCodexAppServerToolApprovalRequest(method: string): boolean {
  return method === 'item/commandExecution/requestApproval'
    || method === 'item/fileChange/requestApproval'
    || method === 'item/permissions/requestApproval'
    || method === 'applyPatchApproval'
    || method === 'execCommandApproval'
}

export function isCodexAppServerInteractiveServerRequest(method: string): boolean {
  return isCodexAppServerUserInputRequest(method) || isCodexAppServerToolApprovalRequest(method)
}
