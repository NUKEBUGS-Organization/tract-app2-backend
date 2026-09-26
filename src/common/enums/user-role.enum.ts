export enum UserRole {
  // Shared (App 1 + App 2)
  WHOLESALER = 'wholesaler',
  REALTOR = 'realtor',
  ADMIN = 'admin',

  // App 1 only (kept here so shared 'users'
  // collection documents are never rejected
  // by Mongoose enum validation)
  SELLER = 'seller',
  PARTNER = 'partner',
  PRIVATE_PARTNER = 'private_partner',
  LICENSED = 'licensed',
  LICENSED_PARTNER = 'licensed_partner',

  // App 2 only
  BUYER = 'buyer',
  TITLE_REP = 'title_rep',
}

// Roles allowed to log into App 2
export const APP2_ALLOWED_ROLES: UserRole[] = [
  UserRole.WHOLESALER,
  UserRole.PARTNER,
  UserRole.PRIVATE_PARTNER,
  UserRole.REALTOR,
  UserRole.LICENSED,
  UserRole.LICENSED_PARTNER,
  UserRole.BUYER,
  UserRole.TITLE_REP,
  UserRole.ADMIN,
]

// Roles NOT allowed on App 2
export const APP2_BLOCKED_ROLES: UserRole[] = [UserRole.SELLER]

export function normalizeApp2Role(role: UserRole | string | null | undefined): UserRole | string | null | undefined {
  switch (role) {
    case UserRole.PARTNER:
    case UserRole.PRIVATE_PARTNER:
      return UserRole.WHOLESALER
    case UserRole.LICENSED:
    case UserRole.LICENSED_PARTNER:
      return UserRole.REALTOR
    default:
      return role
  }
}
