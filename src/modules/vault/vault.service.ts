import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { VaultDocument, VaultDocumentDocument } from './schemas/vault-document.schema'
import { UploadVaultDocDto } from './dto/upload-vault-doc.dto'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { UserRole } from '../../common/enums/user-role.enum'

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name)

  constructor(
    @InjectModel(VaultDocument.name)
    private readonly vaultModel: Model<VaultDocumentDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
  ) {}

  private async assertDealParty(dealId: string, userId: string, role: string): Promise<void> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }
    const deal = await this.dealModel.findById(dealId).lean().exec()
    if (!deal) {
      throw new NotFoundException('Deal not found.')
    }
    if (role === UserRole.ADMIN) {
      return
    }
    const parties = [
      deal.primaryBuyerId?.toString(),
      deal.wholesalerId?.toString(),
      deal.titleRepId?.toString(),
    ].filter(Boolean)
    if (!parties.includes(userId)) {
      throw new ForbiddenException('You are not a party to this deal.')
    }
  }

  async uploadDocument(
    dealId: string,
    userId: string,
    userRole: string,
    dto: UploadVaultDocDto,
  ): Promise<VaultDocumentDocument> {
    await this.assertDealParty(dealId, userId, userRole)

    const doc = await this.vaultModel.create({
      dealId: new Types.ObjectId(dealId),
      uploadedBy: new Types.ObjectId(userId),
      fileName: dto.fileName,
      fileUrl: dto.fileUrl,
      fileType: dto.fileType ?? 'document',
      visibleTo: dto.visibleTo ?? 'all',
    })

    this.logger.log(`Vault doc uploaded: ${dto.fileName} on deal ${dealId} by ${userId}`)

    return doc
  }

  async listDocuments(
    dealId: string,
    userId: string,
    userRole: string,
  ): Promise<unknown[]> {
    await this.assertDealParty(dealId, userId, userRole)

    const docs = await this.vaultModel
      .find({
        dealId: new Types.ObjectId(dealId),
        isDeleted: { $ne: true },
      })
      .populate('uploadedBy', 'fullName role')
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return docs.filter((doc) => {
      const visibleTo = String(doc.visibleTo ?? 'all')
      if (visibleTo === 'all') return true
      if (visibleTo === userRole) return true
      if (userRole === UserRole.ADMIN) return true
      return false
    })
  }

  async deleteDocument(
    dealId: string,
    docId: string,
    userId: string,
    role: string,
  ): Promise<{ deleted: boolean }> {
    await this.assertDealParty(dealId, userId, role)

    const doc = await this.vaultModel.findOne({
      _id: new Types.ObjectId(docId),
      dealId: new Types.ObjectId(dealId),
      isDeleted: { $ne: true },
    })

    if (!doc) {
      throw new NotFoundException('Document not found.')
    }

    const isUploader = doc.uploadedBy.toString() === userId
    const isAdmin = role === UserRole.ADMIN

    if (!isUploader && !isAdmin) {
      throw new ForbiddenException('You can only delete your own documents.')
    }

    doc.isDeleted = true
    await doc.save()

    this.logger.log(`Vault doc deleted: ${docId} by ${userId}`)

    return { deleted: true }
  }
}
