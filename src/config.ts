// Set at build time from EXPO_PUBLIC_* variables; the defaults are production's public addresses.
export const config = {
  bffUrl: process.env.EXPO_PUBLIC_BFF_URL ?? 'https://app.talyvor.com',
  oidcIssuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://accounts.google.com',
  // The identity provider's client for the phone app (a public client: PKCE, no secret). Empty until it is issued.
  oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? '',
}
