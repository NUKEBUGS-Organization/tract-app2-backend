import { ContractsService } from './contracts.service'
import { PDFDocument } from 'pdf-lib'

jest.mock('../gateway/app.gateway', () => ({ AppGateway: class {} }))

describe('realtor contract lifecycle', () => {
  const contractId = '507f1f77bcf86cd799439011'
  const buyer = '507f1f77bcf86cd799439012'
  const lister = '507f1f77bcf86cd799439013'
  let file: { buffer: Buffer; mimetype: string; originalname: string }
  beforeAll(async () => {
    const pdf = await PDFDocument.create(); pdf.addPage()
    file = { buffer: Buffer.from(await pdf.save()), mimetype: 'application/pdf', originalname: 'signed.pdf' }
  })
  function setup(overrides: Record<string, unknown> = {}) {
    let row: any = { _id: contractId, signingMethod: 'manual', status: 'pending', wholesalerId: lister,
      buyerId: buyer, wholesalerSignedAt: new Date(), buyerSignedAt: null, listingId: contractId, ...overrides }
    const model = {
      findById: jest.fn(async () => row),
      findOneAndUpdate: jest.fn(async (query, update) => {
        if (row.status !== query.status || row.buyerSignedAt) return null
        row = { ...row, ...update.$set }; return row
      }),
    }
    const storage = { uploadFile: jest.fn(async (..._args: unknown[]) => ({ secure_url: 'https://res.cloudinary.com/test/raw/upload/final.pdf', public_id: 'final' })), deleteFile: jest.fn() }
    const subscriptions = { assertCanExecute: jest.fn(async () => {}) }
    const deals = { createDealFromContract: jest.fn() }
    const service = new ContractsService(model as never, {} as never, {} as never, {} as never,
      storage as never, subscriptions as never, { emitToUser: jest.fn() } as never, {} as never,
      { create: jest.fn() } as never, deals as never)
    return { service, model, storage, subscriptions, deals }
  }
  it('rejects other parties, cancelled contracts and DocuSeal flows before uploading', async () => {
    const other = setup()
    await expect(other.service.uploadBuyerSignedContract(contractId, lister, { buyerSigned: true }, file)).rejects.toThrow('Only the buyer')
    expect(other.storage.uploadFile).not.toHaveBeenCalled()
    await expect(setup({ status: 'cancelled' }).service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)).rejects.toThrow('cancelled')
    await expect(setup({ signingMethod: 'docuseal' }).service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)).rejects.toThrow('manual')
  })
  it('requires confirmation and a paid subscription', async () => {
    await expect(setup().service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: false }, file)).rejects.toThrow('Confirm')
    const state = setup(); state.subscriptions.assertCanExecute.mockRejectedValue(new Error('Unpaid'))
    await expect(state.service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)).rejects.toThrow('Unpaid')
    expect(state.storage.uploadFile).not.toHaveBeenCalled()
  })
  it('keeps the realtor original, appends a signature page and signs it through DocuSeal', async () => {
    const listing = { _id: contractId, wholesalerId: lister, propertyAddress: '123 Main St', city: 'Newark', stateCode: 'NJ' }
    const bid = { _id: buyer, listingId: contractId, buyerId: buyer, status: 'primary', assignmentPrice: 200000 }
    const created: any[] = []
    const model = {
      findOne: jest.fn(async () => null),
      create: jest.fn(async (value: Record<string, unknown>) => {
        const row = { _id: contractId, ...value, save: jest.fn() }
        created.push(row); return row
      }),
    }
    const storage = { uploadFile: jest.fn(async (_buffer: Buffer, _folder: string, name: string) => ({
      secure_url: `https://example.invalid/${name}`, public_id: name })) }
    const docuseal = {
      createUploadedTemplate: jest.fn(async () => 77),
      createSubmission: jest.fn(async () => ({ id: 9, submitters: [
        { id: 1, role: 'Seller', email: 'a@b.c', external_id: `${contractId}:lister`, embed_src: 'seller-src', status: 'pending' },
        { id: 2, role: 'Buyer', email: 'd@e.f', external_id: `${contractId}:purchaser`, embed_src: 'buyer-src', status: 'pending' },
      ] })),
    }
    const service = new ContractsService(model as never, { findById: async () => bid } as never,
      { findById: async () => listing } as never,
      { findById: async (id: string) => ({ _id: id, role: id === lister ? 'realtor' : 'buyer', fullName: 'Test User', email: `${id}@example.invalid` }) } as never,
      storage as never, { assertCanExecute: async () => {} } as never,
      { emitToUser: jest.fn() } as never, docuseal as never, { create: jest.fn() } as never, {} as never)

    const contract = await service.createContract(contractId, lister, { bidId: buyer }, file)

    expect(contract.signingMethod).toBe('docuseal')
    // The realtor does not pre-sign any more; DocuSeal records the signature.
    expect(contract.wholesalerSignedAt).toBeNull()
    expect(contract.originalPdfUrl).toContain('original_contract_')
    // The stored original must be the exact uploaded bytes.
    const originalCall = storage.uploadFile.mock.calls.find(call => String(call[2]).startsWith('original_contract_'))
    expect(originalCall?.[0]).toEqual(file.buffer)
    // The prepared copy keeps every original page and adds exactly one.
    const preparedCall = storage.uploadFile.mock.calls.find(call => String(call[2]).startsWith('contract_'))
    const preparedPdf = await PDFDocument.load(preparedCall?.[0] as Buffer)
    expect(preparedPdf.getPageCount()).toBe(2)

    const fields = docuseal.createUploadedTemplate.mock.calls[0][2] as Array<Record<string, any>>
    expect(fields.map(f => f.name)).toEqual([
      'SellerName', 'SellerSignature', 'SellerDate', 'BuyerName', 'BuyerSignature', 'BuyerDate',
    ])
    expect(fields.filter(f => f.role === 'Seller')).toHaveLength(3)
    expect(fields.filter(f => f.role === 'Buyer')).toHaveLength(3)
    // Every field belongs to the appended page, never over the realtor's text.
    expect(fields.every(f => f.areas[0].page === 1)).toBe(true)
    expect(docuseal.createSubmission.mock.calls[0][1]).toBe(77)
    // The standard template's private values must not leak onto this template.
    const [seller, buyerSubmitter] = docuseal.createSubmission.mock.calls[0][0] as Array<Record<string, any>>
    expect(Object.keys(seller.values)).toEqual(['SellerName'])
    expect(Object.keys(buyerSubmitter.values)).toEqual(['BuyerName'])
  })

  it('rejects a realtor upload that is not a readable PDF', async () => {
    const listing = { _id: contractId, wholesalerId: lister, propertyAddress: '123 Main St' }
    const bid = { _id: buyer, listingId: contractId, buyerId: buyer, status: 'primary', assignmentPrice: 200000 }
    const storage = { uploadFile: jest.fn() }
    const service = new ContractsService({ findOne: async () => null, create: jest.fn() } as never,
      { findById: async () => bid } as never, { findById: async () => listing } as never,
      { findById: async (id: string) => ({ _id: id, role: id === lister ? 'realtor' : 'buyer', fullName: 'Test User', email: 'a@b.c' }) } as never,
      storage as never, { assertCanExecute: async () => {} } as never,
      { emitToUser: jest.fn() } as never, {} as never, { create: jest.fn() } as never, {} as never)
    await expect(service.createContract(contractId, lister, { bidId: buyer },
      { buffer: Buffer.from('not a pdf'), mimetype: 'application/pdf', originalname: 'x.pdf' })).rejects.toThrow('PDF')
    expect(storage.uploadFile).not.toHaveBeenCalled()
  })

  it('stores final bytes once, marks signed and creates the deal; retries never replace it', async () => {
    const state = setup()
    const signed = await state.service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)
    expect(signed.status).toBe('signed')
    expect(signed.buyerSignedAt).toBeInstanceOf(Date)
    expect(state.storage.uploadFile.mock.calls[0][0]).toEqual(file.buffer)
    expect(state.deals.createDealFromContract).toHaveBeenCalledWith(contractId)
    await state.service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)
    expect(state.storage.uploadFile).toHaveBeenCalledTimes(1)
  })
  it('allows only one simultaneous final upload to win', async () => {
    const state = setup()
    const results = await Promise.allSettled([1, 2].map(() => state.service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(state.deals.createDealFromContract).toHaveBeenCalledTimes(1)
    expect(state.storage.deleteFile).toHaveBeenCalledTimes(1)
    expect(state.storage.uploadFile.mock.calls[0][2]).not.toEqual(state.storage.uploadFile.mock.calls[1][2])
  })
  it('retries deal creation after a failure without replacing the final PDF', async () => {
    const state = setup()
    state.deals.createDealFromContract.mockRejectedValueOnce(new Error('Temporary deal failure'))
    await expect(state.service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)).rejects.toThrow('Temporary deal failure')
    await expect(state.service.uploadBuyerSignedContract(contractId, buyer, { buyerSigned: true }, file)).resolves.toMatchObject({ status: 'signed' })
    expect(state.storage.uploadFile).toHaveBeenCalledTimes(1)
  })
})
