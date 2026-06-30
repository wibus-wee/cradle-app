import { describe, expect, it } from 'vitest'

import {
  buildDocumentReadyExpression,
  buildEditableSelectionExpression,
  buildScrollActionExpression,
  createKeyEventPayload,
  isRecoverableNavigationAbort,
  modifierMask,
  urlsEquivalent,
} from './browser-commands'

describe('browser command helpers', () => {
  it('maps modifier names to CDP bitmask values', () => {
    expect(modifierMask(['alt', 'ctrl', 'meta', 'shift'])).toBe(15)
    expect(modifierMask(['control', 'cmd'])).toBe(6)
    expect(modifierMask(['unknown'])).toBe(0)
  })

  it('builds complete key payloads for common keys', () => {
    expect(createKeyEventPayload('keyDown', 'a')).toMatchObject({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      text: 'a',
    })

    expect(createKeyEventPayload('keyDown', 'Enter', ['shift'])).toMatchObject({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      modifiers: 8,
    })

    expect(createKeyEventPayload('keyUp', '1')).toMatchObject({
      type: 'keyUp',
      key: '1',
      code: 'Digit1',
      windowsVirtualKeyCode: 49,
      nativeVirtualKeyCode: 49,
    })
  })

  it('treats ERR_ABORTED as recoverable only when final URL matches', () => {
    const err = new Error('ERR_ABORTED (-3) loading \'http://127.0.0.1:37891/\'')

    expect(isRecoverableNavigationAbort(err, 'http://127.0.0.1:37891/', 'http://127.0.0.1:37891/')).toBe(true)
    expect(isRecoverableNavigationAbort(err, 'http://127.0.0.1:37891/', 'http://127.0.0.1:37891')).toBe(true)
    expect(isRecoverableNavigationAbort(err, 'http://127.0.0.1:37891/', 'http://127.0.0.1:37891/other')).toBe(false)
    expect(isRecoverableNavigationAbort(new Error('ERR_FAILED'), 'http://a.test', 'http://a.test')).toBe(false)
  })

  it('compares URLs without treating different query strings as equal', () => {
    expect(urlsEquivalent('http://a.test/', 'http://a.test')).toBe(true)
    expect(urlsEquivalent('http://a.test/?a=1', 'http://a.test/?a=2')).toBe(false)
    expect(urlsEquivalent('data:text/html,ok', 'data:text/html,ok')).toBe(true)
    expect(urlsEquivalent('data:text/html,ok', 'data:text/html,no')).toBe(false)
  })

  it('uses DOM selection APIs instead of platform-specific keyboard shortcuts', () => {
    const expression = buildEditableSelectionExpression('#name')

    expect(expression).toContain('el.select()')
    expect(expression).toContain('el.setSelectionRange(0, el.value.length)')
    expect(expression).toContain('range.selectNodeContents(el)')
    expect(expression).toContain('"#name"')
    expect(expression).not.toContain('Ctrl')
  })

  it('builds a document readiness wait expression for navigation commands', () => {
    const expression = buildDocumentReadyExpression()

    expect(expression).toContain('document.readyState')
    expect(expression).toContain('DOMContentLoaded')
    expect(expression).toContain('interactive')
    expect(expression).toContain('complete')
  })

  it('builds page scroll actions with movement metadata', () => {
    const expression = buildScrollActionExpression(undefined, 'down', 240)

    expect(expression).toContain('window.scrollBy(deltaX, deltaY)')
    expect(expression).toContain('beforeScrollX: before.scrollX')
    expect(expression).toContain('beforeScrollY: before.scrollY')
    expect(expression).toContain('moved: after.scrollX !== before.scrollX || after.scrollY !== before.scrollY')
    expect(expression).toContain('canMove')
  })

  it('builds selector scroll actions without relying on mouse wheel dispatch', () => {
    const expression = buildScrollActionExpression('#panel', 'right', 120)

    expect(expression).toContain('document.querySelector("#panel")')
    expect(expression).toContain('target.scrollIntoView?.({ block: \'center\', inline: \'center\' })')
    expect(expression).toContain('target.scrollLeft += deltaX')
    expect(expression).toContain('target.scrollTop += deltaY')
    expect(expression).not.toContain('Input.dispatchMouseEvent')
  })
})
