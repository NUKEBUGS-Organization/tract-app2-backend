import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { UserRole } from '../../common/enums/user-role.enum'
import { User, UserDocument } from '../users/schemas/user.schema'
import { SubmitRealtorVerificationDto } from './dto/submit-realtor-verification.dto'
import {
  Verification,
  VerificationDocument,
  VerificationStatus,
  VerificationType,
} from './schemas/verification.schema'

@Injectable()
export class VerificationsService {
  constructor(
    @InjectModel(Verification.name)
    private readonly verificationModel: Model<VerificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private toPublic(doc: VerificationDocument | Record<string, unknown>) {
    const v = doc as VerificationDocument & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date }
    return {
      id: v._id.toString(),
      userId: v.user_id?.toString?.() ?? String(v.user_id),
      type: v.type,
      status: v.status,
      stateLicenseNumber: v.state_license_number ?? null,
      brokerageName: v.brokerage_name ?? null,
      managingBroker: v.managing_broker ?? null,
      officeAddress: v.office_address ?? null,
      rejectionReason: v.rejection_reason ?? null,
      submittedAt:
        v.submitted_at instanceof Date ? v.submitted_at.toISOString() : null,
      reviewedAt:
        v.reviewed_at instanceof Date ? v.reviewed_at.toISOString() : null,
    }
  }

  async submitRealtorVerification(userId: string, dto: SubmitRealtorVerificationDto) {
    const user = await this.userModel.findById(userId)
    if (!user) throw new NotFoundException('User not found.')
    if (user.role !== UserRole.REALTOR) {
      throw new ForbiddenException('Only realtors can submit this verification.')
    }

    const doc = await this.verificationModel
      .findOneAndUpdate(
        { user_id: user._id },
        {
          user_id: user._id,
          type: VerificationType.REALTOR,
          status: VerificationStatus.PENDING,
          state_license_number: dto.state_license_number.trim(),
          brokerage_name: dto.brokerage_name.trim(),
          managing_broker: dto.managing_broker.trim(),
          office_address: dto.office_address.trim(),
          rejection_reason: null,
          reviewed_by: null,
          reviewed_at: null,
          submitted_at: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec()

    return this.toPublic(doc!)
  }

  async getMyVerification(userId: string) {
    const verification = await this.verificationModel
      .findOne({ user_id: new Types.ObjectId(userId) })
      .lean()
      .exec()

    if (!verification) {
      return { status: 'not_submitted' as const }
    }

    return this.toPublic(verification as unknown as VerificationDocument)
  }

  async listPendingRealtor(admin = false) {
    void admin
    const rows = await this.verificationModel
      .find({
        type: VerificationType.REALTOR,
        status: VerificationStatus.PENDING,
      })
      .sort({ submitted_at: 1 })
      .lean()
      .exec()

    const userIds = rows.map((r) => r.user_id)
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('fullName email role phone stateCode')
      .lean()
      .exec()
    const byId = new Map(users.map((u) => [u._id.toString(), u]))

    return rows.map((r) => {
      const u = byId.get(r.user_id.toString())
      return {
        ...this.toPublic(r as unknown as VerificationDocument),
        user: u
          ? {
              id: u._id.toString(),
              fullName: u.fullName,
              email: u.email,
              role: u.role,
              phone: u.phone,
              stateCode: u.stateCode ?? '',
            }
          : null,
      }
    })
  }

  async approve(id: string, adminId: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Verification not found.')

    const verification = await this.verificationModel.findById(id)
    if (!verification) throw new NotFoundException('Verification not found.')

    verification.status = VerificationStatus.APPROVED
    verification.rejection_reason = null as unknown as string
    verification.reviewed_by = new Types.ObjectId(adminId)
    verification.reviewed_at = new Date()
    await verification.save()

    // Sync credentials onto User so App2 profile / queue heuristics stay current
    await this.userModel.findByIdAndUpdate(verification.user_id, {
      licenseNumber: verification.state_license_number || '',
      brokerageName: verification.brokerage_name || '',
      managingBroker: verification.managing_broker || '',
      officeAddress: verification.office_address || '',
    })

    return {
      id: verification._id.toString(),
      status: verification.status,
      message: 'Realtor verification approved.',
    }
  }

  async reject(id: string, adminId: string, reason: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Verification not found.')

    const verification = await this.verificationModel.findById(id)
    if (!verification) throw new NotFoundException('Verification not found.')

    const trimmed = reason?.trim()
    if (!trimmed || trimmed.length < 3) {
      throw new BadRequestException('Rejection reason must be at least 3 characters.')
    }

    verification.status = VerificationStatus.REJECTED
    verification.rejection_reason = trimmed
    verification.reviewed_by = new Types.ObjectId(adminId)
    verification.reviewed_at = new Date()
    await verification.save()

    return {
      id: verification._id.toString(),
      status: verification.status,
      message: 'Realtor verification rejected.',
    }
  }
}
