import { parse } from '@babel/parser'

interface SyntaxNode {
  type: string
  start?: number | null
  end?: number | null
  [key: string]: unknown
}

interface Insertion {
  offset: number
  text: string
  order: number
}

export interface InstrumentedClaudeWorkflowScript {
  code: string
  branchCount: number
}

/**
 * Instruments Workflow-relevant JavaScript control flow without changing the
 * Runner script on disk. Stable ids use source offsets, so repeated discovery
 * passes make decisions against the same branch vocabulary.
 */
export function instrumentClaudeWorkflowScript(script: string): InstrumentedClaudeWorkflowScript {
  const file = parse(script, {
    sourceType: 'module',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  }) as unknown as SyntaxNode
  const insertions: Insertion[] = []
  const branchIds = new Set<string>()
  let insertionOrder = 0

  const wrapBooleanDecision = (node: SyntaxNode | null, kind: string) => {
    if (!node || node.start == null || node.end == null) { return }
    const id = `${kind}:${node.start}`
    branchIds.add(id)
    insertions.push({ offset: node.start, text: `__branch(${JSON.stringify(id)}, () => (`, order: insertionOrder++ })
    insertions.push({ offset: node.end, text: '))', order: insertionOrder++ })
  }

  const wrapIterableDecision = (node: SyntaxNode | null, kind: 'of' | 'in') => {
    if (!node || node.start == null || node.end == null) { return }
    const id = `for-${kind}:${node.start}`
    branchIds.add(id)
    insertions.push({
      offset: node.start,
      text: `__iterable(${JSON.stringify(id)}, ${JSON.stringify(kind)}, () => (`,
      order: insertionOrder++,
    })
    insertions.push({ offset: node.end, text: '))', order: insertionOrder++ })
  }

  walkSyntax(file, (node) => {
    switch (node.type) {
      case 'IfStatement':
        wrapBooleanDecision(readNode(node.test), 'if')
        break
      case 'ConditionalExpression':
        wrapBooleanDecision(readNode(node.test), 'conditional')
        break
      case 'WhileStatement':
      case 'DoWhileStatement':
        wrapBooleanDecision(readNode(node.test), 'loop')
        break
      case 'ForStatement':
        wrapBooleanDecision(readNode(node.test), 'loop')
        break
      case 'LogicalExpression': {
        const operator = typeof node.operator === 'string' ? node.operator : 'logical'
        wrapBooleanDecision(readNode(node.left), `logical-${operator}`)
        break
      }
      case 'ForOfStatement':
        wrapIterableDecision(readNode(node.right), 'of')
        break
      case 'ForInStatement':
        wrapIterableDecision(readNode(node.right), 'in')
        break
      case 'SwitchStatement':
        instrumentSwitch(node, branchIds, insertions, () => insertionOrder++)
        break
      case 'TryStatement':
        instrumentCatchPath(node, branchIds, insertions, () => insertionOrder++)
        break
    }
  })

  const code = applyInsertions(script, insertions)
    .replace(/\bexport\s+const\s+meta\s*=/, 'globalThis.__declarations.meta =')
  return { code, branchCount: branchIds.size }
}

function instrumentSwitch(
  node: SyntaxNode,
  branchIds: Set<string>,
  insertions: Insertion[],
  nextOrder: () => number,
): void {
  const discriminant = readNode(node.discriminant)
  const cases = readNodeArray(node.cases)
  if (!discriminant || discriminant.start == null || discriminant.end == null) { return }
  const id = `switch:${discriminant.start}`
  branchIds.add(id)
  insertions.push({
    offset: discriminant.start,
    text: `__switchValue(${JSON.stringify(id)}, ${cases.length}, () => (`,
    order: nextOrder(),
  })
  insertions.push({ offset: discriminant.end, text: '))', order: nextOrder() })
  cases.forEach((switchCase, index) => {
    const test = readNode(switchCase.test)
    if (!test || test.start == null || test.end == null) { return }
    insertions.push({
      offset: test.start,
      text: `__switchCase(${JSON.stringify(id)}, ${index}, () => (`,
      order: nextOrder(),
    })
    insertions.push({ offset: test.end, text: '))', order: nextOrder() })
  })
}

function instrumentCatchPath(
  node: SyntaxNode,
  branchIds: Set<string>,
  insertions: Insertion[],
  nextOrder: () => number,
): void {
  const handler = readNode(node.handler)
  const block = readNode(node.block)
  if (!handler || !block || block.start == null) { return }
  const id = `catch:${block.start}`
  branchIds.add(id)
  insertions.push({
    offset: block.start + 1,
    text: `if (__branch(${JSON.stringify(id)}, () => false)) throw new Error('workflow declaration catch path');`,
    order: nextOrder(),
  })
}

function applyInsertions(source: string, insertions: Insertion[]): string {
  const ordered = [...insertions].sort((left, right) => (
    right.offset - left.offset || right.order - left.order
  ))
  let result = source
  for (const insertion of ordered) {
    result = `${result.slice(0, insertion.offset)}${insertion.text}${result.slice(insertion.offset)}`
  }
  return result
}

function walkSyntax(value: unknown, visit: (node: SyntaxNode) => void): void {
  if (!value || typeof value !== 'object') { return }
  if (Array.isArray(value)) {
    for (const item of value) { walkSyntax(item, visit) }
    return
  }
  const node = value as SyntaxNode
  if (typeof node.type === 'string') { visit(node) }
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'tokens' || key === 'comments' || key === 'errors') { continue }
    if (child && typeof child === 'object') { walkSyntax(child, visit) }
  }
}

function readNode(value: unknown): SyntaxNode | null {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as SyntaxNode).type === 'string'
    ? value as SyntaxNode
    : null
}

function readNodeArray(value: unknown): SyntaxNode[] {
  return Array.isArray(value) ? value.flatMap(item => readNode(item) ?? []) : []
}
