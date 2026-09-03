const END_SENTINEL = 'BENCHMARK_END_SENTINEL'

const SECTION = (index: number) => `
## Rendering section ${index}

This paragraph mixes **strong text**, _emphasis_, an [internal link](https://example.com/item/${index}), and inline code like \`const section = ${index}\`. It represents a typical assistant response with enough prose to exercise inline parsing and reconciliation.

- A short actionable item for section ${index}
- A second item with ~~obsolete text~~ and replacement guidance
- A final item containing a nested value: \`${index * 17}\`

> Streaming renderers must preserve stable completed blocks while the active tail is still changing.

| Metric | Value | Notes |
| --- | ---: | --- |
| section | ${index} | deterministic fixture |
| score | ${index * 13} | no external resources |

\`\`\`typescript
export function section${index}(input: number) {
  return input * ${index + 1}
}
\`\`\`
`

export function createMarkdownFixture(targetChars: number): string {
  let content = '# Streaming Markdown benchmark\n\n'
  let index = 1
  while (content.length < targetChars) {
    content += SECTION(index)
    index += 1
  }
  return `${content}\n${END_SENTINEL}\n`
}

export function hasEndSentinel(content: string): boolean {
  return content.includes(END_SENTINEL)
}
