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

type TemplateInfo = {
  id: number
  name: string
  roles: string[]
  fieldCount: number
  signatureFieldCount: number
}

@Injectable()
export class DocuSealService {
  private readonly logger = new Logger(DocuSealService.name)
  private readonly client: AxiosInstance
  /** Numeric template id, or share slug from /d/{slug} links. */
  private readonly templateRef: string
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

  private async listTemplates(): Promise<
    Array<{ id?: number; slug?: string; name?: string }>
  > {
    const { data } = await this.client.get<unknown>('/api/templates')
    return Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown })?.data)
        ? ((data as { data: Array<{ id?: number; slug?: string; name?: string }> })
            .data)
        : []
  }

  private async findTemplateByRef(
    ref: string,
  ): Promise<{ id?: number; slug?: string; name?: string } | undefined> {
    const items = await this.listTemplates()
    return items.find(
      (t) =>
        t.slug === ref ||
        String(t.id) === ref ||
        t.name === 'TRACT_Purchase_Sale_Agreement_END_BUYER' ||
        (typeof t.name === 'string' &&
          t.name.toLowerCase().includes('purchase_sale_agreement_end_buyer')),
    )
  }

  /** Always resolve from env — never cache a fallback id across requests. */
  private async resolveTemplateId(): Promise<number> {
    if (/^\d+$/.test(this.templateRef)) {
      return Number(this.templateRef)
    }

    const match = await this.findTemplateByRef(this.templateRef)
    if (!match?.id) {
      throw new Error(
        `DocuSeal template not found for slug/ref "${this.templateRef}". ` +
          `Set DOCUSEAL_CONTRACT_TEMPLATE_ID to the numeric id from DocuSeal (e.g. 3), or fix DOCUSEAL_API_KEY.`,
      )
    }

    this.logger.log(
      `Resolved DocuSeal template "${match.name ?? match.slug}" → id ${match.id}`,
    )
    return Number(match.id)
  }

  private async loadTemplateInfo(templateId: number): Promise<TemplateInfo> {
    const { data } = await this.client.get<{
      id?: number
      name?: string
      submitters?: Array<{ name?: string }>
      fields?: Array<{ type?: string; name?: string }>
    }>(`/api/templates/${templateId}`)

    const roles = (data?.submitters ?? [])
      .map((s) => (s.name ?? '').trim())
      .filter(Boolean)
    const fields = Array.isArray(data?.fields) ? data.fields : []
    const signatureFieldCount = fields.filter(
      (f) => String(f.type ?? '').toLowerCase() === 'signature',
    ).length

    this.logger.log(
      `DocuSeal template ${templateId} ("${data?.name ?? '?'}") roles=[${roles.join(', ')}] fields=${fields.length} signatures=${signatureFieldCount}`,
    )

    return {
      id: Number(data?.id ?? templateId),
      name: String(data?.name ?? ''),
      roles,
      fieldCount: fields.length,
      signatureFieldCount,
    }
  }

  /**
   * Map our logical Seller/Buyer submitters onto the exact role names on the template.
   */
  private alignSubmitterRoles(
    submitters: DocuSealSubmitter[],
    templateRoles: string[],
  ): DocuSealSubmitter[] {
    if (!templateRoles.length) return submitters

    if (submitters.length > templateRoles.length) {
      throw new Error(
        `DocuSeal template only has ${templateRoles.length} party role(s) ` +
          `[${templateRoles.join(', ')}] but TRACT needs ${submitters.length} (Seller + Buyer). ` +
          `Edit the template and add Seller + Buyer parties.`,
      )
    }

    const normalize = (r: string) => r.trim().toLowerCase()
    const isSellerRole = (r: string) => {
      const n = normalize(r)
      return (
        n === 'seller' ||
        n.startsWith('seller ') ||
        n === 'lister' ||
        n.includes('first party') ||
        n.includes('first submitter')
      )
    }
    const isBuyerRole = (r: string) => {
      const n = normalize(r)
      return (
        n === 'buyer' ||
        n.startsWith('buyer ') ||
        n === 'purchaser' ||
        n.includes('second party') ||
        n.includes('second submitter')
      )
    }

    const aligned = submitters.map((s, i) => {
      let mapped: string | null = null
      if (isSellerRole(s.role) || i === 0) {
        mapped = templateRoles.find(isSellerRole) ?? templateRoles[0] ?? null
      }
      if (!mapped && (isBuyerRole(s.role) || i === 1)) {
        mapped = templateRoles.find(isBuyerRole) ?? templateRoles[1] ?? null
      }
      mapped =
        mapped ??
        templateRoles.find((r) => normalize(r) === normalize(s.role)) ??
        templateRoles[i] ??
        s.role
      if (mapped !== s.role) {
        this.logger.log(`DocuSeal role map: "${s.role}" → "${mapped}"`)
      }
      return { ...s, role: mapped }
    })

    const roles = aligned.map((s) => s.role)
    if (new Set(roles).size !== roles.length) {
      throw new Error(
        `DocuSeal role mapping collapsed to duplicate roles [${roles.join(', ')}]. ` +
          `Template parties are [${templateRoles.join(', ')}].`,
      )
    }

    return aligned
  }

  private normalizeSubmittersForApi(
    submitters: DocuSealSubmitter[],
    opts?: { omitValues?: boolean; omitExternalId?: boolean },
  ): Array<Record<string, unknown>> {
    return submitters.map((s) => {
      const email = (s.email ?? '').trim()
      if (!email || !email.includes('@')) {
        throw new Error(
          `DocuSeal submitter "${s.role}" is missing a valid email (got "${s.email ?? ''}").`,
        )
      }
      const next: Record<string, unknown> = {
        role: s.role,
        email,
        name: (s.name ?? '').trim() || email,
      }
      if (!opts?.omitExternalId && s.external_id) {
        next.external_id = String(s.external_id)
      }
      if (!opts?.omitValues && s.values && Object.keys(s.values).length) {
        const values: Record<string, string> = {}
        for (const [k, v] of Object.entries(s.values)) {
          if (v == null) continue
          values[k] = String(v)
        }
        if (Object.keys(values).length) next.values = values
      }
      return next
    })
  }

  private parseSubmissionResponse(
    data: unknown,
    template: TemplateInfo,
    sentRoles: string[],
  ): DocuSealSubmission {
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
      throw new Error(
        `DocuSeal returned no signers for template id ${template.id} ("${template.name}") ` +
          `roles=[${template.roles.join(', ')}] sent=[${sentRoles.join(', ')}] ` +
          `fields=${template.fieldCount} signatures=${template.signatureFieldCount}. ` +
          `In DocuSeal open /templates/${template.id} → EDIT → place Signature fields on Seller and Buyer, ` +
          `then try "+ ADD RECIPIENTS" manually. Response=${JSON.stringify(data)}`,
      )
    }

    return {
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
  }

  private isEmptySubmittersResponse(data: unknown): boolean {
    return Array.isArray(data) && data.length === 0
  }

  async createSubmission(
    submitters: DocuSealSubmitter[],
  ): Promise<DocuSealSubmission> {
    const templateId = await this.resolveTemplateId()
    const template = await this.loadTemplateInfo(templateId)

    if (template.roles.length < 2) {
      throw new Error(
        `DocuSeal template ${templateId} ("${template.name}") only has [${template.roles.join(', ') || '(none)'}]. ` +
          `Need Seller + Buyer. CapRover DOCUSEAL_CONTRACT_TEMPLATE_ID must be the PSA id (URL /templates/ID).`,
      )
    }

    if (template.fieldCount === 0) {
      throw new Error(
        `DocuSeal template ${templateId} ("${template.name}") has no fields. ` +
          `Open /templates/${templateId} → EDIT → add text + Signature fields for Seller and Buyer.`,
      )
    }

    const aligned = this.alignSubmitterRoles(submitters, template.roles)
    const sentRoles = aligned.map((s) => s.role)

    const post = async (payload: Record<string, unknown>, label: string) => {
      this.logger.log(
        `DocuSeal create (${label}) template=${templateId} roles=[${sentRoles.join(', ')}]`,
      )
      const { data, status } = await this.client.post<unknown>(
        '/api/submissions',
        payload,
      )
      this.logger.log(
        `DocuSeal raw response (${label}, ${status}): ${JSON.stringify(data)}`,
      )
      return data
    }

    try {
      // 1) App1-compatible: top-level submitters + prefill
      let data = await post(
        {
          template_id: templateId,
          send_email: false,
          submitters: this.normalizeSubmittersForApi(aligned),
        },
        'with-values',
      )

      // 2) Same shape, no prefill (bad merge keys can yield [] on some builds)
      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submitters: this.normalizeSubmittersForApi(aligned, {
              omitValues: true,
            }),
          },
          'no-values',
        )
      }

      // 3) Minimal docs shape: role + email only
      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submitters: aligned.map((s) => ({
              role: s.role,
              email: (s.email ?? '').trim(),
            })),
          },
          'minimal',
        )
      }

      // 4) Explicit submissions[] wrapper (some DocuSeal versions prefer this)
      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submissions: [
              {
                submitters: this.normalizeSubmittersForApi(aligned, {
                  omitValues: true,
                  omitExternalId: true,
                }),
              },
            ],
          },
          'submissions-wrapper',
        )
      }

      return this.parseSubmissionResponse(data, template, sentRoles)
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
