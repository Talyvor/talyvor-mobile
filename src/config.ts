// Set at build time from EXPO_PUBLIC_* variables; the defaults are production's public addresses.
const bffUrl = process.env.EXPO_PUBLIC_BFF_URL ?? 'https://app.talyvor.com'
// B50.10: a release build talks to the BFF only over TLS; a development build may use a local http server.
if (!__DEV__ && !bffUrl.startsWith('https://')) throw new Error('EXPO_PUBLIC_BFF_URL must be an https:// address')

export const config = {
  bffUrl,
  oidcIssuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://accounts.google.com',
  // The identity provider's client for the phone app (a public client: PKCE, no secret). Empty until it is issued.
  oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? '',
  // "Hey Taly" (B40.16): Talyvor's Picovoice access key and the trained keyword file's path. Empty until they exist.
  picovoiceKey: process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY ?? '',
  heyTalyKeyword: process.env.EXPO_PUBLIC_HEY_TALY_KEYWORD ?? '',
}
