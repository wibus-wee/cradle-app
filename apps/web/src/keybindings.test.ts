import { describe, expect, it } from 'vitest'

import { evaluateWhenExpression, parseShortcut, parseWhenExpression } from './keybindings'

describe('keybindings', () => {
  it('parses portable shortcut modifiers', () => {
    expect(parseShortcut('mod+shift+k')).toEqual({
      key: 'k',
      mod: true,
      meta: false,
      ctrl: false,
      shift: true,
      alt: false,
      allowInEditable: true,
    })
  })
  it('evaluates boolean when expressions with precedence and parentheses', () => {
    const node = parseWhenExpression('!terminalFocus && (editableFocus || isMac)')
    expect(
      evaluateWhenExpression(node, {
        terminalFocus: false,
        editableFocus: false,
        inputFocus: false,
        dialogOpen: false,
        isMac: true,
      }),
    ).toBe(true)
    expect(
      evaluateWhenExpression(node, {
        terminalFocus: true,
        editableFocus: true,
        inputFocus: true,
        dialogOpen: false,
        isMac: true,
      }),
    ).toBe(false)
  })
})
