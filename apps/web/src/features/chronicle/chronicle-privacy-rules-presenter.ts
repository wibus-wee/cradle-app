const PRIVACY_RULE_LINE_SPLIT_RE = /\r?\n/

export function formatChroniclePrivacyRuleLines(values: string[]): string {
  return values.join('\n')
}

export function parseChroniclePrivacyRuleLines(value: string): string[] {
  const rules: string[] = []
  const seen = new Set<string>()

  for (const line of value.split(PRIVACY_RULE_LINE_SPLIT_RE)) {
    const rule = line.trim()
    if (!rule || seen.has(rule)) {
      continue
    }
    seen.add(rule)
    rules.push(rule)
  }

  return rules
}

export function areChroniclePrivacyRuleListsEqual(
  left: string[],
  right: string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}
