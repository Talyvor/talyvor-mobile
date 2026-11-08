/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

// B56.26 — every word the phone shows (screens, labels, alerts, notifications, widgets, Live Activities, shortcuts) follows
// the copy rules: no em or en dash, none of B56.9's FORBIDDEN words, and an empty value reads in words, never a lone dash.

const root = join(__dirname, '../..')
const FORBIDDEN = [/test money/i, /test credits/i, /closed trial/i, /US first/, /licensed partner/i, /coming soon/i, /Nicolai Gaborac/i, /\bMIXT\b/i]
const DASH = /[–—]/

function problems(text: string): string[] {
  const out = DASH.test(text) ? ['a dash'] : []
  return out.concat(FORBIDDEN.filter((w) => w.test(text)).map((w) => `"${w.source}"`))
}

/** Every string in a source file, comments left out: a string literal, a template's text or JSX text. */
export function copyHits(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateLiteralToken(n) || ts.isJsxText(n)) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
      const text = ts.isJsxText(n) ? n.getText() : n.text
      for (const p of problems(text)) hits.push(`${file}:${line} ${p}`)
      // An empty value in words ("None", "Not yet"), never "-" shown in its place (a minus sign in `x < 0 ? '-' : ''` is fine).
      const p = n.parent
      const shown = ts.isJsxText(n) || ts.isJsxExpression(p) || ts.isJsxAttribute(p) || (ts.isBinaryExpression(p) && p.right === n && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(p.operatorToken.kind))
      if (shown && text.trim() === '-') hits.push(`${file}:${line} a lone dash for an empty value`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' || f === 'node_modules' ? [] : sources(p)
    return /\.(ts|tsx|js)$/.test(f) ? [p] : []
  })
}

test('a dash or a forbidden word in a Text, a label or a notification body fails', () => {
  expect(copyHits('a.tsx', 'const A = () => <Text>Paused — for now</Text>')).toEqual(['a.tsx:1 a dash'])
  expect(copyHits('a.tsx', 'const A = () => <Button label="Pay – now" />')).toEqual(['a.tsx:1 a dash'])
  expect(copyHits('a.ts', 'Notifications.scheduleNotificationAsync({ content: { title: "Held", body: `Paid ${x} — done` } })')).toEqual(['a.ts:1 a dash'])
  expect(copyHits('a.ts', 'Alert.alert("Spend your test credits", "Closed trial")')).toEqual(['a.ts:1 "test credits"', 'a.ts:1 "closed trial"'])
  expect(copyHits('a.tsx', 'const A = () => <Text>{name ?? "-"}</Text>')).toEqual(['a.tsx:1 a lone dash for an empty value'])
  expect(copyHits('a.tsx', 'const A = () => <Text>{"-"}</Text>')).toEqual(['a.tsx:1 a lone dash for an empty value'])
  expect(copyHits('a.tsx', 'const A = () => <Text>{name ?? "None"}{n < 0 ? "-" : ""}</Text>')).toEqual([])
  expect(copyHits('a.ts', '// B1 — a comment nobody reads\nconst re = /[—-]/')).toEqual([])
})

test('no phone screen, notification, widget or shortcut shows a dash or a forbidden word', () => {
  const files = [...sources(join(root, 'src')), ...sources(join(root, 'packages/bff-client/src')), ...sources(join(root, 'modules/talyvor-keys'))]
  const hits = files.flatMap((f) => copyHits(relative(root, f), readFileSync(f, 'utf8')))
  // app.json (the store name, permission reasons) and the Siri and App Shortcuts titles are words too, and JSON has no comments.
  for (const f of ['app.json', 'plugins/shortcuts.json']) for (const p of problems(readFileSync(join(root, f), 'utf8'))) hits.push(`${f} ${p}`)
  expect(hits).toEqual([])
})
