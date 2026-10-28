// Jest: the window's capture flags, which jest-expo does not stand in for; src/__tests__/security.test.tsx reads the calls.
export const preventScreenCaptureAsync = jest.fn(async () => undefined)
export const allowScreenCaptureAsync = jest.fn(async () => undefined)
export const enableAppSwitcherProtectionAsync = jest.fn(async () => undefined)
export const disableAppSwitcherProtectionAsync = jest.fn(async () => undefined)
