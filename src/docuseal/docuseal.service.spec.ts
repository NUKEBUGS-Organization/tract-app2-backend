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
})
