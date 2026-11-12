// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

// B57.64 — pocket-shots' web export only (POCKET_SHOTS=1, set by scripts/pocket-shots.mjs): the keychain is the sample
// session, so the shots open signed in. The shim refuses to load against any BFF but the shots' own.
if (process.env.POCKET_SHOTS === '1') {
  const shim = path.join(__dirname, 'scripts/pocket/secure-store.js')
  // B57.67: and the approval key, which signs only in a check that holds one (`phoneKey`).
  const keys = path.join(__dirname, 'scripts/pocket/talyvor-keys.js')
  const next = config.resolver.resolveRequest
  config.resolver.resolveRequest = (context, name, platform) =>
    platform === 'web' && name === 'expo-secure-store'
      ? { type: 'sourceFile', filePath: shim }
      : platform === 'web' && name.endsWith('/modules/talyvor-keys')
        ? { type: 'sourceFile', filePath: keys }
        : (next ?? context.resolveRequest)(context, name, platform)
}

module.exports = config
