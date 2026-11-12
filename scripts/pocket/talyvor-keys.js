// B57.67 — this phone's approval key in pocket-shots' web export (metro.config.js swaps it in): it signs only in a check
// that holds one (`phoneKey`), and only against the shots' BFF. Elsewhere there is no key, as on the web.
if (process.env.EXPO_PUBLIC_BFF_URL !== 'https://bff.pocket-shots.invalid') throw new Error('the pocket-shots key loads only against the shots BFF')

export default globalThis.__POCKET_SHOTS_PHONE_KEY
  ? {
      isAvailable: () => true,
      sign: async () => 'pocket-shots',
      deleteKey: async () => undefined,
    }
  : null
