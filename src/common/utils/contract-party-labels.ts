import { UserRole } from '../enums/user-role.enum'

/** Display label for the listing owner (lister) side of an App2 contract. */
export function listerRoleLabel(role: UserRole): string {
  if (role === UserRole.REALTOR) return 'Listing Realtor'
  return 'Wholesaler'
}

/** Display label for the purchaser side of an App2 contract. */
export function purchaserRoleLabel(role: UserRole): string {
  if (role === UserRole.REALTOR) return 'Purchasing Realtor'
  return 'Buyer'
}
