import { describe, expect, it } from 'vitest'

import {
  getSettingsSelectionShortcutAction,
  shouldIgnoreSettingsSelectionShortcut,
} from './settings-selection-shortcuts'

function keyboardEvent(overrides: Partial<Parameters<typeof getSettingsSelectionShortcutAction>[0]>) {
  return {
    key: 'a',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    target: document.createElement('button'),
    ...overrides,
  }
}

const activeState = {
  hasVisibleRecords: true,
  hasSelection: true,
  hasDraft: false,
  canDeleteSelection: true,
}

describe('settings-selection-shortcuts', () => {
  it('ignores editable targets and overlay content', () => {
    const input = document.createElement('input')
    const dialog = document.createElement('div')
    dialog.dataset.slot = 'dialog-content'
    const dialogButton = document.createElement('button')
    dialog.append(dialogButton)
    document.body.append(dialog)

    expect(shouldIgnoreSettingsSelectionShortcut(keyboardEvent({ target: input }))).toBe(true)
    expect(shouldIgnoreSettingsSelectionShortcut(keyboardEvent({ target: dialogButton }))).toBe(
      true,
    )

    dialog.remove()
  })

  it('selects visible records with command or control A only when records are visible', () => {
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'a', metaKey: true }), activeState),
    ).toBe('select-visible')
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'a', ctrlKey: true }), {
        ...activeState,
        hasVisibleRecords: false,
      }),
    ).toBeNull()
  })

  it('clears selection or draft with plain Escape', () => {
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Escape' }), activeState),
    ).toBe('clear-selection')
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Escape' }), {
        ...activeState,
        hasSelection: false,
        hasDraft: true,
      }),
    ).toBe('clear-selection')
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Escape', shiftKey: true }), activeState),
    ).toBeNull()
  })

  it('deletes selection with plain Delete or Backspace when deletion is available', () => {
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Delete' }), activeState),
    ).toBe('delete-selection')
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Backspace' }), activeState),
    ).toBe('delete-selection')
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Delete', repeat: true }), activeState),
    ).toBeNull()
    expect(
      getSettingsSelectionShortcutAction(keyboardEvent({ key: 'Delete' }), {
        ...activeState,
        canDeleteSelection: false,
      }),
    ).toBeNull()
  })
})
