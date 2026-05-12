import { KycStatus } from '../../../common/enums/kyc-status.enum'
import { UserRole } from '../../../common/enums/user-role.enum'

/** Serialized user returned to clients (matches frontend `User` shape) */
export class PublicUserDto {
  id: string
  email: string
  phone: string
  role: UserRole
  fullName: string
  kycStatus: KycStatus
  bankVerified: boolean
  reliabilityScore: number
  professionalScore: number
  activeDealsCount: number
  isBanned: boolean
  lastActiveAt: string
  createdAt: string
}
