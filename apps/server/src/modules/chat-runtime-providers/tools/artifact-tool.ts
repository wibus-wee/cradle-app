/**
 * Detect Cradle `write_artifact` MCP tool names across providers.
 * Claude: `mcp__cradle__write_artifact`
 * Codex / OpenCode: variants with server/tool separators.
 */
export function isCradleWriteArtifactToolName(apiName: string): boolean {
  const normalized = apiName.trim()
  if (!normalized) {
    return false
  }
  if (normalized === 'write_artifact') {
    return true
  }
  if (normalized === 'mcp__cradle__write_artifact') {
    return true
  }
  // mcp__cradle__write_artifact | cradle/write_artifact | cradle:write_artifact | mcp_cradle_write_artifact
  return /(?:^|[_/:])write_artifact$/i.test(normalized)
}
