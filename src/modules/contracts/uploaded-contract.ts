import { BadRequestException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'

export async function prepareUploadedContract(file?: { buffer: Buffer; mimetype: string }) {
  if (!file || file.mimetype !== 'application/pdf' || file.buffer.length > 10 * 1024 * 1024 ||
      file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new BadRequestException('Upload your contract as a PDF (maximum 10 MB).')
  }
  try {
    const pdf = await PDFDocument.load(file.buffer)
    if (!pdf.getPageCount() || pdf.getPageCount() > 100) throw new Error('Page limit')
    // Preserve existing signatures and the exact agreement bytes; never rewrite signed PDFs.
    return { buffer: file.buffer }
  } catch {
    throw new BadRequestException('The contract PDF cannot be read. Upload an unencrypted PDF with 1–100 pages.')
  }
}
