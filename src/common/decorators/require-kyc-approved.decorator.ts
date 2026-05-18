import { SetMetadata } from '@nestjs/common'

export const REQUIRE_KYC_APPROVED_KEY = 'requireKycApproved'

/** Require JWT user with kycStatus === approved (admin always allowed). */
export const RequireKycApproved = () => SetMetadata(REQUIRE_KYC_APPROVED_KEY, true)
