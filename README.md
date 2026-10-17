# talyvor-mobile

The Talyvor phone app (Expo and React Native) for iOS and Android: sign in, see what your agents ask you to
approve, what is safe to spend, each agent's balance and rules, pause an agent, and read the statement.

- `src/app/` — the screens (Expo Router): `sign-in`, `(tabs)/index` (Home), `(tabs)/approvals`, `(tabs)/statement`,
  `agents/[id]`.
- `packages/bff-client/` — `@talyvor/bff-client`, the typed client for the BFF's `/api/agents` routes.

## Run it

```bash
npm ci
npx expo start
```

Build-time settings (`EXPO_PUBLIC_*`):

| variable | default | |
| --- | --- | --- |
| `EXPO_PUBLIC_BFF_URL` | `https://app.talyvor.com` | the BFF the app talks to |
| `EXPO_PUBLIC_OIDC_ISSUER` | `https://accounts.google.com` | the identity provider |
| `EXPO_PUBLIC_OIDC_CLIENT_ID` | empty | the provider's client for the phone app; sign-in stays off until it is set |

Sign-in runs in the phone's browser with PKCE; the app sends the ID token to the BFF's `POST /auth/mobile/session`
and keeps the session it answers in the keychain.

Top-ups stay on the web: the app sells nothing and links to no purchase.

## Check it

```bash
npm run lint && npm run typecheck && npm test
```
