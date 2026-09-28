import { BadRequestException } from '@nestjs/common'

/** When assignmentFee is sent, market must equal purchase + fee. Not persisted on the listing. */
export function assertMarketEqualsPurchasePlusFee(pricing: {
  purchasePrice?: number
  assignmentFeeHigh?: number
  assignmentFee?: number
}) {
  if (pricing.assignmentFee == null) {
    const purchase = pricing.purchasePrice ?? 0
    const high = pricing.assignmentFeeHigh ?? 0
    if (purchase > 0 && high > 0 && high < purchase) {
      throw new BadRequestException(
        'Market price must be at least the purchase price (purchase + assignment fee).',
      )
    }
    return
  }

  if (!(pricing.assignmentFee > 0)) {
    throw new BadRequestException('Assignment fee must be greater than zero.')
  }

  const purchase = pricing.purchasePrice ?? 0
  const high = pricing.assignmentFeeHigh ?? 0
  const expected = purchase + pricing.assignmentFee
  if (Math.abs(high - expected) > 0.009) {
    throw new BadRequestException(
      'Market price must equal purchase price plus assignment fee.',
    )
  }
}

export function assertSellerPricing(pricing: {
  assignmentFeeLow?: number
  assignmentFeeHigh?: number
  purchasePrice?: number
  rehabTotal?: number
  estimatedHoldingCosts?: number
  assignmentFee?: number
}) {
  assertMarketEqualsPurchasePlusFee(pricing)

  if (!((pricing.assignmentFeeLow ?? 0) > 0) || !((pricing.assignmentFeeHigh ?? 0) > 0)) {
    throw new BadRequestException(
      'Complete required fields before publishing: assignmentFeeLow, assignmentFeeHigh',
    )
  }
}
