import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface ContractPdfData {
  /** Kept for API compatibility; PDF body uses Seller / Buyer per TRACT end-buyer template. */
  listerLabel: string
  purchaserLabel: string
  listerName: string
  listerAddress: string
  purchaserName: string
  purchaserAddress: string
  propertyAddress: string
  propertyBlock?: string
  propertyLot?: string
  propertyCounty?: string
  propertyType?: string
  assignmentPrice: number
  emdAmount: number
  balanceAmount: number
  /** Calendar days from attorney review for feasibility / inspection (default 45). */
  feasibilityDays?: number
  /** Business days to deposit EMD after attorney review (default 3). */
  emdDepositDays?: number
  closingDays: number
  effectiveDate: Date
}

const fmtMoney = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function generateContractPdf(data: ContractPdfData): Promise<Buffer> {
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

  const feasibilityDays = data.feasibilityDays ?? 45
  const emdDepositDays = data.emdDepositDays ?? 3
  const closingDate = new Date(data.effectiveDate)
  closingDate.setDate(closingDate.getDate() + data.closingDays)
  const closingDateStr = closingDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const footerGray = rgb(0.35, 0.35, 0.35)

  const drawPageChrome = () => {
    const header = 'TRACT INC.   |   Real Estate Acquisitions'
    page.drawText(header, {
      x: margin,
      y: pageHeight - 28,
      size: 8,
      font: fontBold,
      color: footerGray,
    })
    const foot =
      'TRACT INC. • Purchase & Sale Agreement Template • Universal End-Buyer Use — All Property Types'
    page.drawText(foot, {
      x: margin,
      y: 28,
      size: 7,
      font,
      color: footerGray,
    })
  }

  const newPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight])
    drawPageChrome()
    y = pageHeight - margin - 12
  }

  const ensureSpace = (needed: number) => {
    if (y - needed < margin + 16) newPage()
  }

  const drawCenteredText = (text: string, size: number, f = font, color = black) => {
    const width = f.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (pageWidth - width) / 2, y, size, font: f, color })
    y -= size + 6
  }

  drawPageChrome()
  y = pageHeight - margin - 12

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

  const drawBullet = (text: string, size = 10, lineHeight = 14) => {
    const bullet = '• '
    const indent = 14
    const lines = wrapText(text, size, font)
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lineHeight)
      const prefix = i === 0 ? bullet : '  '
      page.drawText(prefix + lines[i], {
        x: margin + indent,
        y,
        size,
        font,
        color: black,
      })
      y -= lineHeight
    }
    y -= 4
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

    if (dateLabel) {
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
    }

    y -= lineHeight + 12
  }

  const spacer = (amount = 8) => {
    y -= amount
  }

  // ── Header ──────────────────────────────────────────────────
  drawCenteredText('TRACT INC.', 12, fontBold)
  drawCenteredText('NEW JERSEY REAL ESTATE PURCHASE AND SALE AGREEMENT', 13, fontBold)
  drawCenteredText('UNIVERSAL BLANK TEMPLATE — FOR END-BUYER USE (ALL PROPERTY TYPES)', 8, font)
  spacer(6)

  const effDay = data.effectiveDate.getDate()
  const effMonth = data.effectiveDate.toLocaleDateString('en-US', { month: 'long' })
  const effYearShort = String(data.effectiveDate.getFullYear()).slice(-2)

  drawParagraph(
    `THIS AGREEMENT is made this ${ordinal(effDay)} day of ${effMonth}, 20${effYearShort} (the "Effective Date"), by and between:`,
    10,
  )
  spacer(4)

  drawLine('SELLER:', data.listerName)
  drawLine('Address:', data.listerAddress)
  drawParagraph('("Seller")', 9, font, 12, 4)
  spacer(4)

  drawLine('BUYER:', data.purchaserName)
  drawLine('Address:', data.purchaserAddress)
  drawParagraph('("Buyer")', 9, font, 12, 4)
  spacer(4)

  drawParagraph(
    'Seller and Buyer are collectively referred to as the "Parties." This Agreement is a universal form intended for use with any type of real property, including but not limited to single-family residential, multi-family residential, commercial, industrial, mixed-use, vacant land, and raw undeveloped land (collectively, the "Property"), and shall be completed and modified by the Parties and their respective counsel as appropriate to the specific Property type and transaction.',
  )

  // ── 1. THE PROPERTY ─────────────────────────────────────────
  drawHeading('1. THE PROPERTY.')
  drawParagraph(
    'Seller agrees to sell and convey, and Buyer agrees to purchase, the following real property, together with all improvements, fixtures, easements, rights of way, and appurtenances thereto (the "Property"):',
  )
  drawLine('Street Address:', data.propertyAddress)
  const county = data.propertyCounty ? `${data.propertyCounty} County` : 'county'
  drawLine(
    'Legal Description: Block',
    `${data.propertyBlock ?? '______________'}, Lot ${data.propertyLot ?? '______________'} (as recorded in ${county} records)`,
  )
  if (data.propertyType) {
    drawLine('Property Type:', data.propertyType)
  } else {
    drawParagraph(
      'Property Type (check applicable): Residential (Single-Family / Multi-Family / Condominium); Commercial / Industrial / Mixed-Use; Vacant / Unimproved Land; Raw Land / Undeveloped Acreage; Other.',
      9,
      font,
      12,
      6,
    )
  }
  drawParagraph(
    "The Property is sold together with all of Seller's right, title, and interest in any improvements, structures, timber, mineral rights (to the extent owned by Seller), and appurtenant easements, unless otherwise excluded in writing by the Parties.",
  )

  // ── 2. PURCHASE PRICE ───────────────────────────────────────
  drawHeading('2. PURCHASE PRICE.')
  drawParagraph(
    `The total purchase price to be paid by Buyer is ${fmtMoney(data.assignmentPrice)} (the "Purchase Price"). Payment shall be made as follows:`,
  )
  drawLabeledParagraph(
    `(a) ${fmtMoney(data.emdAmount)} `,
    `as an Earnest Money Deposit ("EMD") to be held in escrow by a licensed title company or attorney trust account mutually agreed upon by the Parties, deposited within ${emdDepositDays} business days of the conclusion of Attorney Review.`,
  )
  drawLabeledParagraph(
    `(b) ${fmtMoney(data.balanceAmount)} `,
    'balance of the Purchase Price, subject to customary closing prorations and adjustments, to be paid at Closing via wire transfer of immediately available funds or other means acceptable to the closing agent.',
  )

  // ── 3. ATTORNEY REVIEW ──────────────────────────────────────
  drawHeading('3. ATTORNEY REVIEW CLAUSE (REQUIRED).')
  drawLabeledParagraph(
    '1. Study by Attorney. ',
    'The Buyer or the Seller may choose to have an attorney study this Contract. If an attorney is consulted, the attorney must complete his or her review of the Contract within a three-day period. This Contract will be legally binding at the end of this three-day period unless an attorney for the Buyer or Seller reviews and disapproves of the Contract.',
  )
  drawLabeledParagraph(
    '2. Counting the Time. ',
    'You count the three days from the date of delivery of the signed Contract to the Buyer and Seller. You do not count Saturdays, Sundays, or legal holidays.',
  )
  drawLabeledParagraph(
    '3. Notice of Disapproval. ',
    'If an attorney for the Buyer or the Seller reviews and disapproves of this Contract, the attorney must notify the other party named in this Contract within the three-day period.',
  )

  // ── 4. DISCLOSURE ───────────────────────────────────────────
  drawHeading('4. MANDATORY SELLER DISCLOSURE.')
  drawParagraph(
    "To the extent applicable to the Property type, Seller acknowledges the requirement to provide Buyer with a fully completed Seller's Property Condition Disclosure Statement as mandated by New Jersey law (P.L.2024, c.32), or such other disclosure as required by applicable New Jersey statute for the Property type being conveyed (including any applicable commercial, land, or environmental disclosures). Seller agrees to deliver all legally required disclosures to Buyer prior to or upon signing this Agreement. Buyer reserves the right to cancel this Agreement within three (3) days of receipt of any such disclosure if its contents are not satisfactory to Buyer, in which event the EMD shall be returned to Buyer in full.",
  )

  // ── 5. FEASIBILITY ──────────────────────────────────────────
  drawHeading('5. FEASIBILITY AND INSPECTION PERIOD.')
  drawParagraph(
    `Buyer shall have a period of ${feasibilityDays} calendar days following the conclusion of Attorney Review (the "Feasibility Period") within which to conduct, at Buyer's sole cost and expense, any and all due diligence, testing, and investigations Buyer deems necessary or desirable to evaluate the Property, including without limitation:`,
  )
  drawBullet('Percolation and soil testing, geotechnical borings, and load-bearing analysis;')
  drawBullet('Phase I (and, if warranted, Phase II) Environmental Site Assessments;')
  drawBullet(
    'Boundary and topographic surveys, ALTA/NSPS land title surveys, and wetlands delineation;',
  )
  drawBullet(
    'Availability and capacity of public or private utilities (water, sewer/septic, electric, gas, and telecommunications) and any required will-serve letters;',
  )
  drawBullet(
    "Zoning classification, land use entitlements, variance requirements, and confirmation that Buyer's intended use is a permitted or conditional use;",
  )
  drawBullet('Flood zone, wetlands, and other regulatory or environmental overlay designations;')
  drawBullet(
    'For improved property, structural, mechanical, electrical, plumbing, roof, pest/termite, and general physical condition inspections;',
  )
  drawBullet(
    'Review of title, survey, existing leases, service contracts, permits, and any other documents affecting the Property.',
  )
  drawParagraph(
    "Seller shall, upon reasonable advance notice, provide Buyer and Buyer's agents, engineers, surveyors, contractors, and consultants with reasonable access to the Property to perform the foregoing inspections and studies, provided Buyer restores the Property to substantially its condition prior to any invasive testing and maintains commercially reasonable liability insurance covering such access.",
  )

  // ── 6. CONTINGENCIES ────────────────────────────────────────
  drawHeading('6. APPROVAL CONTINGENCIES; RIGHT TO CANCEL.')
  drawParagraph(
    "Buyer's obligation to proceed to Closing is expressly contingent upon Buyer's receipt of results from the inspections, studies, and due diligence described in Section 5 that are satisfactory to Buyer, in Buyer's sole and absolute discretion, and that confirm the Property is suitable for Buyer's intended use, development, or holding purpose.",
  )
  drawParagraph(
    'At any time prior to the expiration of the Feasibility Period, Buyer may, for any reason or no reason, terminate this Agreement by delivering written notice of cancellation to Seller. Upon timely delivery of such notice, the EMD shall be returned to Buyer in full within five (5) business days, and neither Party shall have any further rights, obligations, or liability under this Agreement, except for those obligations that expressly survive termination. If Buyer fails to deliver written notice of cancellation prior to the expiration of the Feasibility Period, the feasibility contingency shall be deemed satisfied and waived by Buyer.',
  )

  // ── 7. AS-IS ────────────────────────────────────────────────
  drawHeading('7. "AS-IS" CONDITION.')
  drawParagraph(
    'Except as otherwise expressly set forth in this Agreement, and subject to Buyer\'s rights under Sections 5 and 6 above, Buyer acknowledges and agrees that the Property is being sold, and Buyer is purchasing the Property, strictly in its "AS-IS, WHERE-IS" condition, with all faults, and without any representation or warranty of any kind, express or implied, from Seller as to the physical condition, environmental condition, zoning, entitlement status, boundaries, income potential, or suitability of the Property for Buyer\'s intended use. Seller shall have no obligation to make any repairs, remediation, or improvements to the Property, except as otherwise expressly agreed in writing by Seller.',
  )

  // ── 8. TITLE AND TAXES ──────────────────────────────────────
  drawHeading('8. TITLE AND TAXES.')
  drawParagraph(
    "Seller shall convey marketable, insurable fee simple title to the Property to Buyer by a bargain and sale deed with covenants against grantor's acts (or such other form of deed as is customary for the Property type and jurisdiction), free and clear of all liens and encumbrances except those expressly permitted by Buyer in writing, real estate taxes not yet due and payable, and utility easements of record that do not materially interfere with Buyer's intended use. Real estate taxes, assessments, and any applicable homeowners' or property owners' association dues shall be prorated as of the date of Closing. All realty transfer fees imposed by the State of New Jersey shall be paid by Seller, unless otherwise required by law or agreed in writing.",
  )

  // ── 9. CLOSING ──────────────────────────────────────────────
  drawHeading('9. CLOSING.')
  drawParagraph(
    `Closing shall occur on or before ${closingDateStr} (approximately ${data.closingDays} days from the Effective Date), or such earlier or later date as the Parties may mutually agree in writing, or as automatically extended in accordance with Section 5 above. Closing shall be conducted through a title company or closing attorney mutually agreed upon by the Parties. Buyer shall be responsible for the cost of title insurance, survey (if obtained), recording fees, and Buyer's own attorney's fees. Seller shall be responsible for New Jersey realty transfer fees and any liens or encumbrances required to be satisfied to convey clear title. Closing costs not otherwise addressed above shall be allocated in accordance with custom and practice in the county in which the Property is located.`,
  )

  // ── 10. NO BROKER ───────────────────────────────────────────
  drawHeading('10. NO BROKER COMMISSIONS.')
  drawParagraph(
    'Each Party represents and warrants to the other that it has not engaged, dealt with, or utilized the services of any real estate broker, agent, or finder in connection with this transaction, and that no commission, fee, or other compensation is owed to any broker, agent, or finder as a result of this Agreement. Each Party shall indemnify and hold the other harmless from any claim for commission, fee, or compensation made by any broker, agent, or finder claiming to have dealt with the indemnifying Party.',
  )

  // ── 11. ACCESS ──────────────────────────────────────────────
  drawHeading('11. ACCESS.')
  drawParagraph(
    "Seller agrees to provide Buyer and Buyer's agents, employees, contractors, consultants, engineers, and surveyors with reasonable access to the Property, during normal business hours and upon reasonable prior notice, for purposes of conducting the inspections, testing, surveying, and due diligence contemplated by this Agreement.",
  )

  // ── 12. DEFAULT ─────────────────────────────────────────────
  drawHeading('12. DEFAULT AND REMEDIES.')
  drawParagraph(
    "If Buyer fails to close after all contingencies under this Agreement have been satisfied or waived, and such failure is not cured within ten (10) days after written notice from Seller, Seller's sole and exclusive remedy shall be to terminate this Agreement and retain the EMD as liquidated damages, and not as a penalty, the Parties acknowledging that Seller's actual damages would be difficult to ascertain. If Seller fails or refuses to close or otherwise materially breaches this Agreement, Buyer shall be entitled, as its sole and exclusive remedies, to either (a) terminate this Agreement and receive a full refund of the EMD, or (b) seek specific performance of this Agreement.",
  )

  // ── 13. GENERAL ─────────────────────────────────────────────
  drawHeading('13. GENERAL PROVISIONS.')
  drawLabeledParagraph(
    '(a) Governing Law. ',
    'This Agreement shall be governed by and construed in accordance with the laws of the State of New Jersey, without regard to conflict of laws principles.',
  )
  drawLabeledParagraph(
    '(b) Entire Agreement. ',
    'This Agreement constitutes the entire agreement between the Parties and supersedes all prior negotiations, representations, or agreements, whether written or oral, relating to the Property.',
  )
  drawLabeledParagraph(
    '(c) Amendment. ',
    'This Agreement may only be amended or modified by a written instrument signed by both Parties.',
  )
  drawLabeledParagraph(
    '(d) Notices. ',
    'All notices required under this Agreement shall be in writing and delivered by email with confirmation of receipt, certified mail, or nationally recognized overnight courier to the addresses set forth above, or to counsel for the respective Party if Attorney Review is invoked.',
  )
  drawLabeledParagraph(
    '(e) Counterparts; Electronic Signatures. ',
    'This Agreement may be executed in counterparts, including by electronic or digital signature, each of which shall be deemed an original and all of which together shall constitute one and the same instrument.',
  )
  drawLabeledParagraph(
    '(f) Survival. ',
    'The provisions of Sections 10 (No Broker Commissions) and 14 (Platform Disclaimer, Non-Agency, and Limitation of Liability) shall survive the Closing, cancellation, or termination of this Agreement.',
  )

  // ── 14. PLATFORM DISCLAIMER ─────────────────────────────────
  drawHeading('14. PLATFORM DISCLAIMER, NON-AGENCY, AND LIMITATION OF LIABILITY.')
  drawParagraph(
    'This Section 14 is a material and conspicuous term of this Agreement, is incorporated into and made a part of this Agreement for all purposes, and shall survive the Closing, Attorney Review, cancellation, or termination of this Agreement.',
  )
  drawLabeledParagraph(
    '(a) Technology Provider Status; TRACT Not a Party. ',
    'TRACT Inc. ("TRACT") is strictly a software-as-a-service (SaaS) technology platform and clearinghouse, currently operating in a sixty (60)-day beta subscription period, that made available the software used to generate this Agreement. TRACT IS NOT, AND SHALL NOT BE CONSTRUED TO BE, A BUYER, SELLER, GUARANTOR, ESCROW AGENT, OR PARTY TO THIS AGREEMENT. TRACT holds no right, title, or interest in the Property, does not receive, hold, or disburse the Earnest Money Deposit, and has no obligation whatsoever to perform, enforce, guarantee, or otherwise ensure performance of any term of this Agreement by Buyer or Seller.',
  )
  drawLabeledParagraph(
    '(b) No Brokerage; No Agency; No Fiduciary Relationship. ',
    "TRACT is not a licensed real estate broker or salesperson in New York or New Jersey and does not act, and shall not be deemed to act, as a broker, agent, dual agent, transaction broker, or fiduciary for Buyer, Seller, or any other platform user, and owes no fiduciary or other duty of care to any party in connection with this Agreement or the underlying transaction. No commission, referral fee, success fee, or other transaction-based compensation of any kind is owed to TRACT arising from the sale or purchase of the Property. TRACT's sole compensation from its users is the recurring subscription fee paid under TRACT's separate Terms of Service, which is earned by TRACT irrespective of whether this Agreement closes, is cancelled, or is terminated.",
  )
  drawLabeledParagraph(
    '(c) No Legal Advice; Independent Counsel Encouraged. ',
    "This Agreement was generated using TRACT's automated template-generation software solely for the convenience of the Parties. THIS DOCUMENT IS A TEMPLATE AND DOES NOT CONSTITUTE LEGAL ADVICE. Its generation, delivery, or use does not create, and shall not be construed to create, an attorney-client relationship between TRACT and Buyer, Seller, or any other party or user. TRACT does not review, revise, or verify the content of this Agreement for legal sufficiency, accuracy, or suitability to any particular transaction or Property type. BUYER AND SELLER ARE EACH STRONGLY ENCOURAGED TO RETAIN INDEPENDENT LICENSED COUNSEL IN NEW YORK OR NEW JERSEY, AS APPLICABLE, TO REVIEW THIS AGREEMENT BEFORE SIGNING, INCLUDING BY EXERCISING THE RIGHTS AFFORDED UNDER SECTION 3 (ATTORNEY REVIEW CLAUSE) ABOVE.",
  )
  drawLabeledParagraph(
    '(d) Beta Platform; "As-Is" Software. ',
    'This Agreement was generated during TRACT\'s sixty (60)-day beta subscription period. THE TRACT PLATFORM, AND ALL SOFTWARE, TEMPLATES, AND OUTPUTS GENERATED BY IT, ARE PROVIDED STRICTLY "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, OR NON-INFRINGEMENT. TRACT DOES NOT WARRANT OR GUARANTEE UNINTERRUPTED, TIMELY, OR ERROR-FREE OPERATION OF THE PLATFORM DURING THE BETA PERIOD OR THEREAFTER.',
  )
  drawLabeledParagraph(
    '(e) Limitation of Liability. ',
    "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE NEW YORK AND NEW JERSEY LAW, IN NO EVENT SHALL TRACT, OR ITS FOUNDERS, OFFICERS, DIRECTORS, EMPLOYEES, CONTRACTORS, OR AFFILIATES (COLLECTIVELY, THE \"TRACT PARTIES\"), BE LIABLE TO BUYER, SELLER, OR ANY THIRD PARTY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, LOSS OF BARGAIN, OR LOSS OF THE EARNEST MONEY DEPOSIT, ARISING OUT OF OR RELATING TO: (i) THE EXECUTION, PERFORMANCE, NONPERFORMANCE, BREACH, TERMINATION, OR ENFORCEMENT OF THIS AGREEMENT; (ii) THE FAILURE OF BUYER OR SELLER TO CLOSE; (iii) ANY DISPUTE OVER THE EARNEST MONEY DEPOSIT, INCLUDING ITS ESCROW, DISBURSEMENT, OR RETURN; OR (iv) ANY ERROR, OMISSION, OR AMBIGUITY IN THIS TEMPLATE, REGARDLESS OF WHETHER SUCH CLAIM IS BASED IN CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR OTHERWISE, AND EVEN IF A TRACT PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. IN NO EVENT SHALL THE TRACT PARTIES' AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT EXCEED THE TOTAL SUBSCRIPTION FEES ACTUALLY PAID BY THE CLAIMING PARTY TO TRACT DURING THE THREE (3) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.",
  )
  drawLabeledParagraph(
    '(f) Indemnification; Hold Harmless. ',
    'BUYER AND SELLER EACH, JOINTLY AND SEVERALLY AS TO THEIR RESPECTIVE ACTS AND OMISSIONS, AGREE TO INDEMNIFY, DEFEND, AND HOLD HARMLESS THE TRACT PARTIES FROM AND AGAINST ANY AND ALL CLAIMS, DEMANDS, LOSSES, LIABILITIES, DAMAGES, JUDGMENTS, FINES, PENALTIES, COSTS, AND EXPENSES (INCLUDING REASONABLE ATTORNEYS\' FEES) ARISING OUT OF OR RELATED TO: (i) THIS AGREEMENT, INCLUDING ITS NEGOTIATION, EXECUTION, PERFORMANCE, BREACH, OR TERMINATION; (ii) ANY FAILURE OF BUYER OR SELLER TO CLOSE OR OTHERWISE PERFORM; (iii) ANY DISPUTE BETWEEN BUYER AND SELLER, OR BETWEEN EITHER OF THEM AND ANY THIRD PARTY (INCLUDING ANY TITLE COMPANY OR ESCROW HOLDER), RELATING TO THE EARNEST MONEY DEPOSIT OR THE PROPERTY; AND (iv) ANY BREACH OF THE REPRESENTATIONS IN SECTION 10 (NO BROKER COMMISSIONS) OR OF ANY OTHER REPRESENTATION MADE BY BUYER OR SELLER IN THIS AGREEMENT. THIS INDEMNIFICATION OBLIGATION SURVIVES THE CLOSING, CANCELLATION, OR TERMINATION OF THIS AGREEMENT.',
  )
  drawLabeledParagraph(
    '(g) Acknowledgment. ',
    'BY SIGNING BELOW, BUYER AND SELLER EACH ACKNOWLEDGE THAT THEY HAVE READ AND UNDERSTAND THIS SECTION 14 IN ITS ENTIRETY, THAT ITS TERMS ARE CONSPICUOUS AND MATERIAL TO THIS AGREEMENT, AND THAT THEY HAVE HAD A FULL AND FAIR OPPORTUNITY TO REVIEW THIS SECTION WITH INDEPENDENT COUNSEL PRIOR TO SIGNING.',
  )

  spacer(16)
  drawHeading('SIGNATURES')
  spacer(8)
  drawSignatureLine('SELLER SIGNATURE:', '', 'Date:', '')
  drawSignatureLine('Print Name:', data.listerName, '', '')
  spacer(10)
  drawSignatureLine('BUYER SIGNATURE:', '', 'Date:', '')
  drawSignatureLine('Print Name / Entity Name:', data.purchaserName, '', '')
  drawSignatureLine('By:', '', '(Authorized Signatory, if applicable)', '')

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
