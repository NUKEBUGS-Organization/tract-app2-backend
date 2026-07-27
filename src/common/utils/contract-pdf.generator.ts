import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface ContractPdfData {
  listerLabel: string
  purchaserLabel: string
  listerName: string
  listerAddress: string
  purchaserName: string
  purchaserAddress: string
  propertyAddress: string
  propertyBlock?: string
  propertyLot?: string
  assignmentPrice: number
  emdAmount: number
  balanceAmount: number
  closingDays: number
  effectiveDate: Date
}

const fmtMoney = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function generateContractPdf(data: ContractPdfData): Promise<Buffer> {
  const { listerLabel, purchaserLabel } = data
  const listerUpper = listerLabel.toUpperCase()
  const purchaserUpper = purchaserLabel.toUpperCase()

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageWidth = 612
  const pageHeight = 792
  const margin = 50
  const contentWidth = pageWidth - margin * 2

  let page = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const black = rgb(0, 0, 0)
  const lineGray = rgb(0.5, 0.5, 0.5)

  const newPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight])
    y = pageHeight - margin
  }

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) newPage()
  }

  const drawCenteredText = (text: string, size: number, f = font, color = black) => {
    const width = f.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (pageWidth - width) / 2, y, size, font: f, color })
    y -= size + 6
  }

  const wrapText = (text: string, size: number, f = font): string[] => {
    const words = text.split(' ')
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const test = current ? `${current} ${word}` : word
      if (f.widthOfTextAtSize(test, size) > contentWidth) {
        if (current) lines.push(current)
        current = word
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
    return lines
  }

  const drawParagraph = (
    text: string,
    size = 10,
    f = font,
    lineHeight = 14,
    spacingAfter = 8,
  ) => {
    const lines = wrapText(text, size, f)
    for (const line of lines) {
      ensureSpace(lineHeight)
      page.drawText(line, { x: margin, y, size, font: f, color: black })
      y -= lineHeight
    }
    y -= spacingAfter
  }

  const drawLabeledParagraph = (
    label: string,
    body: string,
    size = 10,
    lineHeight = 14,
    spacingAfter = 8,
  ) => {
    const fullPlainWidth = fontBold.widthOfTextAtSize(label, size)
    const words = body.split(' ')
    const lines: { text: string; bold: boolean }[][] = []
    let current: { text: string; bold: boolean }[] = [{ text: label, bold: true }]
    let currentWidth = fullPlainWidth

    for (const word of words) {
      const wWidth = font.widthOfTextAtSize(` ${word}`, size)
      if (currentWidth + wWidth > contentWidth) {
        lines.push(current)
        current = [{ text: word, bold: false }]
        currentWidth = font.widthOfTextAtSize(word, size)
      } else {
        current.push({ text: ` ${word}`, bold: false })
        currentWidth += wWidth
      }
    }
    lines.push(current)

    for (const lineSegs of lines) {
      ensureSpace(lineHeight)
      let x = margin
      for (const seg of lineSegs) {
        const f = seg.bold ? fontBold : font
        page.drawText(seg.text, { x, y, size, font: f, color: black })
        x += f.widthOfTextAtSize(seg.text, size)
      }
      y -= lineHeight
    }
    y -= spacingAfter
  }

  const drawHeading = (text: string, size = 11) => {
    ensureSpace(size + 10)
    page.drawText(text, { x: margin, y, size, font: fontBold, color: black })
    y -= size + 8
  }

  const drawLine = (label: string, value: string, size = 10, lineHeight = 16) => {
    ensureSpace(lineHeight + 4)
    const labelWidth = fontBold.widthOfTextAtSize(label, size)
    page.drawText(label, { x: margin, y, size, font: fontBold, color: black })

    const valueX = margin + labelWidth + 4
    const lineEndX = pageWidth - margin

    page.drawText(value, { x: valueX, y, size, font, color: black })

    const valueWidth = font.widthOfTextAtSize(value, size)
    page.drawLine({
      start: { x: valueX + valueWidth + 4, y: y - 2 },
      end: { x: lineEndX, y: y - 2 },
      thickness: 0.75,
      color: lineGray,
    })

    y -= lineHeight + 6
  }

  const drawSignatureLine = (
    label: string,
    value: string,
    dateLabel: string,
    dateValue: string,
    size = 10,
    lineHeight = 18,
  ) => {
    ensureSpace(lineHeight + 6)
    const labelWidth = fontBold.widthOfTextAtSize(label, size)
    page.drawText(label, { x: margin, y, size, font: fontBold, color: black })

    const sigLineStart = margin + labelWidth + 4
    const sigLineEnd = sigLineStart + 220

    page.drawLine({
      start: { x: sigLineStart, y: y - 2 },
      end: { x: sigLineEnd, y: y - 2 },
      thickness: 0.75,
      color: lineGray,
    })

    if (value) {
      page.drawText(value, { x: sigLineStart + 4, y, size, font, color: black })
    }

    const dateLabelX = sigLineEnd + 20
    const dateLabelWidth = fontBold.widthOfTextAtSize(dateLabel, size)
    page.drawText(dateLabel, { x: dateLabelX, y, size, font: fontBold, color: black })

    const dateLineStart = dateLabelX + dateLabelWidth + 4
    page.drawLine({
      start: { x: dateLineStart, y: y - 2 },
      end: { x: pageWidth - margin, y: y - 2 },
      thickness: 0.75,
      color: lineGray,
    })

    if (dateValue) {
      page.drawText(dateValue, { x: dateLineStart + 4, y, size, font, color: black })
    }

    y -= lineHeight + 12
  }

  const spacer = (amount = 8) => {
    y -= amount
  }

  drawCenteredText('NEW JERSEY REAL ESTATE PURCHASE AND SALE AGREEMENT', 14, fontBold)
  spacer(4)

  const effDay = data.effectiveDate.getDate()
  const effMonth = data.effectiveDate.toLocaleDateString('en-US', { month: 'long' })
  const effYearShort = String(data.effectiveDate.getFullYear()).slice(-2)

  drawParagraph(
    `THIS AGREEMENT is made this ${ordinal(effDay)} day of ${effMonth}, ${effYearShort} (the "Effective Date"), by and between:`,
    10,
  )
  spacer(6)

  drawLine(`${listerUpper}:`, data.listerName)
  drawLine('Address:', data.listerAddress)
  spacer(6)

  drawLine(`${purchaserUpper}:`, data.purchaserName)
  drawLine('Address:', data.purchaserAddress)
  spacer(8)

  drawHeading('1. THE PROPERTY.')
  drawParagraph(
    `${listerLabel} agrees to sell and ${purchaserLabel} agrees to buy the following property, together with all improvements and appurtenances (the "Property"):`,
  )
  drawLine('Street Address:', data.propertyAddress)
  drawLine(
    'Legal Description: Block',
    `${data.propertyBlock ?? ''}, Lot ${data.propertyLot ?? ''} (As recorded in county records)`,
  )
  spacer(8)

  drawHeading('2. PURCHASE PRICE.')
  drawParagraph(
    `The total purchase price to be paid by ${purchaserLabel} is ${fmtMoney(data.assignmentPrice)}. Payment shall be made as follows:`,
  )
  drawLabeledParagraph(
    `(a) ${fmtMoney(data.emdAmount)} `,
    `as an Earnest Money Deposit (EMD) to be held in escrow by ${purchaserLabel}'s Title Company within 3 business days of the conclusion of Attorney Review.`,
  )
  drawLabeledParagraph(
    `(b) ${fmtMoney(data.balanceAmount)} `,
    `Balance to be paid at Closing via Cash or Wire Transfer.`,
  )
  spacer(4)

  drawHeading('3. ATTORNEY REVIEW CLAUSE (REQUIRED).')
  drawLabeledParagraph(
    '1. Study by Attorney. ',
    `The ${purchaserLabel} or the ${listerLabel} may choose to have an attorney study this Contract. If an attorney is consulted, the attorney must complete his or her review of the Contract within a three-day period. This Contract will be legally binding at the end of this three-day period unless an attorney for the ${purchaserLabel} or ${listerLabel} reviews and disapproves of the Contract.`,
  )
  drawLabeledParagraph(
    '2. Counting the Time. ',
    `You count the three days from the date of delivery of the signed Contract to the ${purchaserLabel} and ${listerLabel}. You do not count Saturdays, Sundays, or legal holidays.`,
  )
  drawLabeledParagraph(
    '3. Notice of Disapproval. ',
    `If an attorney for the ${purchaserLabel} or the ${listerLabel} reviews and disapproves of this Contract, the attorney must notify the other party named in this Contract within the three-day period.`,
  )
  spacer(4)

  drawHeading('4. MANDATORY SELLER DISCLOSURE (NEW LAW 2024).')
  drawParagraph(
    `${listerLabel} acknowledges the requirement to provide ${purchaserLabel} with a fully completed Seller's Property Condition Disclosure Statement as mandated by New Jersey law (P.L.2024, c.32). ${listerLabel} agrees to deliver this statement to ${purchaserLabel} prior to or upon signing this Agreement. ${purchaserLabel} reserves the right to cancel this Agreement within three (3) days of receipt if the condition is not satisfactory.`,
  )
  spacer(4)

  drawHeading('5. INVESTOR DISCLOSURE & ASSIGNMENT.')
  drawParagraph(
    `${purchaserLabel} is a real estate investor. ${listerLabel} acknowledges that ${purchaserLabel} intends to either purchase the Property, assign this Agreement to a third party for a profit, or resell the Property immediately after closing.`,
  )
  spacer(4)

  drawLabeledParagraph(
    'Assignment Right: ',
    `${purchaserLabel} has the unqualified right to assign its rights under this Agreement to a third party.`,
  )
  drawLabeledParagraph(
    'Release of Liability: ',
    `Upon assignment, the original ${purchaserLabel} and/or Assigner (${data.purchaserName.split(' and/or')[0]}) shall be released from any further liability or obligation under this Agreement.`,
  )
  spacer(4)

  drawHeading('6. "AS-IS" CONDITION & INSPECTION.')
  drawParagraph(
    `${purchaserLabel} accepts the Property in its current "AS-IS" condition. ${listerLabel} shall make no repairs.`,
  )
  drawLabeledParagraph(
    'Inspection Period: ',
    `${purchaserLabel} shall have Fourteen (14) business days from the conclusion of Attorney Review to inspect the Property.`,
  )
  drawLabeledParagraph(
    'Right to Cancel: ',
    `${purchaserLabel} may cancel this Agreement for any reason during the Inspection Period by providing written notice to ${listerLabel}, upon which the Earnest Money Deposit shall be returned to ${purchaserLabel} in full.`,
  )

  drawHeading('7. CLOSING.')
  drawParagraph(
    `Closing shall occur on or before ${data.closingDays} days from the conclusion of Attorney Review. Closing shall be held at a Title Company selected by ${purchaserLabel}. All transfer taxes shall be paid by ${listerLabel}. ${purchaserLabel} shall pay for title insurance and closing fees.`,
  )
  spacer(4)

  drawHeading('8. NO BROKER COMMISSIONS.')
  drawParagraph(
    `Both parties represent that they have not utilized the services of a real estate broker or agent in this transaction. Any undisclosed commissions are the sole responsibility of the party who contracted them.`,
  )
  spacer(4)

  drawHeading('9. ACCESS.')
  drawParagraph(
    `${listerLabel} agrees to provide ${purchaserLabel}, ${purchaserLabel}'s partners, contractors, and potential assignees access to the Property during daylight hours for the purpose of inspection, marketing, and due diligence.`,
  )
  spacer(20)

  drawSignatureLine(`${listerUpper} SIGNATURE:`, '', 'Date:', '')
  drawSignatureLine('Print Name:', data.listerName, '', '')
  spacer(10)

  drawSignatureLine(`${purchaserUpper} SIGNATURE:`, '', 'Date:', '')
  drawSignatureLine('Print Name:', '', '', '')
  drawSignatureLine('By:', '', '(Authorized Member)', '')

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
