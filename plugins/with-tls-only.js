// B50.10 — the app talks only over TLS. Android: no cleartext in the release manifest (the debug manifests Expo writes
// still allow it, for the development server). iOS: no arbitrary loads and no per-domain exceptions.
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins')

module.exports = (config) => {
  config = withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'false'
    return c
  })
  return withInfoPlist(config, (c) => {
    const ats = { ...c.modResults.NSAppTransportSecurity, NSAllowsArbitraryLoads: false }
    delete ats.NSExceptionDomains
    delete ats.NSAllowsArbitraryLoadsInWebContent
    delete ats.NSAllowsArbitraryLoadsForMedia
    c.modResults.NSAppTransportSecurity = ats
    return c
  })
}
