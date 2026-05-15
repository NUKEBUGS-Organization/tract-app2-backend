export enum UserRole {
  // Shared (App 1 + App 2)
  WHOLESALER = 'wholesaler',
  REALTOR = 'realtor',
  ADMIN = 'admin',

  // App 1 only (kept here so shared 'users'
  // collection documents are never rejected
  // by Mongoose enum validation)
  SELLER = 'seller',

  // App 2 only
  BUYER = 'buyer',
  TITLE_REP = 'title_rep',
}

// Roles allowed to log into App 2
export const APP2_ALLOWED_ROLES: UserRole[] = [
  UserRole.WHOLESALER,
  UserRole.REALTOR,
  UserRole.BUYER,
  UserRole.TITLE_REP,
  UserRole.ADMIN,
]

// Roles NOT allowed on App 2
export const APP2_BLOCKED_ROLES: UserRole[] = [UserRole.SELLER]
