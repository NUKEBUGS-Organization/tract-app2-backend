import { BadRequestException } from '@nestjs/common'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface SignatureFieldArea {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface SignatureField {
  name: string
  type: 'text' | 'signature' | 'date'
  role: 'Seller' | 'Buyer'
  required: true
  areas: SignatureFieldArea[]
}

export interface PreparedSignaturePage {
  /** Prepared copy: the realtor's original pages plus one appended signature page. */
  buffer: Buffer
  /** One-based DocuSeal page number of the appended page. */
  pageIndex: number
  fields: SignatureField[]
}

/** Letter portrait; the appended page never depends on the uploaded page sizes. */
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792

/**
 * Row layout as fractions of the appended page, measured from the top.
 * The drawn rule sits at the bottom of each box so the DocuSeal field and the
 * printed line land in the same place.
 */
const ROWS = [
  { key: 'SellerName', label: 'Seller printed legal name', type: 'text', role: 'Seller', y: 0.26, h: 0.045, x: 0.09, w: 0.6 },
  { key: 'SellerSignature', label: 'Seller signature', type: 'signature', role: 'Seller', y: 0.34, h: 0.075, x: 0.09, w: 0.6 },
  { key: 'SellerDate', label: 'Date signed', type: 'date', role: 'Seller', y: 0.45, h: 0.045, x: 0.09, w: 0.32 },
  { key: 'BuyerName', label: 'Buyer printed legal name', type: 'text', role: 'Buyer', y: 0.61, h: 0.045, x: 0.09, w: 0.6 },
  { key: 'BuyerSignature', label: 'Buyer signature', type: 'signature', role: 'Buyer', y: 0.69, h: 0.075, x: 0.09, w: 0.6 },
  { key: 'BuyerDate', label: 'Date signed', type: 'date', role: 'Buyer', y: 0.8, h: 0.045, x: 0.09, w: 0.32 },
] as const

/**
 * Append one standard signature page to a realtor-uploaded contract.
 *
 * The uploaded bytes are copied page-for-page and never rewritten, so the
 * agreement the realtor supplied stays exactly as their brokerage produced it.
 * Signing happens only on the appended page.
 */
export async function appendSignaturePage(
  original: Buffer,
  context: { propertyAddress: string; sellerName: string; buyerName: string },
): Promise<PreparedSignaturePage> {
  let source: PDFDocument
  try {
    source = await PDFDocument.load(original)
  } catch {
    throw new BadRequestException('The contract PDF cannot be read. Upload an unencrypted PDF with 1–100 pages.')
  }

  const originalPageCount = source.getPageCount()
  if (!originalPageCount || originalPageCount > 100) {
    throw new BadRequestException('The contract PDF cannot be read. Upload an unencrypted PDF with 1–100 pages.')
  }

  const page = source.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const bold = await source.embedFont(StandardFonts.HelveticaBold)
  const regular = await source.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0.1, 0.1, 0.12)
  const muted = rgb(0.42, 0.42, 0.48)
  const rule = rgb(0.72, 0.72, 0.76)

  // pdf-lib measures y from the bottom; layout fractions are from the top.
  const top = (fraction: number) => PAGE_HEIGHT - fraction * PAGE_HEIGHT

  page.drawText('SIGNATURE PAGE', { x: 0.09 * PAGE_WIDTH, y: top(0.08), size: 18, font: bold, color: ink })
  page.drawText(
    'This page is attached to and forms part of the agreement on the preceding pages.',
    { x: 0.09 * PAGE_WIDTH, y: top(0.11), size: 9.5, font: regular, color: muted },
  )
  if (context.propertyAddress) {
    page.drawText(`Property: ${context.propertyAddress}`.slice(0, 110), {
      x: 0.09 * PAGE_WIDTH, y: top(0.14), size: 10, font: regular, color: ink,
    })
  }

  page.drawText('SELLER', { x: 0.09 * PAGE_WIDTH, y: top(0.21), size: 11, font: bold, color: ink })
  page.drawText('BUYER', { x: 0.09 * PAGE_WIDTH, y: top(0.56), size: 11, font: bold, color: ink })

  const fields: SignatureField[] = []
  for (const row of ROWS) {
    const lineY = top(row.y + row.h)
    page.drawLine({
      start: { x: row.x * PAGE_WIDTH, y: lineY },
      end: { x: (row.x + row.w) * PAGE_WIDTH, y: lineY },
      thickness: 0.8,
      color: rule,
    })
    page.drawText(row.label, { x: row.x * PAGE_WIDTH, y: lineY - 12, size: 8, font: regular, color: muted })
    fields.push({
      name: row.key,
      type: row.type,
      role: row.role,
      required: true,
      areas: [{
        page: originalPageCount + 1,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
      }],
    })
  }

  return { buffer: Buffer.from(await source.save()), pageIndex: originalPageCount + 1, fields }
}
