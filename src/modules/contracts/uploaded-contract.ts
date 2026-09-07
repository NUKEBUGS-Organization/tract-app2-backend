import { BadRequestException } from '@nestjs/common'
import { PDFDocument, StandardFonts } from 'pdf-lib'

export async function prepareUploadedContract(file?: { buffer: Buffer; mimetype: string }) {
  if (!file || file.mimetype !== 'application/pdf' || file.buffer.length > 10 * 1024 * 1024 ||
      file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new BadRequestException('Upload your contract as a PDF (maximum 10 MB).')
  }
  try {
    const pdf = await PDFDocument.load(file.buffer)
    if (!pdf.getPageCount() || pdf.getPageCount() > 100) throw new Error('Page limit')
    const page = pdf.addPage([612, 792])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText('Agreement signatures', { x: 48, y: 730, size: 20, font })
    page.drawText('The parties sign the attached agreement, including all preceding pages.', { x: 48, y: 695, size: 11, font })
    page.drawText('Lister / Realtor', { x: 48, y: 635, size: 12, font })
    page.drawText('Purchaser / Buyer', { x: 48, y: 465, size: 12, font })
    return { buffer: Buffer.from(await pdf.save()), signaturePage: pdf.getPageCount() }
  } catch {
    throw new BadRequestException('The contract PDF cannot be read. Upload an unencrypted PDF with 1–100 pages.')
  }
}
