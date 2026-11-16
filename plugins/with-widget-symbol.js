// B57.80 — the logo's symbol for the home-screen widget and the Live Activity, which draw only images bundled with them.
// iOS: an asset catalog in the widget extension (expo-widgets' ExpoWidgetsTarget). Android: the app's drawables.
// B57.76 — and for the Live Activity in Pocket: the app icon, and Figtree, which the extension can draw only once it
// carries the font files and names them under UIAppFonts in its own Info.plist.
const fs = require('fs')
const path = require('path')
const plist = require('@expo/plist').default
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins')

const TARGET = 'ExpoWidgetsTarget'
// asset name (iOS) and drawable name (Android) → the kit's PNG; src/widgets pick one by colour scheme.
const SYMBOLS = {
  TalyvorSymbolOnDark: ['talyvor_symbol_on_dark', 'talyvor-symbol-small-on-dark-192.png'],
  TalyvorSymbolOnLight: ['talyvor_symbol_on_light', 'talyvor-symbol-small-on-light-192.png'],
  TalyvorAppIcon: ['talyvor_app_icon', 'app-icon-120.png'],
}
// Font.custom names them by PostScript name: Figtree-Regular, Figtree-SemiBold, Figtree-Bold.
const FONTS = ['400Regular', '600SemiBold', '700Bold'].map((w) => [w, `Figtree_${w}.ttf`])
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
    const group = project.findPBXGroupKey({ name: TARGET })
    project.addResourceFile('Assets.xcassets', { target: targetUuid, lastKnownFileType: 'folder.assetcatalog' }, group)
    const fontDir = path.dirname(require.resolve('@expo-google-fonts/figtree/package.json', { paths: [c.modRequest.projectRoot] }))
    for (const [weight, file] of FONTS) {
      fs.copyFileSync(path.join(fontDir, weight, file), path.join(c.modRequest.platformProjectRoot, TARGET, file))
      project.addResourceFile(file, { target: targetUuid, lastKnownFileType: 'file' }, group)
    }
    const info = path.join(c.modRequest.platformProjectRoot, TARGET, 'Info.plist')
    const parsed = plist.parse(fs.readFileSync(info, 'utf8'))
    fs.writeFileSync(info, plist.build({ ...parsed, UIAppFonts: FONTS.map(([, file]) => file) }))
    return c
  })
}
