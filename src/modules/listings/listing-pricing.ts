import { BadRequestException } from '@nestjs/common'

export function assertSellerPricing(pricing: {
  assignmentFeeLow?: number; assignmentFeeHigh?: number; purchasePrice?: number
  rehabTotal?: number; estimatedHoldingCosts?: number
}) {
  const profit = Math.min(pricing.assignmentFeeLow ?? 0, pricing.assignmentFeeHigh ?? 0)
    - (pricing.purchasePrice ?? 0) - (pricing.rehabTotal ?? 0) - (pricing.estimatedHoldingCosts ?? 0)
  if (profit < 0) {
    const loss = (-profit).toLocaleString('en-US', { maximumFractionDigits: 2 })
    throw new BadRequestException(
      `The current pricing will cause a $${loss} loss to you. Please adjust the pricing to move forward.`,
    )
  }
  if (!((pricing.assignmentFeeLow ?? 0) > 0) || !((pricing.assignmentFeeHigh ?? 0) > 0)) {
    throw new BadRequestException('Complete required fields before publishing: assignmentFeeLow, assignmentFeeHigh')
  }
}
