# talyvor-mobile

The Talyvor phone app (Expo and React Native) for iOS and Android: sign in, see what your agents ask you to
approve, what is safe to spend, each agent's balance and rules, pause an agent, and read the statement.

- `src/app/` — the screens (Expo Router): `sign-in`, `(tabs)/index` (Home), `(tabs)/approvals`, `(tabs)/statement`,
  `agents/[id]`.
- `packages/bff-client/` — `@talyvor/bff-client`, the typed client for the BFF's `/api/agents` routes.
- `modules/talyvor-keys/` — TalyvorKeys, the approval key: P-256 in the Secure Enclave (iPhone) or StrongBox/TEE
  (Android) that signs only after Face ID or a fingerprint. Approvals → This phone → Turn on registers it with Lens;
  signing out deletes it. Simulators have no Secure Enclave, so the tests mock the key store and the biometric check.

## Run it

```bash
npm ci
npx expo start
```

Build-time settings (`EXPO_PUBLIC_*`):

| variable | default | |
| --- | --- | --- |
| `EXPO_PUBLIC_BFF_URL` | `https://app.talyvor.com` | the BFF the app talks to |

Sign-in is the door: the phone number, the texted code, then the passcode, Face ID or a passkey. The app keeps the
session the BFF answers in the keychain.

Top-ups stay on the web: the app sells nothing and links to no purchase.

## Check it

```bash
npm run lint && npm run typecheck && npm test
```
