#!/usr/bin/env node
// B50.10 — fails when the exported app (`npx expo export`) carries a key-shaped string or an internal address.
// Usage: node scripts/check-bundle.js dist
const fs = require('fs')
const path = require('path')

// No leading \b: Hermes bytecode stores its strings back to back, so a key usually follows a letter.
const SECRETS = [
  /(sk|rk)_(live|test)_[0-9A-Za-z]{10,}/, // Stripe secret and restricted keys
  /whsec_[0-9A-Za-z]{10,}/,
  /sk-(ant|proj)-[0-9A-Za-z_-]{20,}/, // Anthropic and OpenAI
  /sk-[0-9A-Za-z]{40,}/, // OpenAI, older keys
  /AKIA[0-9A-Z]{16}/,
  /(ghp|gho|ghs|github_pat)_[0-9A-Za-z_]{20,}/,
  /xox[abprs]-[0-9A-Za-z-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/,
]
const INTERNAL = [
  /(?<![\d.])(10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /(?<![\d.])192\.168\.\d{1,3}\.\d{1,3}\b/,
  /(?<![\d.])172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(internal|svc\.cluster\.local|lan)\b/,
  // React Native's and Expo's own development-server fallbacks (8081, 3000); never reached in a release build.
  /\blocalhost(?!:(8081|3000)\b)(:\d+)?\b/,
]

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else yield p
  }
}

function scan(dir) {
  const found = []
  for (const f of files(dir)) {
    const text = fs.readFileSync(f, 'latin1') // Hermes bytecode keeps its strings as bytes
    for (const re of [...SECRETS, ...INTERNAL]) {
      // Names the pattern, never the match: a found secret must not reach the CI log.
      if (re.test(text)) found.push(`${path.relative(dir, f)}: ${re.source}`)
    }
  }
  return found
}

module.exports = { scan }

if (require.main === module) {
  const found = scan(process.argv[2] ?? 'dist')
  for (const f of found) console.error(f)
  process.exit(found.length ? 1 : 0)
}
