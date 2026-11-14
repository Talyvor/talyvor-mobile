// B57.67 — this phone's approval key in pocket-shots' web export (metro.config.js swaps it in): it signs only in a check
// that holds one (`phoneKey`), and only against the shots' BFF. Elsewhere there is no key, as on the web. B57.146: a check
// with `newKey` holds none yet but can make one, so Turn on registers it with the shots' BFF.
if (process.env.EXPO_PUBLIC_BFF_URL !== 'https://bff.pocket-shots.invalid') throw new Error('the pocket-shots key loads only against the shots BFF')

export default globalThis.__POCKET_SHOTS_PHONE_KEY
  ? {
      isAvailable: () => true,
      sign: async () => 'pocket-shots',
      deleteKey: async () => undefined,
    }
  : globalThis.__POCKET_SHOTS_NEW_KEY
    ? {
        isAvailable: () => true,
        createKey: async () => 'cG9ja2V0LXNob3Rz',
        attest: async (_alias, binding) => binding,
        sign: async () => 'pocket-shots',
        deleteKey: async () => undefined,
      }
    : null
