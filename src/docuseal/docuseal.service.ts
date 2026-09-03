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
  /** Numeric template id, or share slug from /d/{slug} links. */
  private readonly templateRef: string
  private resolvedTemplateId: number | null = null
  readonly webhookSecret: string

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.getOrThrow<string>('DOCUSEAL_API_URL')
    const apiKey = this.configService.getOrThrow<string>('DOCUSEAL_API_KEY')

    this.templateRef = this.normalizeTemplateRef(
      this.configService.getOrThrow<string>('DOCUSEAL_CONTRACT_TEMPLATE_ID'),
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

  /** Accepts numeric id, share slug, or full https://docu.../d/{slug} URL. */
  private normalizeTemplateRef(raw: string): string {
    const value = raw.trim()
    const fromUrl = value.match(/\/d\/([A-Za-z0-9_-]+)/)
    if (fromUrl) return fromUrl[1]
    return value.replace(/^\/d\//, '')
  }

  private async resolveTemplateId(): Promise<number> {
    if (this.resolvedTemplateId != null) return this.resolvedTemplateId

    if (/^\d+$/.test(this.templateRef)) {
      this.resolvedTemplateId = Number(this.templateRef)
      return this.resolvedTemplateId
    }

    this.logger.log(`Resolving DocuSeal template slug "${this.templateRef}" to id`)

    const { data } = await this.client.get<unknown>('/api/templates')
    const items: Array<{ id?: number; slug?: string; name?: string }> = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown })?.data)
        ? ((data as { data: Array<{ id?: number; slug?: string; name?: string }> }).data)
        : []

    const match = items.find(
      (t) =>
        t.slug === this.templateRef ||
        t.name === 'TRACT_Purchase_Sale_Agreement_END_BUYER' ||
        (typeof t.name === 'string' &&
          t.name.toLowerCase().includes('purchase_sale_agreement_end_buyer')),
    )

    if (!match?.id) {
      throw new Error(
        `DocuSeal template not found for slug/ref "${this.templateRef}". ` +
          `Set DOCUSEAL_CONTRACT_TEMPLATE_ID to the numeric id from DocuSeal, or fix DOCUSEAL_API_KEY.`,
      )
    }

    this.resolvedTemplateId = Number(match.id)
    this.logger.log(
      `Resolved DocuSeal template "${match.name ?? match.slug}" → id ${this.resolvedTemplateId}`,
    )
    return this.resolvedTemplateId
  }

  /** Role names defined on the DocuSeal template (order preserved). */
  private async getTemplateRoleNames(templateId: number): Promise<string[]> {
    try {
      const { data } = await this.client.get<{
        submitters?: Array<{ name?: string }>
      }>(`/api/templates/${templateId}`)
      const roles = (data?.submitters ?? [])
        .map((s) => (s.name ?? '').trim())
        .filter(Boolean)
      if (roles.length) {
        this.logger.log(`DocuSeal template ${templateId} roles: ${roles.join(', ')}`)
      }
      return roles
    } catch (err) {
      this.logger.warn(
        `Could not load DocuSeal template ${templateId} roles: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return []
    }
  }

  /**
   * Map our logical Seller/Buyer (or Lister/Purchaser) submitters onto the
   * exact role names on the template. DocuSeal returns [] when roles don't match.
   */
  private alignSubmitterRoles(
    submitters: DocuSealSubmitter[],
    templateRoles: string[],
  ): DocuSealSubmitter[] {
    if (!templateRoles.length) return submitters

    if (submitters.length > templateRoles.length) {
      throw new Error(
        `DocuSeal template only has ${templateRoles.length} party role(s) ` +
          `[${templateRoles.join(', ')}] but TRACT needs ${submitters.length} ` +
          `(Seller + Buyer). Open DocuSeal → template id ${this.resolvedTemplateId ?? this.templateRef} → ` +
          `add a second party named Seller and Buyer (or rename First Submitter → Seller and add Buyer).`,
      )
    }

    const normalize = (r: string) => r.trim().toLowerCase()
    const isSellerRole = (r: string) => {
      const n = normalize(r)
      return (
        n === 'seller' ||
        n.startsWith('seller ') ||
        n.startsWith('seller(') ||
        n === 'lister' ||
        n.startsWith('lister ') ||
        n.includes('first party') ||
        n.includes('first submitter')
      )
    }
    const isBuyerRole = (r: string) => {
      const n = normalize(r)
      return (
        n === 'buyer' ||
        n.startsWith('buyer ') ||
        n.startsWith('buyer(') ||
        n === 'purchaser' ||
        n.startsWith('purchaser ') ||
        n.includes('second party') ||
        n.includes('second submitter')
      )
    }

    const findTemplateRole = (
      match: (r: string) => boolean,
      fallbackIndex: number,
    ): string | null => {
      const byName = templateRoles.find(match)
      if (byName) return byName
      return templateRoles[fallbackIndex] ?? null
    }

    return submitters.map((s, i) => {
      const n = normalize(s.role)
      let mapped: string | null = null
      if (isSellerRole(s.role) || n === 'seller' || n === 'lister' || i === 0) {
        mapped = findTemplateRole(isSellerRole, 0)
      }
      if (!mapped && (isBuyerRole(s.role) || n === 'buyer' || n === 'purchaser' || i === 1)) {
        mapped = findTemplateRole(isBuyerRole, 1)
      }
      if (!mapped) {
        mapped =
          templateRoles.find((r) => normalize(r) === n) ?? templateRoles[i] ?? s.role
      }
      if (mapped !== s.role) {
        this.logger.log(`DocuSeal role map: "${s.role}" → "${mapped}"`)
      }
      return { ...s, role: mapped }
    })
  }

  async createSubmission(
    submitters: DocuSealSubmitter[],
  ): Promise<DocuSealSubmission> {
    const templateId = await this.resolveTemplateId()
    const templateRoles = await this.getTemplateRoleNames(templateId)
    const aligned = this.alignSubmitterRoles(submitters, templateRoles)

    const payload = {
      template_id: templateId,
      send_email: false,
      submitters: aligned,
    }

    this.logger.log(
      `Creating DocuSeal submission for template ${templateId} roles=[${aligned
        .map((s) => s.role)
        .join(', ')}]`,
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
      }> = Array.isArray(data) ? data : data != null ? [data as never] : []

      if (!submitterArray.length || !submitterArray[0]?.submission_id) {
        const rolesHint = templateRoles.length
          ? ` Template roles are [${templateRoles.join(', ')}]; sent [${aligned
              .map((s) => s.role)
              .join(', ')}].`
          : ' Check DOCUSEAL_CONTRACT_TEMPLATE_ID and that the template has Seller/Buyer (or matching) party roles.'
        throw new Error(
          `DocuSeal returned unexpected response.${rolesHint} Response=${JSON.stringify(data)}`,
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
    const { data } = await this.client.get<Record<string, unknown>>(
      `/api/submissions/${submissionId}`,
    )

    const rawSubmitters = Array.isArray(data?.submitters)
      ? data.submitters
      : Array.isArray(data)
        ? data
        : []

    return {
      id: Number(data?.id ?? submissionId),
      documents: Array.isArray(data?.documents)
        ? (data.documents as Array<{ url?: string }>)
        : undefined,
      audit_log_url:
        typeof data?.audit_log_url === 'string' ? data.audit_log_url : undefined,
      submitters: rawSubmitters.map((s: any) => ({
        id: Number(s.id),
        role: String(s.role ?? ''),
        email: String(s.email ?? ''),
        external_id: String(s.external_id ?? ''),
        embed_src: String(s.embed_src ?? ''),
        status: String(s.status ?? ''),
      })),
    }
  }

  async getSubmitterEmbedSrc(submitterId: string): Promise<string> {
    const { data } = await this.client.get<{ embed_src: string }>(
      `/api/submitters/${submitterId}`,
    )
    return data.embed_src
  }
}
