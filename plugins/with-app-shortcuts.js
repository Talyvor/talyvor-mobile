// B40.17 — "Hey Siri, pay my bills in Talyvor": the app's shortcuts, from shortcuts.json, as App Shortcuts on iOS (Siri,
// Spotlight and the Shortcuts app) and as static launcher shortcuts on Android. Each one only opens the app at its
// talyvor:// screen; nothing pays from a shortcut, as a payment is approved on its card with Face ID or a fingerprint.
const { AndroidConfig, IOSConfig, withAndroidManifest, withDangerousMod, withStringsXml, withXcodeProject } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

const shortcuts = require('./shortcuts.json')

const swiftString = (s) => JSON.stringify(s)

/** The App Intents: Apple asks every phrase to say the app's name, and allows ten shortcuts. */
function swiftSource(list) {
  const intents = list
    .map(
      (s) => `@available(iOS 18.0, *)
struct ${s.intent}: AppIntent {
  static let title: LocalizedStringResource = ${swiftString(s.title)}
${s.unlock ? '  // A payment is never made here, but what is due is private: the phone must be unlocked first.\n  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication\n' : ''}  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: ${swiftString(s.url)})!))
  }
}
`,
    )
    .join('\n')
  const entries = list
    .map(
      (s) => `    AppShortcut(
      intent: ${s.intent}(),
      phrases: ["${s.phrase} \\(.applicationName)"],
      shortTitle: ${swiftString(s.title)},
      systemImageName: ${swiftString(s.symbol)}
    )`,
    )
    .join('\n')
  return `// Written by plugins/with-app-shortcuts.js from plugins/shortcuts.json (B40.17): change those, not this file.
import AppIntents
import Foundation

${intents}
@available(iOS 18.0, *)
struct TalyvorShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
${entries}
  }
}
`
}

/** Android's static shortcuts: each a link into the app, labelled from strings.xml as Android requires. */
function shortcutsXml(list, pkg) {
  const items = list
    .map(
      (s) => `  <shortcut android:shortcutId="${s.id}" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/shortcut_${s.id}">
    <intent android:action="android.intent.action.VIEW" android:data="${s.url.replace(/&/g, '&amp;')}" android:targetPackage="${pkg}" android:targetClass="${pkg}.MainActivity" />
  </shortcut>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${items}
</shortcuts>
`
}

const withIos = (config) =>
  withXcodeProject(config, (config) => {
    const name = config.modRequest.projectName
    fs.writeFileSync(path.join(config.modRequest.platformProjectRoot, name, 'TalyvorShortcuts.swift'), swiftSource(shortcuts))
    const file = path.join(name, 'TalyvorShortcuts.swift')
    if (!config.modResults.hasFile(file)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: file, groupName: name, project: config.modResults })
    }
    return config
  })

const withAndroid = (config) => {
  config = withStringsXml(config, (config) => {
    for (const s of shortcuts) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [AndroidConfig.Resources.buildResourceItem({ name: `shortcut_${s.id}`, value: s.title })],
        config.modResults,
      )
    }
    return config
  })
  config = withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults)
    activity['meta-data'] = (activity['meta-data'] ?? []).filter((m) => m.$['android:name'] !== 'android.app.shortcuts')
    activity['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' } })
    return config
  })
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'shortcuts.xml'), shortcutsXml(shortcuts, AndroidConfig.Package.getPackage(config)))
      return config
    },
  ])
}

module.exports = (config) => withAndroid(withIos(config))
module.exports.swiftSource = swiftSource
module.exports.shortcutsXml = shortcutsXml
