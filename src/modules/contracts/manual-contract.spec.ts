import { ContractsService } from './contracts.service'
import { PDFDocument } from 'pdf-lib'

jest.mock('../gateway/app.gateway', () => ({ AppGateway: class {} }))

describe('manual realtor contract lifecycle', () => {
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
  it('requires realtor confirmation and creates a manual contract without DocuSeal', async () => {
    const listing = { _id: contractId, wholesalerId: lister, propertyAddress: '123 Main St' }
    const bid = { _id: buyer, listingId: contractId, buyerId: buyer, status: 'primary', assignmentPrice: 200000 }
    const model = { findOne: jest.fn(async () => null), create: jest.fn(async value => ({ _id: contractId, ...value })) }
    const storage = { uploadFile: jest.fn(async () => ({ secure_url: 'https://example.invalid/original.pdf' })) }
    const docuseal = { createSubmission: jest.fn(), createUploadedTemplate: jest.fn() }
    const service = new ContractsService(model as never, { findById: async () => bid } as never,
      { findById: async () => listing } as never,
      { findById: async (id: string) => ({ _id: id, role: id === lister ? 'realtor' : 'buyer', fullName: 'Test User' }) } as never,
      storage as never, { assertCanExecute: async () => {} } as never,
      { emitToUser: jest.fn() } as never, docuseal as never, { create: jest.fn() } as never, {} as never)
    await expect(service.createContract(contractId, lister, { bidId: buyer }, file)).rejects.toThrow('Confirm')
    expect(storage.uploadFile).not.toHaveBeenCalled()
    const contract = await service.createContract(contractId, lister, { bidId: buyer, realtorSigned: true }, file)
    expect(contract.signingMethod).toBe('manual')
    expect(contract.wholesalerSignedAt).toBeInstanceOf(Date)
    expect(contract.pdfUrl).toBe('https://example.invalid/original.pdf')
    expect(docuseal.createSubmission).not.toHaveBeenCalled()
    expect(docuseal.createUploadedTemplate).not.toHaveBeenCalled()
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
