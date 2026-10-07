import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'crypto'
import { PasswordHasherService } from '../../common/crypto/password-hasher.service'
import { isMongoDuplicateKeyError } from '../../common/utils/mongo-errors'
import { normalizePhone } from '../../common/utils/phone'
import { ResendService } from '../notifications/resend.service'
import { CreateTitleRepDto } from './dto/create-title-rep.dto'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types, PipelineStage } from 'mongoose'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { Message, MessageDocument } from '../chat/schemas/message.schema'
import { Penalty, PenaltyDocument, ViolationType } from '../penalties/schemas/penalty.schema'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { KycStatus } from '../../common/enums/kyc-status.enum'
import { DealStep } from '../../common/enums/deal-step.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { assertSellerPricing } from '../listings/listing-pricing'

const VIOLATION_LABELS: Record<string, string> = {
  [ViolationType.FEE_EDIT_POST_ACCEPTANCE]: 'Fee Edit After Acceptance',
  [ViolationType.BUYER_GHOST_POST_SIGN]: 'Buyer Ghosted',
  [ViolationType.REALTOR_OFF_PLATFORM]: 'Off-Platform Contact',
  [ViolationType.FAKE_ARV_DOCS]: 'Fake ARV Documents',
  [ViolationType.BAD_FAITH_REVIEW]: 'Bad Faith Review',
  [ViolationType.CONTRACT_DISPUTE]: 'Contract Dispute',
  [ViolationType.MISSED_72HR_DEADLINE]: 'Missed 72hr Deadline',
  [ViolationType.MISSED_INSPECTION]: 'Missed Inspection',
  [ViolationType.GHOSTING]: 'Ghosting',
}

const FLAG_LABELS: Record<string, string> = {
  phone_number: 'Phone Number',
  email_address: 'Email Address',
  external_link: 'External Link',
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    @InjectModel(Listing.name) private readonly listingModel: Model<ListingDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Penalty.name) private readonly penaltyModel: Model<PenaltyDocument>,
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    private readonly passwordHasher: PasswordHasherService,
    private readonly resendService: ResendService,
    private readonly configService: ConfigService,
  ) {}

  async getDashboard() {
    try {
      const [
        pendingReviewCount,
        pendingListings,
        activeDeals,
        unresolvedPenalties,
        totalUsers,
        platformFeesAgg,
        liveListings,
        recentPenalties,
      ] = await Promise.all([
        this.listingModel.countDocuments({ status: ListingStatus.PENDING_REVIEW }),
        // Dashboard preview only — newest first so fresh submissions always show.
        // The full FIFO queue lives at GET /admin/listings/pending (paginated).
        this.listingModel
          .find({ status: ListingStatus.PENDING_REVIEW })
          .populate('wholesalerId', 'fullName email')
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
        this.dealModel.countDocuments({
          currentStep: { $ne: DealStep.FUNDED_CLOSED },
        }),
        this.penaltyModel.countDocuments({ resolved: false }),
        this.userModel.countDocuments(),
        this.userModel.aggregate([
          { $group: { _id: null, total: { $sum: '$app2_totalPlatformFeesPaid' } } },
        ]),
        this.listingModel.countDocuments({ status: ListingStatus.LIVE }),
        this.penaltyModel
          .find()
          .populate('userId', 'fullName email role')
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
      ])

      const stats = {
        pendingReview: pendingReviewCount,
        activeDeals,
        flaggedPenalties: unresolvedPenalties,
        totalUsers,
        platformRevenue: platformFeesAgg[0]?.total ?? 0,
        liveListings,
      }

      const pendingListingsMapped = pendingListings.map((l) =>
        this.mapPendingListing(l as Listing & { _id: Types.ObjectId; createdAt?: Date }),
      )

      const recentPenaltiesMapped = recentPenalties.map((p) => {
        const u = p.userId as unknown as (User & { _id?: Types.ObjectId }) | undefined
        const created = (p as Penalty & { createdAt?: Date }).createdAt
        return {
          id: p._id.toString(),
          userId: u?._id?.toString() ?? '',
          userName: u?.fullName ?? 'Unknown',
          violationType: p.violationType,
          violationLabel: VIOLATION_LABELS[p.violationType] ?? p.violationType,
          scoreDeduction: p.scoreDeduction,
          createdAt: created instanceof Date ? timeAgo(created) : '—',
          resolved: p.resolved,
          banApplied: p.banApplied,
        }
      })

      return {
        stats,
        pendingListings: pendingListingsMapped,
        recentPenalties: recentPenaltiesMapped,
      }
    } catch (err) {
      this.logger.error('getDashboard failed:', err)
      throw new InternalServerErrorException('Failed to load admin dashboard.')
    }
  }

  async getVerificationQueue() {
    try {
      const users = await this.userModel
        .find({
          $or: [
            { kycStatus: { $in: [KycStatus.PENDING, KycStatus.IN_PROGRESS] } },
            { pofStatus: 'pending' },
          ],
        })
        .sort({ createdAt: 1 })
        .lean()

      return users.map((u) => {
        const uCreated = (u as unknown as { createdAt?: Date }).createdAt
        return {
          id: u._id.toString(),
          fullName: u.fullName,
          avatarUrl: u.avatarUrl ?? null,
          email: u.email,
          phone: u.phone,
          role: u.role,
          stateCode: u.stateCode ?? '',
          kycStatus: u.kycStatus,
          bankVerified: u.bankVerified,
          pofStatus: u.pofStatus ?? 'not_submitted',
          pofDocumentUrl: u.pofDocumentUrl ?? null,
          pofDocumentType: u.pofDocumentType ?? null,
          pofSubmittedAt:
            u.pofSubmittedAt instanceof Date ? u.pofSubmittedAt.toISOString() : null,
          createdAt: uCreated instanceof Date ? uCreated.toISOString() : new Date().toISOString(),
          licenseNumber: u.licenseNumber || null,
          brokerageName: u.brokerageName || null,
        }
      })
    } catch (err) {
      this.logger.error('getVerificationQueue failed:', err)
      throw new InternalServerErrorException('Failed to load verification queue.')
    }
  }

  async reviewKyc(userId: string, action: 'approve' | 'reject') {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new NotFoundException('User not found.')
      }

      const update =
        action === 'approve'
          ? { kycStatus: KycStatus.APPROVED, kycVerifiedAt: new Date() }
          : { kycStatus: KycStatus.REJECTED }

      const user = await this.userModel.findByIdAndUpdate(userId, update, { new: true })

      if (!user) {
        throw new NotFoundException('User not found.')
      }

      this.logger.log(`KYC ${action}d for user ${userId}`)
      return {
        id: user._id.toString(),
        kycStatus: user.kycStatus,
        message: `KYC ${action}d successfully.`,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error('reviewKyc failed:', err)
      throw new InternalServerErrorException('Failed to update KYC status.')
    }
  }

  async getPenaltyLog(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit
      const [penalties, total] = await Promise.all([
        this.penaltyModel
          .find()
          .populate('userId', 'fullName email role')
          .populate('dealId', 'currentStep')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.penaltyModel.countDocuments(),
      ])

      return {
        penalties: penalties.map((p) => {
          const u = p.userId as unknown as (User & { _id?: Types.ObjectId }) | undefined
          const created = (p as Penalty & { createdAt?: Date }).createdAt
          return {
            id: p._id.toString(),
            userId: u?._id?.toString() ?? '',
            userName: u?.fullName ?? 'Unknown',
            userEmail: u?.email ?? '',
            userRole: u?.role ?? '',
            violationType: p.violationType,
            violationLabel: VIOLATION_LABELS[p.violationType] ?? p.violationType,
            scoreDeduction: p.scoreDeduction,
            automatedPenalties: (p.automatedPenalties ?? []).map(String),
            banApplied: p.banApplied,
            banExpiresAt: p.banExpiresAt instanceof Date ? p.banExpiresAt.toISOString() : null,
            resolved: p.resolved,
            resolvedAt: p.resolvedAt instanceof Date ? p.resolvedAt.toISOString() : null,
            resolutionNotes: p.resolutionNotes ?? '',
            dealId: p.dealId ? p.dealId.toString() : null,
            listingId: p.listingId ? p.listingId.toString() : null,
            createdAt: created instanceof Date ? created.toISOString() : new Date().toISOString(),
          }
        }),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      }
    } catch (err) {
      this.logger.error('getPenaltyLog failed:', err)
      throw new InternalServerErrorException('Failed to load penalty log.')
    }
  }

  async resolvePenalty(penaltyId: string, adminId: string, notes?: string) {
    try {
      if (!Types.ObjectId.isValid(penaltyId)) {
        throw new NotFoundException('Penalty not found.')
      }
      const penalty = await this.penaltyModel.findByIdAndUpdate(
        penaltyId,
        {
          resolved: true,
          resolvedBy: new Types.ObjectId(adminId),
          resolvedAt: new Date(),
          resolutionNotes: notes ?? '',
        },
        { new: true },
      )
      if (!penalty) {
        throw new NotFoundException('Penalty not found.')
      }
      this.logger.log(`Penalty ${penaltyId} resolved by ${adminId}`)
      return {
        id: penalty._id.toString(),
        resolved: penalty.resolved,
        resolvedAt: penalty.resolvedAt?.toISOString() ?? null,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error('resolvePenalty failed:', err)
      throw new InternalServerErrorException('Failed to resolve penalty.')
    }
  }

  async banUser(userId: string, adminId: string, reason: string, permanent: boolean, durationDays?: number) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new NotFoundException('User not found.')
      }
      const banExpiresAt = permanent ? null : durationDays ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) : null

      const user = await this.userModel.findByIdAndUpdate(
        userId,
        {
          isBanned: true,
          banReason: reason,
          banExpiresAt,
        },
        { new: true },
      )
      if (!user) {
        throw new NotFoundException('User not found.')
      }
      this.logger.warn(`User ${userId} banned by admin ${adminId}: ${reason}`)
      return {
        id: user._id.toString(),
        isBanned: true,
        banReason: user.banReason,
        banExpiresAt: user.banExpiresAt?.toISOString() ?? null,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error('banUser failed:', err)
      throw new InternalServerErrorException('Failed to ban user.')
    }
  }

  async unbanUser(userId: string, adminId: string) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new NotFoundException('User not found.')
      }
      const user = await this.userModel.findByIdAndUpdate(
        userId,
        {
          isBanned: false,
          banReason: null,
          banExpiresAt: null,
        },
        { new: true },
      )
      if (!user) {
        throw new NotFoundException('User not found.')
      }
      this.logger.log(`User ${userId} unbanned by admin ${adminId}`)
      return {
        id: user._id.toString(),
        isBanned: false,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error('unbanUser failed:', err)
      throw new InternalServerErrorException('Failed to unban user.')
    }
  }

  async getChatConversations(page = 1, limit = 20, search = '', flagged = false) {
    page = Math.max(1, Math.floor(page))
    limit = Math.min(100, Math.max(1, Math.floor(limit)))
    const pipeline: PipelineStage[] = [
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: {
        _id: '$dealId', lastMessage: { $first: '$content' }, lastMessageAt: { $first: '$createdAt' },
        messageCount: { $sum: 1 }, flaggedCount: { $sum: { $cond: ['$isFlagged', 1, 0] } },
        blockedCount: { $sum: { $cond: ['$isBlocked', 1, 0] } },
      } },
      ...(flagged ? [{ $match: { flaggedCount: { $gt: 0 } } }] : []),
      { $lookup: { from: 'deals', localField: '_id', foreignField: '_id', as: 'deal' } },
      { $unwind: { path: '$deal', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'listings', localField: 'deal.listingId', foreignField: '_id', as: 'listing' } },
      { $lookup: { from: 'users', localField: 'deal.primaryBuyerId', foreignField: '_id', as: 'buyer' } },
      { $lookup: { from: 'users', localField: 'deal.wholesalerId', foreignField: '_id', as: 'seller' } },
      { $project: {
        _id: 0, dealId: { $toString: '$_id' }, lastMessage: 1, lastMessageAt: 1,
        messageCount: 1, flaggedCount: 1, blockedCount: 1,
        propertyAddress: { $ifNull: [{ $arrayElemAt: ['$listing.propertyAddress', 0] }, 'Unavailable property'] },
        buyerName: { $ifNull: [{ $arrayElemAt: ['$buyer.fullName', 0] }, 'Unknown buyer'] },
        sellerName: { $ifNull: [{ $arrayElemAt: ['$seller.fullName', 0] }, 'Unknown seller'] },
        buyerId: { $toString: '$deal.primaryBuyerId' }, sellerId: { $toString: '$deal.wholesalerId' },
      } },
    ]
    if (search.trim()) {
      const literal = search.trim().slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      pipeline.push({ $match: { $or: ['dealId', 'propertyAddress', 'buyerName', 'sellerName', 'buyerId', 'sellerId'].map(
        (field) => ({ [field]: { $regex: literal, $options: 'i' } }),
      ) } })
    }
    pipeline.push({ $sort: { lastMessageAt: -1, dealId: 1 } }, { $facet: {
      conversations: [{ $skip: (page - 1) * limit }, { $limit: limit }],
      count: [{ $count: 'total' }],
    } })
    const [result] = await this.messageModel.aggregate(pipeline)
    const total = result?.count?.[0]?.total ?? 0
    return { conversations: result?.conversations ?? [], total, page, pages: Math.max(1, Math.ceil(total / limit)) }
  }

  async getChatHistory(dealId: string, page = 1, limit = 50) {
    if (!Types.ObjectId.isValid(dealId)) throw new BadRequestException('Invalid deal ID')
    page = Math.max(1, Math.floor(page))
    limit = Math.min(100, Math.max(1, Math.floor(limit)))
    const filter = { dealId: new Types.ObjectId(dealId) }
    const [messages, total] = await Promise.all([
      this.messageModel.find(filter).populate('senderId', 'fullName role')
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.messageModel.countDocuments(filter),
    ])
    return {
      messages: messages.reverse().map((m) => {
        const sender = m.senderId as unknown as (User & { _id?: Types.ObjectId }) | undefined
        return {
          id: m._id.toString(), senderId: sender?._id?.toString() ?? '',
          senderName: m.isSystemMessage ? 'System' : sender?.fullName ?? 'Unknown', senderRole: sender?.role ?? '',
          content: m.content, createdAt: (m as Message & { createdAt?: Date }).createdAt,
          isFlagged: m.isFlagged, isBlocked: m.isBlocked, flagLabel: FLAG_LABELS[m.flagType ?? ''] ?? '',
          blockedReason: m.blockedReason,
        }
      }),
      total, page, pages: Math.max(1, Math.ceil(total / limit)),
    }
  }

  async getFlaggedMessages(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit
      const [messages, total] = await Promise.all([
        this.messageModel
          .find({ isFlagged: true })
          .populate('senderId', 'fullName email role')
          .populate('dealId', 'listingId')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.messageModel.countDocuments({ isFlagged: true }),
      ])

      return {
        messages: messages.map((m) => {
          const sender = m.senderId as unknown as (User & { _id?: Types.ObjectId }) | undefined
          const ft = m.flagType ?? ''
          const created = (m as Message & { createdAt?: Date }).createdAt
          return {
            id: m._id.toString(),
            dealId: m.dealId?.toString() ?? '',
            senderId: sender?._id?.toString() ?? '',
            senderName: sender?.fullName ?? 'Unknown',
            senderRole: sender?.role ?? '',
            content: m.content,
            flagType: ft,
            flagLabel: FLAG_LABELS[ft] ?? ft ?? 'Flagged',
            createdAt: created instanceof Date ? created.toISOString() : new Date().toISOString(),
            isBlocked: m.isBlocked ?? false,
          }
        }),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      }
    } catch (err) {
      this.logger.error('getFlaggedMessages failed:', err)
      throw new InternalServerErrorException('Failed to load flagged messages.')
    }
  }

  async getFinancialLedger(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit
      const paidFilter = { app2_totalPlatformFeesPaid: { $gt: 0 } }

      const [entries, totalEntries, revenueAgg, closedDeals] = await Promise.all([
        this.userModel.find(paidFilter).sort({ app2_totalPlatformFeesPaid: -1 }).skip(skip).limit(limit).lean(),
        this.userModel.countDocuments(paidFilter),
        this.userModel.aggregate([{ $group: { _id: null, total: { $sum: '$app2_totalPlatformFeesPaid' } } }]),
        this.dealModel.countDocuments({ currentStep: DealStep.FUNDED_CLOSED }),
      ])

      const totalRevenue = revenueAgg[0]?.total ?? 0

      return {
        entries: entries.map((u) => ({
          id: u._id.toString(),
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          totalPaid: u.app2_totalPlatformFeesPaid ?? 0,
          dealsClosed: u.app2_totalDealsClosed ?? 0,
          lastActiveAt: u.lastActiveAt instanceof Date ? u.lastActiveAt.toISOString() : null,
        })),
        summary: {
          totalRevenue,
          closedDeals,
          averageFee: closedDeals > 0 ? Math.round(totalRevenue / closedDeals) : 0,
          feePayerCount: totalEntries,
        },
        page,
        pages: Math.max(1, Math.ceil(totalEntries / limit)),
        total: totalEntries,
      }
    } catch (err) {
      this.logger.error('getFinancialLedger failed:', err)
      throw new InternalServerErrorException('Failed to load financial ledger.')
    }
  }

  /**
   * Full paginated compliance queue. The admin dashboard only carries a small
   * preview slice, so the dedicated Pending Listings page must page through the
   * complete set — otherwise every submission past the preview limit is
   * invisible and un-approvable.
   */
  async getPendingListings(page = 1, limit = 20) {
    try {
      const safePage = Math.max(1, Math.floor(page))
      const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
      const skip = (safePage - 1) * safeLimit

      const [rows, total] = await Promise.all([
        this.listingModel
          .find({ status: ListingStatus.PENDING_REVIEW })
          .populate('wholesalerId', 'fullName email')
          .sort({ createdAt: -1 }) // newest submissions first
          .skip(skip)
          .limit(safeLimit)
          .lean(),
        this.listingModel.countDocuments({ status: ListingStatus.PENDING_REVIEW }),
      ])

      return {
        listings: rows.map((l) => this.mapPendingListing(l)),
        total,
        page: safePage,
        pages: Math.max(1, Math.ceil(total / safeLimit)),
      }
    } catch (err) {
      this.logger.error('getPendingListings failed:', err)
      throw new InternalServerErrorException('Failed to load pending listings.')
    }
  }

  private mapPendingListing(l: Listing & { _id: Types.ObjectId; createdAt?: Date }) {
    const wholesaler = l.wholesalerId as unknown as
      | (User & { _id?: Types.ObjectId })
      | undefined
    return {
      id: l._id.toString(),
      propertyAddress: l.propertyAddress ?? '',
      city: l.city ?? '',
      stateCode: l.stateCode ?? '',
      wholesalerName: wholesaler?.fullName ?? 'Unknown',
      submittedAt: l.createdAt instanceof Date ? timeAgo(l.createdAt) : '—',
      submittedAtIso: l.createdAt instanceof Date ? l.createdAt.toISOString() : null,
      outlierFlagged: l.outlierFlagged ?? false,
      flagLabel: l.outlierFlagged ? 'Low Rehab' : 'None',
      arv: l.arv ?? 0,
      rehabTotal: l.rehabTotal ?? 0,
      app1DealId: l.app1DealId ?? null,
    }
  }

  async reviewListing(listingId: string, action: 'approve' | 'reject', _adminId: string, reason?: string) {
    try {
      if (!Types.ObjectId.isValid(listingId)) {
        throw new NotFoundException('Listing not found.')
      }

      if (action === 'approve') {
        const pending = await this.listingModel.findById(listingId).select('+assignmentFeeLow').lean().exec()
        if (!pending) throw new NotFoundException('Listing not found.')
        assertSellerPricing(pending)
      }

      const now = new Date()
      const update =
        action === 'approve'
          ? {
              status: ListingStatus.LIVE,
              publishedAt: now,
              complianceScannedAt: now,
              outlierFlagged: false,
            }
          : {
              status: ListingStatus.CANCELLED,
            }

      const listing = await this.listingModel
        .findOneAndUpdate(
          { _id: listingId, status: ListingStatus.PENDING_REVIEW },
          { $set: update },
          { new: true },
        )
        .exec()

      if (!listing) {
        const existing = await this.listingModel.findById(listingId).select('status').lean().exec()
        if (!existing) {
          throw new NotFoundException('Listing not found.')
        }
        throw new BadRequestException(
          `Listing is not pending review (current status: ${existing.status}).`,
        )
      }

      this.logger.log(
        `Admin ${action}d listing ${listingId} → status=${listing.status}${reason ? `: ${reason}` : ''}`,
      )

      return {
        id: listing._id.toString(),
        status: listing.status,
        message: `Listing ${action}d.`,
      }
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err
      this.logger.error('reviewListing failed:', err)
      throw new InternalServerErrorException('Failed to review listing.')
    }
  }

  async approvePof(userId: string, adminId: string): Promise<{ pofStatus: string }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found.')
    }
    const user = await this.userModel.findById(userId)
    if (!user) {
      throw new NotFoundException('User not found.')
    }
    // Only act on an actual pending submission — never mint a POF-approved
    // trust status for a user who never uploaded a document.
    if (user.pofStatus !== 'pending' || !user.pofDocumentUrl) {
      throw new BadRequestException(
        'No proof-of-funds submission is pending review for this user.',
      )
    }
    user.pofStatus = 'approved'
    user.pofApprovedAt = new Date()
    user.pofRejectionReason = null
    await user.save()
    this.logger.log(`POF approved for ${userId} by ${adminId}`)
    return { pofStatus: 'approved' }
  }

  async rejectPof(userId: string, adminId: string, reason: string): Promise<{ pofStatus: string }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found.')
    }
    const user = await this.userModel.findById(userId)
    if (!user) {
      throw new NotFoundException('User not found.')
    }
    if (user.pofStatus !== 'pending' || !user.pofDocumentUrl) {
      throw new BadRequestException(
        'No proof-of-funds submission is pending review for this user.',
      )
    }
    user.pofStatus = 'rejected'
    user.pofRejectionReason = reason
    await user.save()
    this.logger.log(`POF rejected for ${userId} by ${adminId}`)
    return { pofStatus: 'rejected' }
  }

  async listUsers(role?: string) {
    const filter: Record<string, unknown> = { isBanned: { $ne: true } }
    if (role) {
      filter.role = role as UserRole
    }

    const users = await this.userModel
      .find(filter)
      .select('fullName email role kycStatus')
      .sort({ fullName: 1 })
      .lean()
      .exec()

    return users.map((u) => ({
      id: u._id.toString(),
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      kycStatus: u.kycStatus,
    }))
  }

  // ── Title representatives ─────────────────────────────────────
  /**
   * Title reps cannot self-register; an admin creates the account and the rep
   * sets their own password through the emailed forgot-password link, so no
   * password is ever generated for, shown to, or emailed by anyone.
   */
  async createTitleRep(dto: CreateTitleRepDto) {
    const email = dto.email.toLowerCase().trim()
    const phone = normalizePhone(dto.phone)

    const existing = await this.userModel.findOne({ $or: [{ email }, { phone }] }).select('email').lean().exec()
    if (existing) {
      throw new ConflictException(
        existing.email === email
          ? 'An account with this email already exists.'
          : 'An account with this phone number already exists.',
      )
    }

    // Unusable random password until the rep sets their own via the invite link.
    const passwordHash = await this.passwordHasher.hash(randomBytes(32).toString('base64url'), 10)

    let user: UserDocument
    try {
      user = await this.userModel.create({
        fullName: dto.fullName.trim(),
        email,
        phone,
        passwordHash,
        role: UserRole.TITLE_REP,
        stateCode: dto.stateCode?.toUpperCase() ?? '',
        kycStatus: KycStatus.APPROVED,
        kycVerifiedAt: new Date(),
        kycProvider: 'admin',
        bankVerified: false,
        reliabilityScore: 100,
        professionalScore: 100,
        isBanned: false,
      })
    } catch (err) {
      if (isMongoDuplicateKeyError(err)) {
        throw new ConflictException('An account with this email or phone already exists.')
      }
      throw err
    }

    this.logger.log(`Title rep created by admin: ${email}`)
    const inviteSent = await this.sendTitleRepInvite(user.fullName, email)

    return {
      id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      stateCode: user.stateCode,
      inviteSent,
    }
  }

  async resendTitleRepInvite(userId: string) {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('Title representative not found.')
    const user = await this.userModel
      .findOne({ _id: new Types.ObjectId(userId), role: UserRole.TITLE_REP })
      .select('fullName email')
      .lean()
      .exec()
    if (!user) throw new NotFoundException('Title representative not found.')
    const inviteSent = await this.sendTitleRepInvite(user.fullName, user.email)
    if (!inviteSent) throw new InternalServerErrorException('Could not send the invite email. Try again.')
    return { inviteSent }
  }

  async listTitleReps() {
    const [reps, counts] = await Promise.all([
      this.userModel
        .find({ role: UserRole.TITLE_REP })
        .select('fullName email phone stateCode isBanned createdAt lastActiveAt')
        .sort({ fullName: 1 })
        .lean()
        .exec(),
      this.dealModel
        .aggregate<{ _id: Types.ObjectId; active: number; closed: number }>([
          { $match: { titleRepId: { $ne: null } } },
          {
            $group: {
              _id: '$titleRepId',
              active: { $sum: { $cond: [{ $ne: ['$currentStep', DealStep.FUNDED_CLOSED] }, 1, 0] } },
              closed: { $sum: { $cond: [{ $eq: ['$currentStep', DealStep.FUNDED_CLOSED] }, 1, 0] } },
            },
          },
        ])
        .exec(),
    ])
    const byRep = new Map(counts.map((c) => [c._id.toString(), c]))
    return reps.map((r) => {
      const c = byRep.get(r._id.toString())
      const u = r as typeof r & { createdAt?: Date }
      return {
        id: r._id.toString(),
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
        stateCode: r.stateCode ?? '',
        isBanned: Boolean(r.isBanned),
        activeDeals: c?.active ?? 0,
        closedDeals: c?.closed ?? 0,
        // A rep who never logged in has no lastActiveAt yet.
        hasLoggedIn: Boolean(r.lastActiveAt),
        createdAt: u.createdAt?.toISOString() ?? null,
      }
    })
  }

  private async sendTitleRepInvite(fullName: string, email: string): Promise<boolean> {
    const frontendUrl = this.configService.get<string>('frontendUrl') ?? ''
    const setPasswordUrl = `${frontendUrl}/forgot-password?email=${encodeURIComponent(email)}`
    const loginUrl = `${frontendUrl}/login`
    const esc = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const subject = 'You have been added to TRACT as a Title Representative'
    const text =
      `Hello ${fullName},\n\n` +
      `A TRACT admin created a Title Representative account for you (${email}).\n\n` +
      `1. Set your password: ${setPasswordUrl}\n` +
      `   Request a reset code, then choose your password.\n` +
      `2. Sign in: ${loginUrl}\n\n` +
      `Deals assigned to you will appear on your title dashboard, and you will be emailed the details of each one.\n\n` +
      `— TRACT Marketplace`
    const html = `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
  <p>Hello ${esc(fullName)},</p>
  <p>A TRACT admin created a <strong>Title Representative</strong> account for you (${esc(email)}).</p>
  <ol>
    <li>Set your password — request a reset code, then choose your password.</li>
    <li>Sign in to see the deals assigned to you.</li>
  </ol>
  <p style="margin-top:24px">
    <a href="${esc(setPasswordUrl)}" style="background:#174d34;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Set your password</a>
  </p>
  <p>Already set it? <a href="${esc(loginUrl)}">Sign in</a>.</p>
  <p style="color:#6B7280;font-size:13px">You will be emailed the details of every deal an admin assigns to you.</p>
  <p>— TRACT Marketplace</p>
</body></html>`

    const sent = await this.resendService.sendMail(email, subject, html, text)
    if (!sent) this.logger.warn(`Title rep invite email to ${email} failed`)
    return sent
  }
}
