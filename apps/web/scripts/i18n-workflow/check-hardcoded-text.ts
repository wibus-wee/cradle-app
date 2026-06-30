import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'
import ts from 'typescript'

import { resolveFromWebRoot, writeJson } from './utils'

interface HardcodedTextFinding {
  filePath: string
  line: number
  text: string
  reason: 'jsx_text' | 'aria_label' | 'title' | 'placeholder'
}

interface HardcodedTextReport {
  generatedAt: string
  summary: {
    files: number
    findings: number
  }
  findings: HardcodedTextFinding[]
}

const USER_TEXT_PATTERN = /[A-Za-z\p{Script=Han}]/u
const TRANSLATED_CALLS = new Set(['t'])
const TRANSLATED_COMPONENTS = new Set(['Trans'])

const ALLOWED_FILE_PATTERNS = [
  /\.test\.tsx$/,
  /src\/locales\//,
]

const ALLOWED_TEXT_PATTERNS = [
  /^[A-Z]{1,4}$/,
  /^⌘[A-Z]$/,
  /^&gt;_$/,
  /^https?:\/\//,
  /^\*\*/,
  /^[A-Z_]+=?\.\.\.(?:\n[A-Z_]+=\d+)?$/,
  /^[\w.-]+\/[\w.-]+$/,
  /^[-\w./:{}?=&, ]+$/,
]

function lineNumber(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function allowedText(text: string): boolean {
  const normalized = text.trim()
  return normalized.length === 0 || !USER_TEXT_PATTERN.test(normalized) || ALLOWED_TEXT_PATTERNS.some(pattern => pattern.test(normalized))
}

function jsxTagName(name: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(name)) {
    return name.text
  }
  if (ts.isPropertyAccessExpression(name)) {
    return name.name.text
  }
  return name.getText()
}

function isInsideTranslatedComponent(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent

  while (current) {
    if (ts.isJsxElement(current)) {
      const name = jsxTagName(current.openingElement.tagName)
      if (TRANSLATED_COMPONENTS.has(name)) {
        return true
      }
    }
    if (ts.isJsxSelfClosingElement(current)) {
      const name = jsxTagName(current.tagName)
      if (TRANSLATED_COMPONENTS.has(name)) {
        return true
      }
    }
    current = current.parent
  }

  return false
}

function isTranslatedExpression(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) {
    return false
  }

  const callee = expression.expression
  return ts.isIdentifier(callee) && TRANSLATED_CALLS.has(callee.text)
}

const files = await fg(['src/**/*.tsx'], {
  cwd: process.cwd(),
  ignore: ['src/api-gen/**'],
})

const findings: HardcodedTextFinding[] = []

for (const filePath of files) {
  if (ALLOWED_FILE_PATTERNS.some(pattern => pattern.test(filePath))) {
    continue
  }

  const absolutePath = path.resolve(process.cwd(), filePath)
  const source = await fs.readFile(absolutePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim()
      if (!allowedText(text) && !isInsideTranslatedComponent(node)) {
        findings.push({
          filePath,
          line: lineNumber(sourceFile, node.getStart(sourceFile)),
          text,
          reason: 'jsx_text',
        })
      }
    }

    if (ts.isJsxAttribute(node)) {
      const attribute = node.name.text
      if ((attribute === 'aria-label' || attribute === 'title' || attribute === 'placeholder') && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          const text = node.initializer.text
          if (!allowedText(text)) {
            findings.push({
              filePath,
              line: lineNumber(sourceFile, node.getStart(sourceFile)),
              text,
              reason: attribute === 'aria-label' ? 'aria_label' : attribute === 'title' ? 'title' : 'placeholder',
            })
          }
        }

        if (ts.isJsxExpression(node.initializer) && node.initializer.expression && !isTranslatedExpression(node.initializer.expression)) {
          const expression = node.initializer.expression
          if (ts.isStringLiteral(expression) && !allowedText(expression.text)) {
            findings.push({
              filePath,
              line: lineNumber(sourceFile, node.getStart(sourceFile)),
              text: expression.text,
              reason: attribute === 'aria-label' ? 'aria_label' : attribute === 'title' ? 'title' : 'placeholder',
            })
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

const report: HardcodedTextReport = {
  generatedAt: new Date().toISOString(),
  summary: {
    files: files.length,
    findings: findings.length,
  },
  findings,
}

await writeJson(resolveFromWebRoot('i18n-hardcoded-report.json'), report)

if (findings.length > 0) {
  console.error(JSON.stringify(report.summary, null, 2))
  process.exitCode = 1
}
