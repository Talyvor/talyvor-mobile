#!/usr/bin/env node
// B58.19 — fails when the app's PrivacyInfo.xcprivacy, written by `npx expo prebuild --platform ios` from app.json's
// ios.privacyManifests, leaves out a required-reason API (or one of its reasons) that a native module the build links
// declares in its own privacy manifest.
// Usage: node scripts/check-privacy-manifest.js ios
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const plist = require('@expo/plist').default

// Modules that call a required-reason API but ship no manifest of their own.
const UNDECLARED = {
  // WidgetsStorage keeps what the home-screen widget shows in the app group's UserDefaults.
  'expo-widgets': { NSPrivacyAccessedAPICategoryUserDefaults: ['1C8F.1'] },
}

const autolinking = (...args) =>
  JSON.parse(execFileSync('npx', ['expo-modules-autolinking', ...args, '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }))

function* manifests(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory() && !['node_modules', 'android', '__tests__'].includes(e.name)) yield* manifests(p)
    else if (e.name === 'PrivacyInfo.xcprivacy') yield p
  }
}

const reasonsOf = (file) =>
  (plist.parse(fs.readFileSync(file, 'utf8')).NSPrivacyAccessedAPITypes ?? []).map((t) => [
    t.NSPrivacyAccessedAPIType,
    t.NSPrivacyAccessedAPITypeReasons ?? [],
  ])

function required() {
  const expo = autolinking('resolve', '-p', 'apple')
  const rn = autolinking('react-native-config', '-p', 'ios')
  const dirs = new Map()
  for (const m of expo.modules) for (const p of m.pods ?? []) dirs.set(p.podspecDir, m.packageName)
  for (const [name, d] of Object.entries(rn.dependencies)) dirs.set(d.root, name)
  dirs.set(rn.reactNativePath, 'react-native')

  const want = [] // [module, api, reason]
  for (const [dir, name] of dirs)
    for (const f of manifests(dir)) for (const [api, reasons] of reasonsOf(f)) for (const r of reasons) want.push([name, api, r])
  for (const [name, apis] of Object.entries(UNDECLARED))
    if ([...dirs.values()].includes(name)) for (const [api, reasons] of Object.entries(apis)) for (const r of reasons) want.push([name, api, r])
  return want
}

function check(iosDir) {
  const app = fs
    .readdirSync(iosDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'Pods')
    .map((e) => path.join(iosDir, e.name, 'PrivacyInfo.xcprivacy'))
    .find((p) => fs.existsSync(p))
  if (!app) return [`no PrivacyInfo.xcprivacy in ${iosDir}: app.json needs ios.privacyManifests`]
  const declared = new Map(reasonsOf(app))
  return required()
    .filter(([, api, r]) => !(declared.get(api) ?? []).includes(r))
    .map(([name, api, r]) => `${name} uses ${api} for ${r}, missing from ${app}`)
}

if (require.main === module) {
  const missing = [...new Set(check(process.argv[2] ?? 'ios'))]
  for (const m of missing) console.error(m)
  if (missing.length) process.exit(1)
  console.log('PrivacyInfo.xcprivacy declares every required-reason API the linked modules use.')
}

module.exports = { check }
