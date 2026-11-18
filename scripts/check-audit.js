#!/usr/bin/env node
// B66.2 — fails on every high or critical advisory in what ships, except those in scripts/audit-allow.txt.
// Usage: node scripts/check-audit.js
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const FAILING = new Set(['high', 'critical'])

function allowed(file = path.join(__dirname, 'audit-allow.txt')) {
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
}

// The advisories in an `npm audit --json` report that fail it: high or critical, and not allowed.
function check(report, allow) {
  if (!report || typeof report.vulnerabilities !== 'object') throw new Error('not an npm audit report')
  const found = new Set()
  for (const v of Object.values(report.vulnerabilities)) {
    for (const a of v.via) {
      if (typeof a !== 'object' || !FAILING.has(a.severity)) continue
      const ghsa = (a.url ?? '').match(/GHSA(-[0-9a-z]{4}){3}$/)?.[0]
      if (!ghsa || !allow.includes(ghsa)) found.add(`${a.name} ${a.severity} ${a.url}`)
    }
  }
  return [...found]
}

module.exports = { allowed, check }

if (require.main === module) {
  const { stdout } = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' })
  const found = check(JSON.parse(stdout), allowed())
  for (const f of found) console.error(f)
  console.log(found.length ? `${found.length} advisories fail the audit` : 'npm audit: nothing high or critical beyond scripts/audit-allow.txt')
  process.exit(found.length ? 1 : 0)
}
