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
  signaturesByRole: Record<string, number>
}

@Injectable()
export class DocuSealService {
  private readonly logger = new Logger(DocuSealService.name)
  private readonly client: AxiosInstance
  private readonly baseURL: string
  /** Numeric template id, or share slug from /d/{slug} links. */
  private readonly templateRef: string
  readonly webhookSecret: string

  constructor(private readonly configService: ConfigService) {
    this.baseURL = this.configService
      .getOrThrow<string>('DOCUSEAL_API_URL')
      .replace(/\/$/, '')
    const apiKey = this.configService.getOrThrow<string>('DOCUSEAL_API_KEY')

    this.templateRef = this.normalizeTemplateRef(
      this.configService.getOrThrow<string>('DOCUSEAL_CONTRACT_TEMPLATE_ID'),
    )
    this.webhookSecret = this.configService.getOrThrow<string>(
      'DOCUSEAL_WEBHOOK_SECRET',
    )

    this.client = axios.create({
      baseURL: this.baseURL,
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
      submitters?: Array<{ name?: string; uuid?: string }>
      fields?: Array<{ type?: string; name?: string; submitter_uuid?: string }>
    }>(`/api/templates/${templateId}`)

    const submitters = data?.submitters ?? []
    const roles = submitters
      .map((s) => (s.name ?? '').trim())
      .filter(Boolean)
    const fields = Array.isArray(data?.fields) ? data.fields : []
    const isSignature = (t: string) =>
      ['signature', 'initials', 'stamp'].includes(t.toLowerCase())
    const signatureFieldCount = fields.filter((f) =>
      isSignature(String(f.type ?? '')),
    ).length

    const signaturesByRole: Record<string, number> = {}
    for (const s of submitters) {
      const role = (s.name ?? '').trim()
      if (!role) continue
      signaturesByRole[role] = fields.filter(
        (f) =>
          f.submitter_uuid === s.uuid && isSignature(String(f.type ?? '')),
      ).length
    }

    this.logger.log(
      `DocuSeal template ${templateId} ("${data?.name ?? '?'}") roles=[${roles.join(', ')}] fields=${fields.length} signatures=${signatureFieldCount} byRole=${JSON.stringify(signaturesByRole)}`,
    )

    return {
      id: Number(data?.id ?? templateId),
      name: String(data?.name ?? ''),
      roles,
      fieldCount: fields.length,
      signatureFieldCount,
      signaturesByRole,
    }
  }

  private alignSubmitterRoles(
    submitters: DocuSealSubmitter[],
    templateRoles: string[],
  ): DocuSealSubmitter[] {
    if (!templateRoles.length) return submitters

    if (submitters.length > templateRoles.length) {
      throw new Error(
        `DocuSeal template only has ${templateRoles.length} party role(s) ` +
          `[${templateRoles.join(', ')}] but TRACT needs ${submitters.length} (Seller + Buyer).`,
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

    return submitters.map((s, i) => {
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
      return { ...s, role: mapped }
    })
  }

  private buildEmbedSrc(slug: string | undefined): string {
    if (!slug) return ''
    return `${this.baseURL}/s/${slug}`
  }

  private mapRawSubmitter(raw: Record<string, unknown>): DocuSealSubmission['submitters'][number] {
    const role = String(raw.role ?? raw.name ?? '')
    const externalId = String(
      raw.external_id ?? raw.application_key ?? '',
    )
    const completed = Boolean(raw.completed_at)
    const status = String(
      raw.status ?? (completed ? 'completed' : 'pending'),
    )
    const embedSrc =
      typeof raw.embed_src === 'string' && raw.embed_src
        ? raw.embed_src
        : this.buildEmbedSrc(
            typeof raw.slug === 'string' ? raw.slug : undefined,
          )

    return {
      id: Number(raw.id),
      role,
      email: String(raw.email ?? ''),
      external_id: externalId,
      embed_src: embedSrc,
      status,
    }
  }

  private parseSubmissionResponse(data: unknown): DocuSealSubmission {
    const submitterArray: Array<Record<string, unknown>> = Array.isArray(data)
      ? data
      : data != null
        ? [data as Record<string, unknown>]
        : []

    if (!submitterArray.length || submitterArray[0]?.submission_id == null) {
      throw new Error(
        `DocuSeal returned unexpected response. Response=${JSON.stringify(data)}`,
      )
    }

    return {
      id: Number(submitterArray[0].submission_id),
      submitters: submitterArray.map((s) => this.mapRawSubmitter(s)),
    }
  }

  async createSubmission(
    submitters: DocuSealSubmitter[],
  ): Promise<DocuSealSubmission> {
    const templateId = await this.resolveTemplateId()
    const template = await this.loadTemplateInfo(templateId)

    if (template.roles.length < 2) {
      throw new Error(
        `DocuSeal template ${templateId} ("${template.name}") only has [${template.roles.join(', ') || '(none)'}]. ` +
          `Need Seller + Buyer.`,
      )
    }

    if (template.fieldCount === 0) {
      throw new Error(
        `DocuSeal template ${templateId} ("${template.name}") has no fields. ` +
          `Open /templates/${templateId} → EDIT and add fields.`,
      )
    }

    const rolesMissingSignature = template.roles.filter(
      (role) => (template.signaturesByRole[role] ?? 0) < 1,
    )
    if (rolesMissingSignature.length > 0) {
      const byRole = template.roles
        .map((r) => `${r}=${template.signaturesByRole[r] ?? 0}`)
        .join(', ')
      throw new Error(
        `DocuSeal template ${templateId} needs a Signature on each party (currently: ${byRole}). ` +
          `Edit https://docu.tractcorp.com/templates/${templateId}`,
      )
    }

    const aligned = this.alignSubmitterRoles(submitters, template.roles)
    const bodySubmitters = aligned.map((s) => {
      const email = (s.email ?? '').trim()
      if (!email || !email.includes('@')) {
        throw new Error(
          `DocuSeal submitter "${s.role}" is missing a valid email (got "${s.email ?? ''}").`,
        )
      }
      const row: Record<string, unknown> = {
        role: s.role,
        email,
        name: (s.name ?? '').trim() || email,
        // This DocuSeal build stores application_key (external_id is ignored).
        application_key: String(s.external_id ?? ''),
        external_id: String(s.external_id ?? ''),
      }
      if (s.values && Object.keys(s.values).length) {
        const values: Record<string, string> = {}
        for (const [k, v] of Object.entries(s.values)) {
          if (v == null) continue
          values[k] = String(v)
        }
        if (Object.keys(values).length) row.values = values
      }
      return row
    })

    // Self-hosted DocuSeal here returns [] for top-level `submitters`.
    // The working shape is `submission: { submitters: [...] }`.
    const payload = {
      template_id: templateId,
      send_email: false,
      submission: { submitters: bodySubmitters },
    }

    this.logger.log(
      `Creating DocuSeal submission template=${templateId} roles=[${aligned.map((s) => s.role).join(', ')}] via submission-object`,
    )

    try {
      const { data, status } = await this.client.post<unknown>(
        '/api/submissions',
        payload,
      )
      this.logger.log(
        `DocuSeal raw response (${status}): ${JSON.stringify(data).slice(0, 800)}`,
      )

      if (Array.isArray(data) && data.length === 0) {
        throw new Error(
          `DocuSeal returned no signers for template ${templateId} ("${template.name}") using submission-object payload. Response=[]`,
        )
      }

      const submission = this.parseSubmissionResponse(data)
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

  /** Admin diagnostic: probe DocuSeal create with disposable emails. */
  async probeCreate(): Promise<Record<string, unknown>> {
    const stamp = Date.now()
    try {
      const submission = await this.createSubmission([
        {
          role: 'Seller',
          email: `docuseal-probe-seller-${stamp}@example.com`,
          name: 'Probe Seller',
          external_id: `probe:${stamp}:lister`,
        },
        {
          role: 'Buyer',
          email: `docuseal-probe-buyer-${stamp}@example.com`,
          name: 'Probe Buyer',
          external_id: `probe:${stamp}:purchaser`,
        },
      ])
      return {
        ok: true,
        submissionId: submission.id,
        submitters: submission.submitters.map((s) => ({
          id: s.id,
          role: s.role,
          external_id: s.external_id,
          hasEmbed: Boolean(s.embed_src),
          embed_src: s.embed_src,
        })),
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async getSubmission(submissionId: string): Promise<DocuSealSubmission> {
    const { data } = await this.client.get<Record<string, unknown>>(
      `/api/submissions/${submissionId}`,
    )

    const rawSubmitters = Array.isArray(data?.submitters)
      ? (data.submitters as Array<Record<string, unknown>>)
      : Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : []

    return {
      id: Number(data?.id ?? submissionId),
      documents: Array.isArray(data?.documents)
        ? (data.documents as Array<{ url?: string }>)
        : undefined,
      audit_log_url:
        typeof data?.audit_log_url === 'string' ? data.audit_log_url : undefined,
      submitters: rawSubmitters.map((s) => this.mapRawSubmitter(s)),
    }
  }

  async getSubmitterEmbedSrc(submitterId: string): Promise<string> {
    const { data } = await this.client.get<Record<string, unknown>>(
      `/api/submitters/${submitterId}`,
    )
    if (typeof data.embed_src === 'string' && data.embed_src) {
      return data.embed_src
    }
    if (typeof data.slug === 'string' && data.slug) {
      return this.buildEmbedSrc(data.slug)
    }
    throw new Error(`DocuSeal submitter ${submitterId} has no embed URL`)
  }
}
