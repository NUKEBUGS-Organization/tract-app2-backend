import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosInstance } from 'axios'

export interface DocuSealSubmitter {
  role: string
  email: string
  name: string
  external_id: string
  values?: Record<string, string | number>
}

export interface DocuSealSubmission {
  id: number
  documents?: Array<{
    url?: string
  }>
  audit_log_url?: string
  submitters: Array<{
    id: number
    role: string
    email: string
    external_id: string
    embed_src: string
    status: string
  }>
}

@Injectable()
export class DocuSealService {
  private readonly logger = new Logger(DocuSealService.name)
  private readonly client: AxiosInstance
  private readonly templateId: string
  readonly webhookSecret: string

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.getOrThrow<string>('DOCUSEAL_API_URL')
    const apiKey = this.configService.getOrThrow<string>('DOCUSEAL_API_KEY')

    this.templateId = this.configService.getOrThrow<string>(
      'DOCUSEAL_CONTRACT_TEMPLATE_ID',
    )
    this.webhookSecret = this.configService.getOrThrow<string>(
      'DOCUSEAL_WEBHOOK_SECRET',
    )

    this.client = axios.create({
      baseURL,
      headers: {
        'X-Auth-Token': apiKey,
        'Content-Type': 'application/json',
      },
    })
  }

  async createSubmission(
    submitters: DocuSealSubmitter[],
  ): Promise<DocuSealSubmission> {
    const payload = {
      template_id: Number(this.templateId),
      send_email: false,
      submitters,
    }

    this.logger.log(
      `Creating DocuSeal submission for template ${this.templateId}`,
    )

    try {
      const { data } = await this.client.post<unknown>('/api/submissions', payload)

      this.logger.log(`DocuSeal raw response: ${JSON.stringify(data)}`)

      const submitterArray: Array<{
        id: number
        submission_id: number
        role: string
        email: string
        external_id: string
        embed_src: string
        status: string
      }> = Array.isArray(data) ? data : [data as never]

      if (!submitterArray.length || !submitterArray[0]?.submission_id) {
        throw new Error(
          `DocuSeal returned unexpected response. Response=${JSON.stringify(data)}`,
        )
      }

      const submission: DocuSealSubmission = {
        id: submitterArray[0].submission_id,
        submitters: submitterArray.map((s) => ({
          id: s.id,
          role: s.role,
          email: s.email,
          external_id: s.external_id,
          embed_src: s.embed_src,
          status: s.status,
        })),
      }

      this.logger.log(
        `DocuSeal submission created: ${submission.id} with ${submission.submitters.length} submitters`,
      )
      return submission
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const details = err.response?.data
        const detailText =
          typeof details === 'string'
            ? details
            : details != null
              ? JSON.stringify(details)
              : err.message
        this.logger.error(
          `DocuSeal /api/submissions failed (${err.response?.status}): ${detailText}`,
        )
        throw new Error(
          `DocuSeal ${err.response?.status ?? 'error'}: ${detailText}`,
        )
      }
      throw err
    }
  }

  async getSubmission(submissionId: string): Promise<DocuSealSubmission> {
    const { data } = await this.client.get<DocuSealSubmission>(
      `/api/submissions/${submissionId}`,
    )
    return data
  }

  async getSubmitterEmbedSrc(submitterId: string): Promise<string> {
    const { data } = await this.client.get<{ embed_src: string }>(
      `/api/submitters/${submitterId}`,
    )
    return data.embed_src
  }
}
