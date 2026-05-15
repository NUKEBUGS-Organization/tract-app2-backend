import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import { User, UserDocument } from './schemas/user.schema'
import { UpdateUserDto } from './dto/update-user.dto'

const BCRYPT_ROUNDS = 12

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  // ── Sanitize for public API ───────────────────
  toPublicUser(user: UserDocument) {
    const u = user as UserDocument & {
      createdAt?: Date
      updatedAt?: Date
    }
    return {
      id: u._id.toString(),
      email: u.email,
      phone: u.phone,
      role: u.role,
      fullName: u.fullName,
      stateCode: u.stateCode ?? '',
      kycStatus: u.kycStatus ?? 'pending',
      kycVerifiedAt: u.kycVerifiedAt ?? null,
      bankVerified: u.bankVerified,
      reliabilityScore: u.reliabilityScore,
      professionalScore: u.professionalScore,
      isBanned: u.isBanned,
      banReason: u.banReason ?? null,
      scoreRestrictedUntil: u.scoreRestrictedUntil ?? null,
      // App 2 specific
      app2_activeDealsCount: u.app2_activeDealsCount ?? 0,
      app2_totalDealsClosed: u.app2_totalDealsClosed ?? 0,
      app2_isVettedBuyer: u.app2_isVettedBuyer ?? false,
      app2_reactivationFeePending: u.app2_reactivationFeePending ?? false,
      app2_platformFeePaid: u.app2_platformFeePaid ?? false,
      // Realtor
      licenseNumber: u.licenseNumber || null,
      brokerageName: u.brokerageName || null,
      commissionPct: u.commissionPct ?? null,
      defaultAgencyRole: u.defaultAgencyRole ?? null,
      // Timestamps
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      createdAt: u.createdAt?.toISOString() ?? new Date().toISOString(),
    }
  }

  // ── Password helpers ──────────────────────────
  async hashPassword(plain: string): Promise<string> {
    try {
      return await bcrypt.hash(plain, BCRYPT_ROUNDS)
    } catch (err) {
      this.logger.error('hashPassword failed:', err)
      throw new InternalServerErrorException('Password processing failed.')
    }
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash)
    } catch (err) {
      this.logger.error('verifyPassword failed:', err)
      return false
    }
  }

  async hashRefreshToken(token: string): Promise<string> {
    try {
      return await bcrypt.hash(token, BCRYPT_ROUNDS)
    } catch (err) {
      this.logger.error('hashRefreshToken failed:', err)
      throw new InternalServerErrorException('Token processing failed.')
    }
  }

  // ── Finders ───────────────────────────────────
  async findByEmail(email: string): Promise<UserDocument | null> {
    try {
      return await this.userModel.findOne({ email: email.toLowerCase().trim() }).exec()
    } catch (err) {
      this.logger.error('findByEmail failed:', err)
      throw new InternalServerErrorException('Database error. Please try again.')
    }
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    try {
      return await this.userModel.findOne({ email: email.toLowerCase().trim() }).select('+password').exec()
    } catch (err) {
      this.logger.error('findByEmailWithPassword failed:', err)
      throw new InternalServerErrorException('Database error. Please try again.')
    }
  }

  async findById(id: string): Promise<UserDocument | null> {
    try {
      if (!Types.ObjectId.isValid(id)) return null
      return await this.userModel.findById(id).exec()
    } catch (err) {
      this.logger.error('findById failed:', err)
      throw new InternalServerErrorException('Database error. Please try again.')
    }
  }

  // ── Updaters ──────────────────────────────────
  async setRefreshTokenHash(userId: string, hash: string | null): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new NotFoundException('User not found.')
      }
      await this.userModel.updateOne({ _id: userId }, { $set: { refreshToken: hash } }).exec()
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error('setRefreshTokenHash failed:', err)
      throw new InternalServerErrorException('Failed to update session.')
    }
  }

  async updateLastActive(userId: string): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) return
      await this.userModel.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date() } }).exec()
    } catch (err) {
      this.logger.warn(`updateLastActive failed for ${userId}:`, err)
    }
  }

  async updateProfile(userId: string, dto: UpdateUserDto): Promise<UserDocument> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new NotFoundException('User not found.')
      }
      const updated = await this.userModel
        .findByIdAndUpdate(userId, { $set: { ...dto } }, { new: true, runValidators: true })
        .exec()

      if (!updated) throw new NotFoundException('User not found.')
      return updated
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error('updateProfile failed:', err)
      throw new InternalServerErrorException('Failed to update profile.')
    }
  }

  async setKycStatus(userId: string, status: string): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) return
      await this.userModel.updateOne({ _id: userId }, { $set: { kycStatus: status } }).exec()
      this.logger.log(`KYC status set to ${status} for ${userId}`)
    } catch (err) {
      this.logger.error('setKycStatus failed:', err)
      throw new InternalServerErrorException('Failed to update KYC status.')
    }
  }

  async setBankVerified(userId: string, verified: boolean): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) return
      await this.userModel
        .updateOne(
          { _id: userId },
          {
            $set: {
              bankVerified: verified,
              bankVerifiedAt: verified ? new Date() : null,
            },
          },
        )
        .exec()
    } catch (err) {
      this.logger.error('setBankVerified failed:', err)
      throw new InternalServerErrorException('Failed to update bank verification.')
    }
  }

  // ── App 2 specific updaters ───────────────────
  async incrementApp2ActiveDeals(userId: string, delta: number): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) return
      await this.userModel.updateOne({ _id: userId }, { $inc: { app2_activeDealsCount: delta } }).exec()
    } catch (err) {
      this.logger.error('incrementApp2ActiveDeals failed:', err)
    }
  }

  async recordApp2DealClosed(userId: string): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) return
      await this.userModel
        .updateOne(
          { _id: userId },
          {
            $inc: {
              app2_totalDealsClosed: 1,
              app2_activeDealsCount: -1,
            },
            $set: {
              app2_lastContractSecuredAt: new Date(),
            },
          },
        )
        .exec()
      this.logger.log(`App2 deal closed recorded for ${userId}`)
    } catch (err) {
      this.logger.error('recordApp2DealClosed failed:', err)
    }
  }

  async setApp2VettedBuyer(userId: string, vetted: boolean): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(userId)) return
      await this.userModel
        .updateOne(
          { _id: userId },
          {
            $set: {
              app2_isVettedBuyer: vetted,
              app2_vettedAt: vetted ? new Date() : null,
            },
          },
        )
        .exec()
    } catch (err) {
      this.logger.error('setApp2VettedBuyer failed:', err)
      throw new InternalServerErrorException('Failed to update buyer status.')
    }
  }
}
