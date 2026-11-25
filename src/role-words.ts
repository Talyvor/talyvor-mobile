import type { GivenRole } from '@talyvor/bff-client'

// B28.463 — the roles' names and what each may do, in the web's words (suite B28.70, apps/web/src/areas/lens/rolesApi.ts),
// as Lens enforces them (talyvor-lens internal/auth/roles.go).

export type Role = GivenRole['role']

export const ROLES: readonly Role[] = ['viewer', 'finance', 'approver', 'admin']

export const ROLE_NAME: Record<Role, string> = { viewer: 'Viewer', finance: 'Finance', approver: 'Approver', admin: 'Admin' }

export const ROLE_LINE: Record<Role, string> = {
  viewer: 'Sees everything. Moves, approves and changes nothing.',
  finance: 'Sees everything, and adds, pays, sends and converts money.',
  approver: 'Sees everything, and approves or declines what waits for approval.',
  admin: 'Everything but keys, passkeys and roles, which stay the owner’s.',
}

export const roleName = (r: string) => ROLE_NAME[r as Role] ?? r
