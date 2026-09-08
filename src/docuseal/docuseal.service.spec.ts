import { ConfigService } from '@nestjs/config'
import { AxiosError } from 'axios'
import { DocuSealService } from './docuseal.service'

describe('DocuSealService uploaded PDF templates', () => {
  function service() {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          DOCUSEAL_API_URL: 'https://docu.example.test',
          DOCUSEAL_API_KEY: 'test-key',
          DOCUSEAL_CONTRACT_TEMPLATE_ID: '3',
          DOCUSEAL_WEBHOOK_SECRET: 'secret',
        }
        return values[key]
      }),
    } as unknown as ConfigService
    return new DocuSealService(config)
  }

  it('falls back to the public DocuSeal PDF template path when the self-hosted API prefix is unavailable', async () => {
    const docuseal = service() as unknown as { createUploadedTemplate: DocuSealService['createUploadedTemplate']; client: { post: jest.Mock } }
    const notFound = new AxiosError('not found') as AxiosError
    Object.defineProperty(notFound, 'response', { value: { status: 404, data: { error: 'not found' } } })
    docuseal.client.post = jest.fn()
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ data: { id: 77 } })

    await expect(docuseal.createUploadedTemplate(Buffer.from('%PDF'), 'contract-1', [])).resolves.toBe(77)

    expect(docuseal.client.post.mock.calls.map(call => call[0])).toEqual(['/api/templates/pdf', '/templates/pdf'])
  })

  it('creates a one-off PDF submission for uploaded agreements using the documented PDF path fallback', async () => {
    const docuseal = service() as unknown as { createPdfSubmission: DocuSealService['createPdfSubmission']; client: { post: jest.Mock } }
    const notFound = new AxiosError('not found') as AxiosError
    Object.defineProperty(notFound, 'response', { value: { status: 404, data: { error: 'not found' } } })
    docuseal.client.post = jest.fn()
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ data: [
        { id: 1, submission_id: 88, role: 'Seller', email: 'seller@example.test', application_key: 'contract-1:lister', slug: 'seller-link', status: 'pending' },
        { id: 2, submission_id: 88, role: 'Buyer', email: 'buyer@example.test', application_key: 'contract-1:purchaser', slug: 'buyer-link', status: 'pending' },
      ] })

    const fields = [{ name: 'SellerSignature', type: 'signature', role: 'Seller', required: true, areas: [{ page: 2, x: 55, y: 269, w: 367, h: 59 }] }]
    const submission = await docuseal.createPdfSubmission(Buffer.from('%PDF'), 'contract-1', fields, [
      { role: 'Seller', email: 'seller@example.test', name: 'Seller One', external_id: 'contract-1:lister', values: { SellerName: 'Seller One' } },
      { role: 'Buyer', email: 'buyer@example.test', name: 'Buyer One', external_id: 'contract-1:purchaser', values: { BuyerName: 'Buyer One' } },
    ])

    expect(submission.id).toBe(88)
    expect(submission.submitters.map(s => s.embed_src)).toEqual([
      'https://docu.example.test/s/seller-link',
      'https://docu.example.test/s/buyer-link',
    ])
    expect(docuseal.client.post.mock.calls.map(call => call[0])).toEqual(['/api/submissions/pdf', '/submissions/pdf'])
    const payload = docuseal.client.post.mock.calls[1][1]
    expect(payload).toMatchObject({
      name: 'Uploaded agreement contract-1',
      send_email: false,
      order: 'preserved',
      documents: [{ name: 'Agreement', file: Buffer.from('%PDF').toString('base64'), fields }],
      submitters: [
        { role: 'Seller', email: 'seller@example.test', name: 'Seller One', application_key: 'contract-1:lister', values: { SellerName: 'Seller One' } },
        { role: 'Buyer', email: 'buyer@example.test', name: 'Buyer One', application_key: 'contract-1:purchaser', values: { BuyerName: 'Buyer One' } },
      ],
    })
  })
})
