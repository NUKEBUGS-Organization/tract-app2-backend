import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { Message, MessageDocument } from '../chat/schemas/message.schema'
import { Penalty, PenaltyDocument, ViolationType } from '../penalties/schemas/penalty.schema'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { DealStep } from '../../common/enums/deal-step.enum'
import { UserRole } from '../../common/enums/user-role.enum'

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
        this.listingModel
          .find({ status: ListingStatus.PENDING_REVIEW })
          .populate('wholesalerId', 'fullName')
          .sort({ createdAt: 1 })
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

      const pendingListingsMapped = pendingListings.map((l) => {
        const wholesaler = l.wholesalerId as unknown as (User & { _id?: Types.ObjectId }) | undefined
        const created = (l as Listing & { createdAt?: Date }).createdAt
        return {
          id: l._id.toString(),
          propertyAddress: l.propertyAddress ?? '',
          city: l.city ?? '',
          stateCode: l.stateCode ?? '',
          wholesalerName: wholesaler?.fullName ?? 'Unknown',
          submittedAt: created instanceof Date ? timeAgo(created) : '—',
          outlierFlagged: l.outlierFlagged ?? false,
          flagLabel: l.outlierFlagged ? 'Low Rehab' : 'None',
          arv: l.arv ?? 0,
          rehabTotal: l.rehabTotal ?? 0,
        }
      })

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
            { kycStatus: { $in: ['pending', 'in_progress'] } },
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
          ? { kycStatus: 'approved' as const, kycVerifiedAt: new Date() }
          : { kycStatus: 'rejected' as const }

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

  async reviewListing(listingId: string, action: 'approve' | 'reject', _adminId: string, reason?: string) {
    try {
      if (!Types.ObjectId.isValid(listingId)) {
        throw new NotFoundException('Listing not found.')
      }

      const listing = await this.listingModel.findById(listingId)
      if (!listing) {
        throw new NotFoundException('Listing not found.')
      }

      if (listing.status !== ListingStatus.PENDING_REVIEW) {
        throw new BadRequestException('Listing is not pending review.')
      }

      listing.status = action === 'approve' ? ListingStatus.LIVE : ListingStatus.CANCELLED

      if (action === 'approve') {
        listing.publishedAt = new Date()
        listing.complianceScannedAt = new Date()
      }

      await listing.save()

      this.logger.log(`Admin ${action}d listing ${listingId}${reason ? `: ${reason}` : ''}`)

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
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        pofStatus: 'approved',
        pofApprovedAt: new Date(),
        pofRejectionReason: null,
      },
      { new: true },
    )
    if (!user) {
      throw new NotFoundException('User not found.')
    }
    this.logger.log(`POF approved for ${userId} by ${adminId}`)
    return { pofStatus: 'approved' }
  }

  async rejectPof(userId: string, adminId: string, reason: string): Promise<{ pofStatus: string }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found.')
    }
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        pofStatus: 'rejected',
        pofRejectionReason: reason,
      },
      { new: true },
    )
    if (!user) {
      throw new NotFoundException('User not found.')
    }
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
}
