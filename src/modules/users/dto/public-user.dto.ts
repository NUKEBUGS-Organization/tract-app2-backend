import { UserRole } from '../../../common/enums/user-role.enum'

/** Serialized user returned to clients (matches frontend `User` shape) */
export class PublicUserDto {
  id: string
  email: string
  phone: string
  role: UserRole
  fullName: string
  stateCode?: string
  kycStatus: string
  kycVerifiedAt?: string | null
  bankVerified: boolean
  reliabilityScore: number
  professionalScore: number
  isBanned: boolean
  banReason?: string | null
  scoreRestrictedUntil?: string | null
  app2_activeDealsCount: number
  app2_totalDealsClosed: number
  app2_isVettedBuyer: boolean
  app2_reactivationFeePending: boolean
  app2_platformFeePaid: boolean
  licenseNumber?: string | null
  brokerageName?: string | null
  commissionPct?: number | null
  defaultAgencyRole?: string | null
  lastActiveAt: string | null
  createdAt: string
}
