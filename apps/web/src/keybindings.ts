import type { ShortcutDefinition } from './lib/shortcut-utils'

export interface KeybindingContext {
  [name: string]: boolean
}
export interface KeybindingRule {
  key: string
  command: string
  when?: string
}
export type WhenNode
  = | { type: 'identifier', name: string }
    | { type: 'not', node: WhenNode }
    | { type: 'and' | 'or', left: WhenNode, right: WhenNode }
const TOKEN_RE = /\s*(&&|\|\||[!()]|[A-Z_][\w.-]*)\s*/giy
export interface ResolvedKeybindingRule {
  command: string
  shortcut: ShortcutDefinition
  when: WhenNode | null
}
export function parseShortcut(value: string): ShortcutDefinition {
  const parts = value
    .split('+')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)
  const key = parts.at(-1)
  if (!key) { throw new Error('Shortcut must include a key') }
  const modifiers = new Set(parts.slice(0, -1))
  const known = new Set([
    'mod',
    'cmd',
    'command',
    'meta',
    'ctrl',
    'control',
    'shift',
    'alt',
    'option',
  ])
  for (const modifier of modifiers) { if (!known.has(modifier)) { throw new Error(`Unknown shortcut modifier: ${modifier}`) } }
  return {
    key: key === 'esc' ? 'escape' : key,
    mod: modifiers.has('mod'),
    meta: modifiers.has('cmd') || modifiers.has('command') || modifiers.has('meta'),
    ctrl: modifiers.has('ctrl') || modifiers.has('control'),
    shift: modifiers.has('shift'),
    alt: modifiers.has('alt') || modifiers.has('option'),
    allowInEditable: true,
  }
}
export function parseWhenExpression(expression: string): WhenNode {
  const tokens: string[] = []
  TOKEN_RE.lastIndex = 0
  while (TOKEN_RE.lastIndex < expression.length) {
    const match = TOKEN_RE.exec(expression)
    if (!match) { throw new Error(`Invalid when expression near: ${expression.slice(TOKEN_RE.lastIndex)}`) }
    tokens.push(match[1])
  }
  let cursor = 0
  const parsePrimary = (): WhenNode => {
    const token = tokens[cursor++]
    if (token === '!') { return { type: 'not', node: parsePrimary() } }
    if (token === '(') {
      const node = parseOr()
      if (tokens[cursor++] !== ')') { throw new Error('Missing closing parenthesis in when expression') }
      return node
    }
    if (!token || token === ')' || token === '&&' || token === '||') { throw new Error('Expected a context identifier in when expression') }
    return { type: 'identifier', name: token }
  }
  const parseAnd = (): WhenNode => {
    let node = parsePrimary()
    while (tokens[cursor] === '&&') {
      cursor++
      node = { type: 'and', left: node, right: parsePrimary() }
    }
    return node
  }
  const parseOr = (): WhenNode => {
    let node = parseAnd()
    while (tokens[cursor] === '||') {
      cursor++
      node = { type: 'or', left: node, right: parseAnd() }
    }
    return node
  }
  const node = parseOr()
  if (cursor !== tokens.length) { throw new Error('Unexpected token in when expression') }
  return node
}
export function evaluateWhenExpression(node: WhenNode, context: KeybindingContext): boolean {
  if (node.type === 'identifier') { return context[node.name] === true }
  if (node.type === 'not') { return !evaluateWhenExpression(node.node, context) }
  if (node.type === 'and') { return evaluateWhenExpression(node.left, context) && evaluateWhenExpression(node.right, context) }
  return evaluateWhenExpression(node.left, context) || evaluateWhenExpression(node.right, context)
}
export function isKeybindingRuleActive(rule: KeybindingRule, context: KeybindingContext): boolean {
  return rule.when ? evaluateWhenExpression(parseWhenExpression(rule.when), context) : true
}
export function resolveKeybindingRules(rules: KeybindingRule[]): ResolvedKeybindingRule[] {
  return rules.map(rule => ({
    command: rule.command,
    shortcut: parseShortcut(rule.key),
    when: rule.when ? parseWhenExpression(rule.when) : null,
  }))
}
