import { PDFDocument } from 'pdf-lib'
import { prepareUploadedContract } from './uploaded-contract'

describe('uploaded realtor agreement', () => {
  it('preserves signed agreement bytes and pages without altering the PDF', async () => {
    const original = await PDFDocument.create()
    original.addPage([400, 500])
    const source = Buffer.from(await original.save())
    const result = await prepareUploadedContract({ buffer: source, mimetype: 'application/pdf' })
    const prepared = await PDFDocument.load(result.buffer)
    expect(prepared.getPageCount()).toBe(1)
    expect(prepared.getPage(0).getSize()).toEqual({ width: 400, height: 500 })
    expect(result.buffer).toEqual(source)
  })
  it('rejects missing, mislabeled and unreadable uploads', async () => {
    await expect(prepareUploadedContract()).rejects.toThrow('Upload a PDF file')
    await expect(prepareUploadedContract({ buffer: Buffer.from('not PDF'), mimetype: 'application/pdf' })).rejects.toThrow()
    await expect(prepareUploadedContract({ buffer: Buffer.from('%PDF-broken'), mimetype: 'application/pdf' })).rejects.toThrow('cannot be read')
  })
})
