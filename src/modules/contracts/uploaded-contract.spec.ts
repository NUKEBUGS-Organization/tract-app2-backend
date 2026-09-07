import { PDFDocument } from 'pdf-lib'
import { prepareUploadedContract } from './uploaded-contract'

describe('uploaded realtor agreement', () => {
  it('preserves all original pages and appends a signature page', async () => {
    const original = await PDFDocument.create()
    original.addPage([400, 500])
    const result = await prepareUploadedContract({ buffer: Buffer.from(await original.save()), mimetype: 'application/pdf' })
    const prepared = await PDFDocument.load(result.buffer)
    expect(prepared.getPageCount()).toBe(2)
    expect(prepared.getPage(0).getSize()).toEqual({ width: 400, height: 500 })
    expect(result.signaturePage).toBe(2)
  })
  it('rejects missing, mislabeled and unreadable uploads', async () => {
    await expect(prepareUploadedContract()).rejects.toThrow('Upload your contract')
    await expect(prepareUploadedContract({ buffer: Buffer.from('not PDF'), mimetype: 'application/pdf' })).rejects.toThrow()
    await expect(prepareUploadedContract({ buffer: Buffer.from('%PDF-broken'), mimetype: 'application/pdf' })).rejects.toThrow('cannot be read')
  })
})
