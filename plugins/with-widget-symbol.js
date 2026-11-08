// B57.80 — the logo's symbol for the home-screen widget and the Live Activity, which draw only images bundled with them.
// iOS: an asset catalog in the widget extension (expo-widgets' ExpoWidgetsTarget). Android: the app's drawables.
const fs = require('fs')
const path = require('path')
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins')

const TARGET = 'ExpoWidgetsTarget'
// asset name (iOS) and drawable name (Android) → the kit's PNG; src/widgets pick one by colour scheme.
const SYMBOLS = {
  TalyvorSymbolOnDark: ['talyvor_symbol_on_dark', 'talyvor-symbol-small-on-dark-192.png'],
  TalyvorSymbolOnLight: ['talyvor_symbol_on_light', 'talyvor-symbol-small-on-light-192.png'],
}
const source = (root, file) => path.join(root, 'assets/logo', file)
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2))

module.exports = (config) => {
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/drawable-nodpi')
      fs.mkdirSync(dir, { recursive: true })
      for (const [drawable, file] of Object.values(SYMBOLS)) fs.copyFileSync(source(c.modRequest.projectRoot, file), path.join(dir, `${drawable}.png`))
      return c
    },
  ])
  // Written here, not in a dangerous mod: expo-widgets clears the target's folder in its own dangerous mod.
  return withXcodeProject(config, (c) => {
    const project = c.modResults
    const targetUuid = project.findTargetKey(TARGET)
    if (!targetUuid) throw new Error(`with-widget-symbol: no ${TARGET}; expo-widgets must be listed in app.json`)
    const catalog = path.join(c.modRequest.platformProjectRoot, TARGET, 'Assets.xcassets')
    fs.mkdirSync(catalog, { recursive: true })
    json(path.join(catalog, 'Contents.json'), { info: { author: 'xcode', version: 1 } })
    for (const [asset, [, file]] of Object.entries(SYMBOLS)) {
      const set = path.join(catalog, `${asset}.imageset`)
      fs.mkdirSync(set, { recursive: true })
      fs.copyFileSync(source(c.modRequest.projectRoot, file), path.join(set, file))
      json(path.join(set, 'Contents.json'), { images: [{ filename: file, idiom: 'universal' }], info: { author: 'xcode', version: 1 } })
    }
    // pbxResourcesBuildPhaseObj falls back to the app's own phase when the target has none, so ask the target.
    if (!project.buildPhase('Resources', targetUuid)) project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid)
    project.addResourceFile('Assets.xcassets', { target: targetUuid, lastKnownFileType: 'folder.assetcatalog' }, project.findPBXGroupKey({ name: TARGET }))
    return c
  })
}
