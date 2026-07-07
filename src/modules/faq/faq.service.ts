import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { CreateFaqDto } from './dto/create-faq.dto'
import { UpdateFaqDto } from './dto/update-faq.dto'
import { Faq, FaqDocument } from './schemas/faq.schema'

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

@Injectable()
export class FaqService {
  constructor(
    @InjectModel(Faq.name)
    private readonly faqModel: Model<FaqDocument>,
  ) {}

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base
    let n = 2
    while (true) {
      const existing = await this.faqModel.findOne({ slug }).exec()
      if (!existing || (excludeId && existing._id.toString() === excludeId)) {
        return slug
      }
      slug = `${base}-${n++}`
    }
  }

  async listPublic() {
    const items = await this.faqModel
      .find({ isPublished: true })
      .sort({ category: 1, order: 1, createdAt: 1 })
      .exec()
    return items.map((f) => this.toPublic(f))
  }

  async listAllAdmin() {
    const items = await this.faqModel
      .find()
      .sort({ category: 1, order: 1, createdAt: 1 })
      .exec()
    return items.map((f) => this.toPublic(f))
  }

  async create(dto: CreateFaqDto) {
    const slug = await this.uniqueSlug(toSlug(dto.question.trim()))
    const faq = await this.faqModel.create({
      question: dto.question.trim(),
      answer: dto.answer.trim(),
      category: dto.category.trim(),
      slug,
      order: dto.order ?? 0,
      isPublished: dto.isPublished ?? false,
    })
    return this.toPublic(faq)
  }

  async update(id: string, dto: UpdateFaqDto) {
    const faq = await this.faqModel.findById(id)
    if (!faq) throw new NotFoundException('FAQ entry not found.')

    if (dto.question !== undefined) {
      faq.question = dto.question.trim()
      faq.slug = await this.uniqueSlug(toSlug(faq.question), id)
    }
    if (dto.answer !== undefined) faq.answer = dto.answer.trim()
    if (dto.category !== undefined) faq.category = dto.category.trim()
    if (dto.order !== undefined) faq.order = dto.order
    if (dto.isPublished !== undefined) faq.isPublished = dto.isPublished

    await faq.save()
    return this.toPublic(faq)
  }

  async remove(id: string) {
    const faq = await this.faqModel.findByIdAndDelete(id)
    if (!faq) throw new NotFoundException('FAQ entry not found.')
    return { deleted: true, id }
  }

  toPublic(faq: FaqDocument) {
    const doc = faq.toObject()
    return {
      id: faq._id.toString(),
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      slug: faq.slug,
      order: faq.order,
      isPublished: faq.isPublished,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : new Date().toISOString(),
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : new Date().toISOString(),
    }
  }
}
