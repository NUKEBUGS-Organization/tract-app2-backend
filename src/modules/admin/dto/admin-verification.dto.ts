export class PendingUserDto {
  id!: string
  fullName!: string
  email!: string
  phone!: string
  role!: string
  stateCode!: string
  kycStatus!: string
  bankVerified!: boolean
  createdAt!: string
  licenseNumber?: string | null
  brokerageName?: string | null
}
