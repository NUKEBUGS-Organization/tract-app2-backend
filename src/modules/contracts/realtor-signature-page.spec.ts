import { PDFDocument, StandardFonts } from 'pdf-lib'
import { appendSignaturePage } from './realtor-signature-page'

describe('appendSignaturePage', () => {
  const context = { propertyAddress: '123 Main St, Newark, NJ', sellerName: 'Rita Realtor', buyerName: 'Ben Buyer' }

  async function samplePdf(pages: number): Promise<Buffer> {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let index = 0; index < pages; index += 1) {
      pdf.addPage([612, 792]).drawText(`Brokerage clause ${index + 1}`, { x: 50, y: 700, size: 12, font })
    }
    return Buffer.from(await pdf.save())
  }

  it('adds exactly one page and reports its one-based DocuSeal page number', async () => {
    const prepared = await appendSignaturePage(await samplePdf(3), context)
    expect(prepared.pageIndex).toBe(4)
    expect((await PDFDocument.load(prepared.buffer)).getPageCount()).toBe(4)
  })

  it('leaves the realtor text pages intact', async () => {
    const original = await samplePdf(2)
    const prepared = await appendSignaturePage(original, context)
    const before = await PDFDocument.load(original)
    const after = await PDFDocument.load(prepared.buffer)
    for (let index = 0; index < before.getPageCount(); index += 1) {
      expect(after.getPage(index).getSize()).toEqual(before.getPage(index).getSize())
    }
  })

  it('produces six role-scoped fields inside the appended page', async () => {
    const prepared = await appendSignaturePage(await samplePdf(1), context)
    expect(prepared.fields).toHaveLength(6)
    expect(prepared.fields.map(field => `${field.role}:${field.type}`)).toEqual([
      'Seller:text', 'Seller:signature', 'Seller:date',
      'Buyer:text', 'Buyer:signature', 'Buyer:date',
    ])
    for (const field of prepared.fields) {
      const [area] = field.areas
      expect(area.page).toBe(prepared.pageIndex)
      expect(area.page).toBe(2)
      expect(area.x).toBeGreaterThan(0)
      expect(area.w).toBeGreaterThan(0.1)
      expect(area.x + area.w).toBeLessThanOrEqual(1)
      expect(area.y + area.h).toBeLessThanOrEqual(1)
      expect(field.required).toBe(true)
    }
  })

  it('rejects bytes that are not a readable PDF', async () => {
    await expect(appendSignaturePage(Buffer.from('nope'), context)).rejects.toThrow('cannot be read')
  })
})
