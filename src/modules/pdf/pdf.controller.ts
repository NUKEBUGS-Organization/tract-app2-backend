import {
  Controller,
  Get,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import type { Response } from 'express'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { PdfService } from './pdf.service'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { Contract, ContractDocument } from '../contracts/schemas/contract.schema'
import { ContractStatus } from '../../common/enums/contract-status.enum'
import { generateContractPdf } from '../../common/utils/contract-pdf.generator'
import axios from 'axios'

@ApiTags('pdf')
@ApiBearerAuth('JWT-auth')
@Controller('pdf')
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(Contract.name)
    private readonly contractModel: Model<ContractDocument>,
  ) {}

  @Get('contract/:dealId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download signed DocuSeal PDF when available, else generated draft',
  })
  async downloadContract(@Param('dealId') dealId: string, @Res() res: Response) {
    const deal = await this.dealModel
      .findById(dealId)
      .populate('listingId', 'propertyAddress city stateCode')
      .populate('primaryBuyerId', 'fullName')
      .populate('wholesalerId', 'fullName')
      .populate('primaryBidId', 'assignmentPrice')
      .lean()

    if (!deal) {
      throw new NotFoundException('Deal not found.')
    }

    let signedUrl: string | null = null
    if (deal.contractId) {
      const contract = await this.contractModel.findById(deal.contractId).lean()
      if (contract?.status === ContractStatus.SIGNED && contract.signedPdfUrl) {
        signedUrl = contract.signedPdfUrl
      }
    }
    if (!signedUrl) {
      const byListing = await this.contractModel
        .findOne({ listingId: deal.listingId, status: ContractStatus.SIGNED })
        .lean()
      if (byListing?.signedPdfUrl) {
        signedUrl = byListing.signedPdfUrl
      }
    }

    if (signedUrl) {
      try {
        const response = await axios.get<ArrayBuffer>(signedUrl, {
          responseType: 'arraybuffer',
        })
        const buffer = Buffer.from(response.data)
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="signed-contract-${dealId.slice(-6)}.pdf"`,
          'Content-Length': buffer.length,
        })
        res.end(buffer)
        return
      } catch {
        // Fall through to generated PDF
      }
    }

    const listing = deal.listingId as {
      propertyAddress?: string
      city?: string
      stateCode?: string
    } | null
    const buyer = deal.primaryBuyerId as { fullName?: string } | null
    const wholesaler = deal.wholesalerId as { fullName?: string } | null
    const bid = deal.primaryBidId as { assignmentPrice?: number } | null

    const propertyLine = [listing?.propertyAddress, listing?.city, listing?.stateCode]
      .filter(Boolean)
      .join(', ')
    const assignmentPrice = bid?.assignmentPrice ?? 0
    const emdAmount = deal.emdAmount ?? 0

    try {
      const buffer = await generateContractPdf({
        listerLabel: 'Seller',
        purchaserLabel: 'Buyer',
        listerName: wholesaler?.fullName ?? 'Seller',
        listerAddress: propertyLine || 'On File',
        purchaserName: `${buyer?.fullName ?? 'Buyer'} and/or Assigns`,
        purchaserAddress: 'On File',
        propertyAddress: propertyLine || '—',
        propertyCounty: listing?.stateCode,
        assignmentPrice,
        emdAmount,
        balanceAmount: Math.max(0, assignmentPrice - emdAmount),
        closingDays: 120,
        feasibilityDays: 45,
        effectiveDate: deal.contractSignedAt ?? new Date(),
      })

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="contract-${dealId.slice(-6)}.pdf"`,
        'Content-Length': buffer.length,
      })
      res.end(buffer)
    } catch {
      throw new InternalServerErrorException('Failed to generate PDF.')
    }
  }

  @Get('emd/:dealId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download EMD instructions PDF' })
  async downloadEmd(@Param('dealId') dealId: string, @Res() res: Response) {
    const deal = await this.dealModel
      .findById(dealId)
      .populate('listingId', 'propertyAddress city stateCode')
      .populate('primaryBuyerId', 'fullName')
      .lean()

    if (!deal) {
      throw new NotFoundException('Deal not found.')
    }

    const listing = deal.listingId as {
      propertyAddress?: string
      city?: string
      stateCode?: string
    } | null
    const buyer = deal.primaryBuyerId as { fullName?: string } | null

    try {
      const buffer = await this.pdfService.generateEmdPdf({
        dealRef: `TRACT-${dealId.slice(-6).toUpperCase()}`,
        propertyAddress: listing?.propertyAddress ?? '—',
        city: listing?.city ?? '—',
        stateCode: listing?.stateCode ?? '—',
        buyerName: buyer?.fullName ?? 'Buyer',
        emdAmount: deal.emdAmount ?? 0,
        bankName: deal.titleCompanyName || 'First American Title',
        accountNumber: '****4821',
        routingNumber: '****0210',
        dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toLocaleDateString('en-US'),
      })

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="emd-instructions-${dealId.slice(-6)}.pdf"`,
        'Content-Length': buffer.length,
      })
      res.end(buffer)
    } catch {
      throw new InternalServerErrorException('Failed to generate PDF.')
    }
  }
}
