export type TerminalSplitDirection = 'horizontal' | 'vertical'

export interface TerminalPaneNode {
  type: 'terminal'
  paneId: string
  sessionIds: string[]
  activeSessionId: string
}

export interface TerminalSplitNode {
  type: 'split'
  id: string
  direction: TerminalSplitDirection
  children: TerminalLayoutNode[]
  weights: number[]
}

export type TerminalLayoutNode = TerminalPaneNode | TerminalSplitNode

export function createTerminalPane(sessionId: string): TerminalPaneNode {
  return {
    type: 'terminal',
    paneId: `pane:${sessionId}`,
    sessionIds: [sessionId],
    activeSessionId: sessionId,
  }
}

export function collectTerminalSessionIds(node: TerminalLayoutNode | null): string[] {
  if (!node) {
    return []
  }
  if (node.type === 'terminal') {
    return node.sessionIds
  }
  return node.children.flatMap(collectTerminalSessionIds)
}

export function findTerminalPane(
  node: TerminalLayoutNode | null,
  sessionId: string,
): TerminalPaneNode | null {
  if (!node) {
    return null
  }
  if (node.type === 'terminal') {
    return node.sessionIds.includes(sessionId) ? node : null
  }
  for (const child of node.children) {
    const pane = findTerminalPane(child, sessionId)
    if (pane) {
      return pane
    }
  }
  return null
}

function updateTerminalPane(
  node: TerminalLayoutNode,
  sessionId: string,
  update: (pane: TerminalPaneNode) => TerminalLayoutNode,
): TerminalLayoutNode {
  if (node.type === 'terminal') {
    return node.sessionIds.includes(sessionId) ? update(node) : node
  }

  let changed = false
  const children = node.children.map((child) => {
    const nextChild = updateTerminalPane(child, sessionId, update)
    changed ||= nextChild !== child
    return nextChild
  })
  return changed ? { ...node, children } : node
}

export function addTerminalTab(
  node: TerminalLayoutNode,
  targetSessionId: string,
  newSessionId: string,
): TerminalLayoutNode {
  return updateTerminalPane(node, targetSessionId, pane => ({
    ...pane,
    sessionIds: [...pane.sessionIds, newSessionId],
    activeSessionId: newSessionId,
  }))
}

export function activateTerminalSession(
  node: TerminalLayoutNode,
  sessionId: string,
): TerminalLayoutNode {
  return updateTerminalPane(node, sessionId, pane => (
    pane.activeSessionId === sessionId ? pane : { ...pane, activeSessionId: sessionId }
  ))
}

export function splitTerminalPane(input: {
  node: TerminalLayoutNode
  targetSessionId: string
  newSessionId: string
  direction: TerminalSplitDirection
}): TerminalLayoutNode {
  const { node, targetSessionId, newSessionId, direction } = input
  if (node.type === 'terminal') {
    if (!node.sessionIds.includes(targetSessionId)) {
      return node
    }
    return {
      type: 'split',
      id: `split:${newSessionId}`,
      direction,
      children: [node, createTerminalPane(newSessionId)],
      weights: [1, 1],
    }
  }

  const targetIndex = node.children.findIndex(child => findTerminalPane(child, targetSessionId))
  if (targetIndex < 0) {
    return node
  }

  const targetChild = node.children[targetIndex]!
  const nextChild = splitTerminalPane({
    node: targetChild,
    targetSessionId,
    newSessionId,
    direction,
  })
  if (nextChild === targetChild) {
    return node
  }

  if (node.direction === direction && nextChild.type === 'split' && nextChild.direction === direction) {
    const children = [...node.children]
    const weights = normalizeWeights(node.children.length, node.weights)
    const targetWeight = weights[targetIndex] ?? 1
    children.splice(targetIndex, 1, ...nextChild.children)
    weights.splice(targetIndex, 1, ...nextChild.children.map(() => targetWeight / nextChild.children.length))
    return { ...node, children, weights }
  }

  const children = [...node.children]
  children[targetIndex] = nextChild
  return { ...node, children }
}

export function removeTerminalSession(
  node: TerminalLayoutNode,
  sessionId: string,
): TerminalLayoutNode | null {
  if (node.type === 'terminal') {
    if (!node.sessionIds.includes(sessionId)) {
      return node
    }
    const sessionIds = node.sessionIds.filter(id => id !== sessionId)
    if (sessionIds.length === 0) {
      return null
    }
    return {
      ...node,
      sessionIds,
      activeSessionId: sessionIds.includes(node.activeSessionId)
        ? node.activeSessionId
        : sessionIds[Math.min(node.sessionIds.indexOf(sessionId), sessionIds.length - 1)]!,
    }
  }

  const children: TerminalLayoutNode[] = []
  const weights: number[] = []
  const normalizedWeights = normalizeWeights(node.children.length, node.weights)
  node.children.forEach((child, index) => {
    const nextChild = removeTerminalSession(child, sessionId)
    if (nextChild) {
      children.push(nextChild)
      weights.push(normalizedWeights[index] ?? 1)
    }
  })

  if (children.length === node.children.length && children.every((child, index) => child === node.children[index])) {
    return node
  }
  if (children.length === 0) {
    return null
  }
  if (children.length === 1) {
    return children[0]!
  }
  return { ...node, children, weights }
}

export function resizeTerminalSplit(
  node: TerminalLayoutNode,
  splitId: string,
  weights: number[],
): TerminalLayoutNode {
  if (node.type === 'terminal') {
    return node
  }
  if (node.id === splitId) {
    return { ...node, weights: normalizeWeights(node.children.length, weights) }
  }

  let changed = false
  const children = node.children.map((child) => {
    const nextChild = resizeTerminalSplit(child, splitId, weights)
    changed ||= nextChild !== child
    return nextChild
  })
  return changed ? { ...node, children } : node
}

export function normalizeWeights(count: number, weights: number[]): number[] {
  return Array.from({ length: count }, (_, index) => {
    const weight = weights[index]
    return Number.isFinite(weight) && weight && weight > 0 ? weight : 1
  })
}
