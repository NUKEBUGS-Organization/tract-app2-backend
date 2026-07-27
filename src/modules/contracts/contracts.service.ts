import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Contract, ContractDocument } from './schemas/contract.schema'
import { Bid, BidDocument } from '../bids/schemas/bid.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { CreateContractDto } from './dto/create-contract.dto'
import { MyContractsQueryDto } from './dto/my-contracts-query.dto'
import { CloudinaryService } from '../../common/services/cloudinary.service'
import { generateContractPdf } from '../../common/utils/contract-pdf.generator'
import {
  listerRoleLabel,
  purchaserRoleLabel,
} from '../../common/utils/contract-party-labels'
import { DocuSealService } from '../../docuseal/docuseal.service'
import { BidStatus } from '../../common/enums/bid-status.enum'
import { ContractStatus } from '../../common/enums/contract-status.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import axios from 'axios'
import { NotificationsService } from '../notifications/notifications.service'
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/schemas/notification.schema'
import { DealsService } from '../deals/deals.service'

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name)

  constructor(
    @InjectModel(Contract.name)
    private readonly contractModel: Model<ContractDocument>,
    @InjectModel(Bid.name)
    private readonly bidModel: Model<BidDocument>,
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly docuSealService: DocuSealService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => DealsService))
    private readonly dealsService: DealsService,
  ) {}

  async createContract(
    listingId: string,
    listerUserId: string,
    dto: CreateContractDto,
  ): Promise<ContractDocument> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const listing = await this.listingModel.findById(listingId)
    if (!listing) {
      throw new NotFoundException('Listing not found.')
    }

    if (listing.wholesalerId.toString() !== listerUserId) {
      throw new ForbiddenException('You do not own this listing.')
    }

    if (!Types.ObjectId.isValid(dto.bidId)) {
      throw new NotFoundException('Bid not found.')
    }

    const bid = await this.bidModel.findById(dto.bidId)
    if (!bid) {
      throw new NotFoundException('Bid not found.')
    }

    if (bid.listingId.toString() !== listingId) {
      throw new BadRequestException('Bid does not belong to this listing.')
    }

    if (bid.status !== BidStatus.PRIMARY) {
      throw new BadRequestException('Only the primary (selected) bid can create a contract.')
    }

    const existing = await this.contractModel.findOne({ bidId: bid._id })
    if (existing) {
      if (existing.status === ContractStatus.CANCELLED) {
        await this.contractModel.findByIdAndDelete(existing._id).exec()
      } else {
        return existing
      }
    }

    const [lister, purchaser] = await Promise.all([
      this.userModel.findById(listing.wholesalerId),
      this.userModel.findById(bid.buyerId),
    ])

    if (!lister || !purchaser) {
      throw new NotFoundException('Lister or purchaser not found.')
    }

    const listerLabel = listerRoleLabel(lister.role as UserRole)
    const purchaserLabel = purchaserRoleLabel(purchaser.role as UserRole)

    const propertyLine = [listing.propertyAddress, listing.city, listing.stateCode, listing.zipCode]
      .filter(Boolean)
      .join(', ')

    const assignmentPrice = bid.assignmentPrice
    const emdAmount = dto.emdAmount ?? bid.emdAmount ?? Math.min(1000, assignmentPrice)
    const closingDays = dto.closingDays ?? 120
    const effectiveDate = new Date()

    const pdfBuffer = await generateContractPdf({
      listerLabel,
      purchaserLabel,
      listerName: lister.fullName,
      listerAddress: propertyLine,
      purchaserName: `${purchaser.fullName} and/or Assigns`,
      purchaserAddress: dto.purchaserAddress ?? 'On File',
      propertyAddress: propertyLine,
      propertyBlock: dto.propertyBlock,
      propertyLot: dto.propertyLot,
      assignmentPrice,
      emdAmount,
      balanceAmount: assignmentPrice - emdAmount,
      closingDays,
      effectiveDate,
    })

    const uploadResult = await this.cloudinaryService.uploadFile(
      pdfBuffer,
      `contracts/${listing._id}`,
      `contract_${bid._id}.pdf`,
      'application/pdf',
    )

    const contract = await this.contractModel.create({
      listingId: listing._id,
      bidId: bid._id,
      wholesalerId: listing.wholesalerId,
      buyerId: bid.buyerId,
      assignmentFeeFinal: assignmentPrice,
      pdfUrl: uploadResult.secure_url,
      status: ContractStatus.PENDING,
    })

    const mergeFields = {
      ListerLabel: listerLabel,
      PurchaserLabel: purchaserLabel,
      ListerName: lister.fullName,
      PurchaserName: `${purchaser.fullName} and/or Assigns`,
      PropertyAddress: propertyLine,
      PurchasePrice: assignmentPrice,
      EMDAmount: emdAmount,
      ClosingDays: closingDays,
    }

    try {
      const submission = await this.docuSealService.createSubmission([
        {
          role: 'Lister',
          email: lister.email,
          name: lister.fullName,
          external_id: `${contract._id}:lister`,
          values: mergeFields,
        },
        {
          role: 'Purchaser',
          email: purchaser.email,
          name: purchaser.fullName,
          external_id: `${contract._id}:purchaser`,
          values: mergeFields,
        },
      ])

      const listerSubmitter = submission.submitters.find((s) => s.role === 'Lister')
      const purchaserSubmitter = submission.submitters.find((s) => s.role === 'Purchaser')

      contract.docusealSubmissionId = String(submission.id)
      if (listerSubmitter) {
        contract.docusealWholesalerSubmitterId = String(listerSubmitter.id)
        contract.docusealWholesalerEmbedSrc = listerSubmitter.embed_src
        contract.docusealWholesalerStatus = listerSubmitter.status ?? 'pending'
      }
      if (purchaserSubmitter) {
        contract.docusealBuyerSubmitterId = String(purchaserSubmitter.id)
        contract.docusealBuyerEmbedSrc = purchaserSubmitter.embed_src
        contract.docusealBuyerStatus = purchaserSubmitter.status ?? 'pending'
      }

      await contract.save()

      this.logger.log(
        `DocuSeal submission ${submission.id} linked to contract ${contract._id}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      this.logger.error(
        `Failed to create DocuSeal submission for contract ${contract._id}: ${message}`,
        stack,
      )
      await this.contractModel.findByIdAndDelete(contract._id).exec()
      throw new BadRequestException(
        `Failed to create DocuSeal signing session: ${message}`,
      )
    }

    await this.notificationsService.create({
      userId: lister._id.toString(),
      channel: NotificationChannel.IN_APP,
      type: NotificationType.CONTRACT_READY,
      title: 'Contract ready — sign first',
      body: `A purchase contract for ${propertyLine || 'your listing'} is ready. Sign as lister, then the purchaser can sign.`,
      listingId: listing._id.toString(),
    })

    await this.notificationsService.create({
      userId: purchaser._id.toString(),
      channel: NotificationChannel.IN_APP,
      type: NotificationType.CONTRACT_READY,
      title: 'Contract ready for your signature',
      body: `A purchase contract for ${propertyLine || 'your listing'} is ready. Sign after the lister completes their signature.`,
      listingId: listing._id.toString(),
    })

    return contract
  }

  async getSignUrl(
    contractId: string,
    userId: string,
  ): Promise<{ embed_src: string }> {
    if (!Types.ObjectId.isValid(contractId)) {
      throw new NotFoundException('Contract not found.')
    }

    const contract = await this.contractModel.findById(contractId)
    if (!contract) {
      throw new NotFoundException('Contract not found.')
    }

    if (!contract.docusealSubmissionId) {
      throw new BadRequestException(
        'DocuSeal submission has not been created for this contract yet',
      )
    }

    const isLister = contract.wholesalerId.toString() === userId
    const isPurchaser = contract.buyerId.toString() === userId

    if (!isLister && !isPurchaser) {
      throw new ForbiddenException('You are not a party to this contract')
    }

    if (contract.status === ContractStatus.CANCELLED) {
      throw new BadRequestException('This contract has been cancelled')
    }

    if (contract.status === ContractStatus.SIGNED) {
      throw new BadRequestException('This contract has already been signed')
    }

    // App1-style order: lister signs first; purchaser unlocks after.
    if (isPurchaser && !contract.wholesalerSignedAt) {
      throw new BadRequestException(
        'Waiting for the lister to sign before your signing link is available.',
      )
    }

    const embedSrc = isLister
      ? contract.docusealWholesalerEmbedSrc
      : contract.docusealBuyerEmbedSrc

    if (!embedSrc) {
      throw new BadRequestException(
        'Signing URL not available yet. Please try again shortly.',
      )
    }

    return { embed_src: embedSrc }
  }

  async myContracts(userId: string, query: MyContractsQueryDto) {
    const page = query.page ?? 1
    const limit = query.limit ?? 20

    const filter = {
      $or: [
        { wholesalerId: new Types.ObjectId(userId) },
        { buyerId: new Types.ObjectId(userId) },
      ],
    }

    const [data, total] = await Promise.all([
      this.contractModel
        .find(filter)
        .populate('listingId', 'propertyAddress city stateCode assignmentFeeHigh')
        .populate('wholesalerId', 'fullName email role')
        .populate('buyerId', 'fullName email role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.contractModel.countDocuments(filter),
    ])

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async getContractByListing(listingId: string, userId: string) {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const listing = await this.listingModel.findById(listingId)
    if (!listing) {
      throw new NotFoundException('Listing not found.')
    }

    const primaryBid = await this.bidModel.findOne({
      listingId: listing._id,
      status: BidStatus.PRIMARY,
    })

    const isLister = listing.wholesalerId.toString() === userId
    const isPurchaser = primaryBid?.buyerId?.toString() === userId

    if (!isLister && !isPurchaser) {
      throw new ForbiddenException('You are not a party to this contract flow.')
    }

    const contract = await this.contractModel
      .findOne({
        listingId: listing._id,
        status: { $ne: ContractStatus.CANCELLED },
      })
      .sort({ createdAt: -1 })
      .populate('listingId', 'propertyAddress city stateCode zipCode')
      .populate('wholesalerId', 'fullName email role')
      .populate('buyerId', 'fullName email role')
      .exec()

    if (!contract) {
      throw new NotFoundException('Contract not found.')
    }

    return contract
  }

  /**
   * Called by the DocuSeal webhook when a submitter completes signing.
   * Validates the secret, updates timestamps, and marks the contract signed
   * once both parties have completed.
   */
  async handleDocuSealWebhook(
    secret: string,
    event: any,
  ): Promise<{ ok: boolean }> {
    if (secret !== this.docuSealService.webhookSecret) {
      throw new UnauthorizedException('Invalid webhook secret')
    }

    const eventType = event?.event_type
    const data = event?.data || {}

    this.logger.log(
      `DocuSeal webhook processing: event_type=${eventType}, data=${JSON.stringify(data)}`,
    )

    const allowedEvents = ['submitter_completed', 'form.completed']

    if (!allowedEvents.includes(eventType)) {
      this.logger.log(`Ignoring DocuSeal event: ${eventType}`)
      return { ok: true }
    }

    const externalId =
      data?.external_id ||
      data?.submitter?.external_id ||
      data?.form?.external_id ||
      ''

    const submissionId =
      data?.submission_id ||
      data?.submission?.id ||
      data?.submission?.submission_id ||
      ''

    const submitterId =
      data?.id || data?.submitter_id || data?.submitter?.id || ''

    let contractId = ''
    let role = ''

    if (externalId && externalId.includes(':')) {
      const parts = String(externalId).split(':')
      contractId = parts[0] ?? ''
      role = parts[1] ?? ''
    }

    let contract: ContractDocument | null = null

    if (contractId) {
      contract = await this.contractModel.findById(contractId)
    }

    if (!contract && submissionId) {
      contract = await this.contractModel.findOne({
        docusealSubmissionId: String(submissionId),
      })
    }

    if (!contract && submitterId) {
      contract = await this.contractModel.findOne({
        $or: [
          { docusealWholesalerSubmitterId: String(submitterId) },
          { docusealBuyerSubmitterId: String(submitterId) },
        ],
      })
    }

    if (!contract) {
      this.logger.warn(
        `DocuSeal webhook: contract not found. external_id=${externalId}, submission_id=${submissionId}, submitter_id=${submitterId}`,
      )

      return { ok: true }
    }

    if (!role && submitterId) {
      if (
        String(contract.docusealWholesalerSubmitterId) === String(submitterId)
      ) {
        role = 'lister'
      }

      if (String(contract.docusealBuyerSubmitterId) === String(submitterId)) {
        role = 'purchaser'
      }
    }

    if (!role && data?.role) {
      role = String(data.role).toLowerCase()
    }

    if (role === 'lister' || role === 'Lister') {
      contract.wholesalerSignedAt = contract.wholesalerSignedAt ?? new Date()
      contract.docusealWholesalerStatus = 'completed'

      this.logger.log(`Lister signed contract ${contract._id}`)
    } else if (role === 'purchaser' || role === 'Purchaser') {
      contract.buyerSignedAt = contract.buyerSignedAt ?? new Date()
      contract.docusealBuyerStatus = 'completed'

      this.logger.log(`Purchaser signed contract ${contract._id}`)
    } else {
      this.logger.warn(
        `DocuSeal webhook: could not identify signer role. contract=${contract._id}, external_id=${externalId}, submitter_id=${submitterId}, role=${role}`,
      )

      return { ok: true }
    }

    if (contract.wholesalerSignedAt && contract.buyerSignedAt) {
      const alreadyExecuted = contract.status === ContractStatus.SIGNED
      contract.status = ContractStatus.SIGNED

      const signedUrl =
        data?.submission?.documents?.[0]?.url ??
        data?.documents?.[0]?.url ??
        null

      const auditUrl =
        data?.submission?.audit_log_url ?? data?.audit_log_url ?? null

      let uploadedSignedPdfUrl: string | null = contract.signedPdfUrl ?? null
      try {
        uploadedSignedPdfUrl = await this.uploadSignedPdfFromDocuSeal(
          contract,
          signedUrl,
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error ? error.stack : undefined
        this.logger.error(
          `Failed to persist signed PDF for contract ${contract._id}: ${message}`,
          stack,
        )
      }

      if (uploadedSignedPdfUrl) {
        contract.signedPdfUrl = uploadedSignedPdfUrl
      }

      if (auditUrl) {
        contract.auditLogUrl = auditUrl
      }

      // TODO: Deal creation/linking is intentionally deferred to a later pass.
      await contract.save()
      this.logger.log(`Contract ${contract._id} fully signed`)

      if (!alreadyExecuted) {
        try {
          await this.dealsService.createDealFromContract(contract._id.toString())
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const stack = err instanceof Error ? err.stack : undefined
          this.logger.error(
            `Failed to create deal from contract ${contract._id}: ${message}`,
            stack,
          )
        }

        const listing = await this.listingModel
          .findById(contract.listingId)
          .select('propertyAddress city stateCode zipCode')
          .lean()
        const propertyLine = [
          listing?.propertyAddress,
          listing?.city,
          listing?.stateCode,
          listing?.zipCode,
        ]
          .filter(Boolean)
          .join(', ')

        const executedBody = `The purchase contract for ${propertyLine || 'your listing'} has been signed by both parties.`

        await this.notificationsService.create({
          userId: contract.wholesalerId.toString(),
          channel: NotificationChannel.IN_APP,
          type: NotificationType.CONTRACT_EXECUTED,
          title: 'Contract fully executed',
          body: executedBody,
          listingId: contract.listingId.toString(),
        })

        await this.notificationsService.create({
          userId: contract.buyerId.toString(),
          channel: NotificationChannel.IN_APP,
          type: NotificationType.CONTRACT_EXECUTED,
          title: 'Contract fully executed',
          body: executedBody,
          listingId: contract.listingId.toString(),
        })
      }
    } else {
      await contract.save()
    }

    return { ok: true }
  }

  async cancelContract(contractId: string, userId: string): Promise<ContractDocument> {
    if (!Types.ObjectId.isValid(contractId)) {
      throw new NotFoundException('Contract not found.')
    }

    const contract = await this.contractModel.findById(contractId)
    if (!contract) {
      throw new NotFoundException('Contract not found.')
    }

    const user = await this.userModel.findById(userId)
    const isLister = contract.wholesalerId.toString() === userId
    const isPurchaser = contract.buyerId.toString() === userId
    const isAdmin = user?.role === UserRole.ADMIN

    if (!isLister && !isPurchaser && !isAdmin) {
      throw new ForbiddenException('You are not a party to this contract.')
    }

    if (contract.status === ContractStatus.CANCELLED) {
      throw new ConflictException('Contract is already cancelled.')
    }

    if (contract.status === ContractStatus.SIGNED) {
      throw new BadRequestException(
        'Fully signed contracts cannot be cancelled here. Contact support if needed.',
      )
    }

    contract.status = ContractStatus.CANCELLED
    await contract.save()

    try {
      await this.dealsService.demoteBidAndPromoteBackup(
        contract.bidId,
        contract.listingId,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      this.logger.error(
        `Failed to cascade-cancel bid/listing for contract ${contractId}: ${message}`,
        stack,
      )
    }

    return contract
  }

  async getSignedPdfUrl(
    contractId: string,
    userId: string,
  ): Promise<{ url: string }> {
    if (!Types.ObjectId.isValid(contractId)) {
      throw new NotFoundException('Contract not found.')
    }

    const contract = await this.contractModel.findById(contractId)
    if (!contract) {
      throw new NotFoundException('Contract not found.')
    }

    const isParty =
      contract.wholesalerId.toString() === userId ||
      contract.buyerId.toString() === userId
    if (!isParty) {
      const user = await this.userModel.findById(userId)
      if (user?.role !== UserRole.ADMIN) {
        throw new ForbiddenException('You are not a party to this contract.')
      }
    }

    if (contract.status !== ContractStatus.SIGNED || !contract.signedPdfUrl) {
      throw new BadRequestException('Signed PDF is not available yet.')
    }

    return { url: contract.signedPdfUrl }
  }

  private async uploadSignedPdfFromDocuSeal(
    contract: ContractDocument,
    signedUrlFromEvent: string | null,
  ): Promise<string | null> {
    let signedUrl = signedUrlFromEvent
    let auditUrl: string | null = null

    if (!signedUrl && contract.docusealSubmissionId) {
      try {
        const submission = await this.docuSealService.getSubmission(
          contract.docusealSubmissionId,
        )
        signedUrl =
          submission.documents?.[0]?.url ??
          signedUrl ??
          null
        auditUrl = submission.audit_log_url ?? null
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Failed to fetch DocuSeal submission ${contract.docusealSubmissionId} for signed PDF: ${message}`,
        )
      }
    }

    if (auditUrl && !contract.auditLogUrl) {
      contract.auditLogUrl = auditUrl
    }

    if (!signedUrl) {
      return contract.signedPdfUrl ?? null
    }

    if (contract.signedPdfUrl) {
      return contract.signedPdfUrl
    }

    const response = await axios.get<ArrayBuffer>(signedUrl, {
      responseType: 'arraybuffer',
    })

    const uploadResult = await this.cloudinaryService.uploadFile(
      Buffer.from(response.data),
      `contracts/${contract.listingId}`,
      `signed_contract_${contract._id}.pdf`,
      'application/pdf',
    )

    return uploadResult.secure_url
  }
}
