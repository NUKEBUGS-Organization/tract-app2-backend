import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import { User, UserDocument } from './schemas/user.schema'
import { RegisterDto } from '../auth/dto/register.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { PublicUserDto } from './dto/public-user.dto'
import { KycStatus } from '../../common/enums/kyc-status.enum'

const BCRYPT_ROUNDS = 12

type LeanUser = User & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date }

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  toPublicUser(doc: LeanUser | UserDocument | Record<string, unknown>): PublicUserDto {
    const u = doc as LeanUser & { _id?: Types.ObjectId; id?: string }
    const id = u._id ? u._id.toString() : (u.id as string)
    const created =
      u.createdAt instanceof Date
        ? u.createdAt.toISOString()
        : new Date().toISOString()
    const lastActive =
      u.lastActiveAt instanceof Date
        ? u.lastActiveAt.toISOString()
        : created
    return {
      id,
      email: u.email,
      phone: u.phone,
      role: u.role,
      fullName: u.fullName,
      kycStatus: u.kycStatus ?? KycStatus.PENDING,
      bankVerified: u.bankVerified ?? false,
      reliabilityScore: u.reliabilityScore ?? 100,
      professionalScore: u.professionalScore ?? 100,
      activeDealsCount: u.activeDealsCount ?? 0,
      isBanned: u.isBanned ?? false,
      lastActiveAt: lastActive,
      createdAt: created,
    }
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS)
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash)
  }

  async hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(token, BCRYPT_ROUNDS)
  }

  async verifyRefreshToken(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) return false
    return bcrypt.compare(plain, hash)
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec()
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+password')
      .exec()
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null
    return this.userModel.findById(id).exec()
  }

  async createFromRegister(dto: RegisterDto, passwordHash: string): Promise<UserDocument> {
    const exists = await this.findByEmail(dto.email)
    if (exists) throw new ConflictException('An account with this email already exists')

    const user = await this.userModel.create({
      fullName: dto.fullName.trim(),
      email: dto.email.toLowerCase().trim(),
      phone: dto.phone.trim(),
      password: passwordHash,
      role: dto.role,
      stateCode: dto.stateCode.toUpperCase(),
      dob: new Date(dto.dob),
      kycStatus: KycStatus.PENDING,
      bankVerified: false,
      reliabilityScore: 100,
      professionalScore: 100,
      activeDealsCount: 0,
      totalDealsClosed: 0,
      isBanned: false,
      lastActiveAt: new Date(),
    })
    return user
  }

  async setRefreshTokenHash(userId: string, hash: string | null): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found')
    await this.userModel.updateOne({ _id: userId }, { $set: { refreshToken: hash } }).exec()
  }

  async updateLastActive(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return
    await this.userModel.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date() } }).exec()
  }

  async updateProfile(userId: string, dto: UpdateUserDto): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found')
    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { ...dto } },
        { new: true, runValidators: true },
      )
      .exec()
    if (!updated) throw new NotFoundException('User not found')
    return updated
  }

  async setKycStatus(userId: string, status: KycStatus): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return
    await this.userModel.updateOne({ _id: userId }, { $set: { kycStatus: status } }).exec()
  }

  async setBankVerified(userId: string, verified: boolean): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return
    await this.userModel.updateOne({ _id: userId }, { $set: { bankVerified: verified } }).exec()
  }
}
