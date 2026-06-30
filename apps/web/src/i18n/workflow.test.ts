// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { validateNamespace } from '../../scripts/i18n-workflow/utils'

describe('i18n workflow validation', () => {
  it('reports missing and extra keys', () => {
    const report = validateNamespace('zh-CN', 'common', {
      'action.save': 'Save',
      'action.cancel': 'Cancel',
    }, {
      'action.save': '保存',
      'action.old': '旧操作',
    })

    expect(report.missingKeys).toEqual(['action.cancel'])
    expect(report.extraKeys).toEqual(['action.old'])
  })

  it('reports placeholder and tag mismatches', () => {
    const report = validateNamespace('zh-CN', 'common', {
      'user.greeting': 'Hello, {{name}}',
      'legal.accept': 'I agree to the <terms>Terms</terms>.',
    }, {
      'user.greeting': '你好',
      'legal.accept': '我同意条款。',
    })

    expect(report.invalidEntries.map(entry => entry.reason).sort()).toEqual(['placeholder_mismatch', 'tag_mismatch'])
    expect(report.invalidEntries.find(entry => entry.reason === 'placeholder_mismatch')).toEqual(expect.objectContaining({
      actualPlaceholders: [],
      expectedPlaceholders: ['name'],
    }))
    expect(report.invalidEntries.find(entry => entry.reason === 'tag_mismatch')).toEqual(expect.objectContaining({
      actualTags: [],
      expectedTags: ['terms'],
    }))
  })

  it('reports non-string entries', () => {
    const report = validateNamespace('zh-CN', 'common', {
      'action.save': 'Save',
    }, {
      'action.save': ['保存'],
    })

    expect(report.invalidEntries).toEqual([
      expect.objectContaining({
        actualType: 'array',
        key: 'action.save',
        reason: 'non_string_value',
      }),
    ])
  })

  it('reports locale-specific plural category mismatch', () => {
    const report = validateNamespace('es-ES', 'common', {
      'item.count_one': '{{count}} item',
      'item.count_other': '{{count}} items',
    }, {
      'item.count_other': '{{count}} elementos',
    })

    expect(report.invalidEntries).toContainEqual(expect.objectContaining({
      key: 'item.count',
      reason: 'plural_mismatch',
      expectedPluralCategories: ['many', 'one', 'other'],
      actualPluralCategories: ['other'],
    }))
  })
})
