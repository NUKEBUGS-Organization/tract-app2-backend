import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { TitleCompany, TitleCompanyDocument } from './schemas/title-company.schema'
import { CreateTitleCompanyDto } from './dto/create-title-company.dto'
import { UpdateTitleCompanyDto } from './dto/update-title-company.dto'

const SEED_COMPANIES: CreateTitleCompanyDto[] = [
  {
    name: 'First American Title',
    contactEmail: 'closings@firstam.com',
    phone: '+1 (800) 854-3643',
  },
  {
    name: 'Stewart Title',
    contactEmail: 'closings@stewart.com',
    phone: '+1 (800) 729-1900',
  },
  {
    name: 'Old Republic Title',
    contactEmail: 'closings@oldrepublictitle.com',
    phone: '+1 (800) 445-4500',
  },
  {
    name: 'Chicago Title',
    contactEmail: 'closings@ctic.com',
    phone: '+1 (312) 223-2000',
  },
  {
    name: 'Fidelity National Title',
    contactEmail: 'closings@fnf.com',
    phone: '+1 (888) 934-3354',
  },
]

@Injectable()
export class TitleCompaniesService implements OnModuleInit {
  private readonly logger = new Logger(TitleCompaniesService.name)

  constructor(
    @InjectModel(TitleCompany.name)
    private readonly titleCompanyModel: Model<TitleCompanyDocument>,
  ) {}

  async onModuleInit() {
    const count = await this.titleCompanyModel.countDocuments()
    if (count > 0) return

    await this.titleCompanyModel.insertMany(
      SEED_COMPANIES.map((c) => ({
        name: c.name,
        contactEmail: c.contactEmail.toLowerCase(),
        phone: c.phone ?? '',
        active: true,
      })),
    )
    this.logger.log(`Seeded ${SEED_COMPANIES.length} title companies`)
  }

  toPublic(doc: TitleCompanyDocument) {
    return {
      id: doc._id.toString(),
      name: doc.name,
      contactEmail: doc.contactEmail,
      phone: doc.phone ?? '',
      active: doc.active,
      createdAt:
        (doc as TitleCompanyDocument & { createdAt?: Date }).createdAt?.toISOString?.() ??
        undefined,
      updatedAt:
        (doc as TitleCompanyDocument & { updatedAt?: Date }).updatedAt?.toISOString?.() ??
        undefined,
    }
  }

  async listActive() {
    const rows = await this.titleCompanyModel
      .find({ active: true })
      .sort({ name: 1 })
      .exec()
    return rows.map((r) => this.toPublic(r))
  }

  async listAll() {
    const rows = await this.titleCompanyModel.find().sort({ name: 1 }).exec()
    return rows.map((r) => this.toPublic(r))
  }

  async create(dto: CreateTitleCompanyDto) {
    const existing = await this.titleCompanyModel
      .findOne({ name: new RegExp(`^${escapeRegex(dto.name.trim())}$`, 'i') })
      .exec()
    if (existing) {
      throw new ConflictException('A title company with this name already exists.')
    }

    const doc = await this.titleCompanyModel.create({
      name: dto.name.trim(),
      contactEmail: dto.contactEmail.trim().toLowerCase(),
      phone: dto.phone?.trim() ?? '',
      active: dto.active ?? true,
    })
    return this.toPublic(doc)
  }

  async update(id: string, dto: UpdateTitleCompanyDto) {
    const doc = await this.titleCompanyModel.findById(id)
    if (!doc) throw new NotFoundException('Title company not found.')

    if (dto.name !== undefined) doc.name = dto.name.trim()
    if (dto.contactEmail !== undefined) doc.contactEmail = dto.contactEmail.trim().toLowerCase()
    if (dto.phone !== undefined) doc.phone = dto.phone.trim()
    if (dto.active !== undefined) doc.active = dto.active

    try {
      await doc.save()
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('A title company with this name already exists.')
      }
      throw err
    }

    return this.toPublic(doc)
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
