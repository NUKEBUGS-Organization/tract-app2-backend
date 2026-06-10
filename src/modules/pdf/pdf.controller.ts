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

@ApiTags('pdf')
@ApiBearerAuth('JWT-auth')
@Controller('pdf')
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
  ) {}

  @Get('contract/:dealId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download contract PDF' })
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

    const listing = deal.listingId as {
      propertyAddress?: string
      city?: string
      stateCode?: string
    } | null
    const buyer = deal.primaryBuyerId as { fullName?: string } | null
    const wholesaler = deal.wholesalerId as { fullName?: string } | null
    const bid = deal.primaryBidId as { assignmentPrice?: number } | null

    try {
      const buffer = await this.pdfService.generateContractPdf({
        contractRef: `TRACT-${dealId.slice(-6).toUpperCase()}`,
        propertyAddress: listing?.propertyAddress ?? '—',
        city: listing?.city ?? '—',
        stateCode: listing?.stateCode ?? '—',
        buyerName: buyer?.fullName ?? 'Buyer',
        wholesalerName: wholesaler?.fullName ?? 'Wholesaler',
        assignmentPrice: bid?.assignmentPrice ?? 0,
        emdAmount: deal.emdAmount ?? 0,
        inspectionDays: 7,
        signedAt: deal.contractSignedAt?.toISOString() ?? new Date().toISOString(),
        dealId,
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
