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

    const match = await this.findTemplateByRef(this.templateRef)
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

  private async listTemplates(): Promise<
    Array<{ id?: number; slug?: string; name?: string }>
  > {
    const { data } = await this.client.get<unknown>('/api/templates')
    return Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown })?.data)
        ? ((data as { data: Array<{ id?: number; slug?: string; name?: string }> }).data)
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

  private isPsaTemplateName(name: string): boolean {
    const n = name.toLowerCase()
    return (
      name === 'TRACT_Purchase_Sale_Agreement_END_BUYER' ||
      n.includes('purchase_sale_agreement') ||
      n.includes('purchase and sale')
    )
  }

  /** Find another 2-party PSA template (skip `exceptId`). */
  private async findAlternatePsaTemplate(
    exceptId: number,
  ): Promise<{ templateId: number; roles: string[]; name: string } | null> {
    try {
      const items = await this.listTemplates()
      for (const t of items) {
        if (!t.id || Number(t.id) === exceptId) continue
        const name = String(t.name ?? '')
        const looksLikePsa = this.isPsaTemplateName(name)
        if (!looksLikePsa && items.length > 8) continue

        const roles = await this.getTemplateRoleNames(Number(t.id))
        const hasSeller = roles.some((r) => /^seller\b/i.test(r.trim()))
        const hasBuyer = roles.some((r) => /^buyer\b/i.test(r.trim()))
        if (roles.length >= 2 && (hasSeller || hasBuyer || looksLikePsa)) {
          return { templateId: Number(t.id), roles, name }
        }
      }
    } catch (err) {
      this.logger.warn(
        `DocuSeal template fallback search failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    return null
  }

  /**
   * If configured template id has &lt; 2 parties (stale "First Submitter" only),
   * prefer the PSA template that already has Seller + Buyer.
   */
  private async resolveUsableTemplateId(
    preferredId: number,
    preferredRoles: string[],
  ): Promise<{ templateId: number; roles: string[] }> {
    if (preferredRoles.length >= 2) {
      return { templateId: preferredId, roles: preferredRoles }
    }

    this.logger.warn(
      `DocuSeal template ${preferredId} has only [${preferredRoles.join(', ') || '(none)'}] — searching for a 2-party PSA template`,
    )

    const alt = await this.findAlternatePsaTemplate(preferredId)
    if (alt) {
      this.logger.log(
        `Using DocuSeal template ${alt.templateId} ("${alt.name}") with roles [${alt.roles.join(', ')}] instead of ${preferredId}`,
      )
      this.resolvedTemplateId = alt.templateId
      return { templateId: alt.templateId, roles: alt.roles }
    }

    return { templateId: preferredId, roles: preferredRoles }
  }

  /** Role names defined on the DocuSeal template (order preserved). */
  private async getTemplateRoleNames(templateId: number): Promise<string[]> {
    try {
      const { data } = await this.client.get<{
        id?: number
        name?: string
        submitters?: Array<{ name?: string }>
      }>(`/api/templates/${templateId}`)
      const roles = (data?.submitters ?? [])
        .map((s) => (s.name ?? '').trim())
        .filter(Boolean)
      if (roles.length) {
        this.logger.log(
          `DocuSeal template ${templateId} ("${data?.name ?? '?'}") roles: ${roles.join(', ')}`,
        )
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
        `DocuSeal template id ${this.resolvedTemplateId ?? this.templateRef} only has ${templateRoles.length} party role(s) ` +
          `[${templateRoles.join(', ')}] but TRACT needs ${submitters.length} (Seller + Buyer). ` +
          `In DocuSeal, open the template you edited (check the URL for /templates/ID) — CapRover DOCUSEAL_CONTRACT_TEMPLATE_ID may still point at an old template that only has "First Submitter". ` +
          `Set DOCUSEAL_CONTRACT_TEMPLATE_ID to that template's numeric id, or add Seller + Buyer on template ${this.templateRef}.`,
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

  private normalizeSubmittersForApi(
    submitters: DocuSealSubmitter[],
    opts?: { omitValues?: boolean },
  ): DocuSealSubmitter[] {
    return submitters.map((s) => {
      const email = (s.email ?? '').trim()
      if (!email || !email.includes('@')) {
        throw new Error(
          `DocuSeal submitter "${s.role}" is missing a valid email (got "${s.email ?? ''}").`,
        )
      }
      const next: DocuSealSubmitter = {
        role: s.role,
        email,
        name: (s.name ?? '').trim() || email,
        external_id: String(s.external_id ?? ''),
      }
      if (!opts?.omitValues && s.values && Object.keys(s.values).length) {
        const values: Record<string, string | number> = {}
        for (const [k, v] of Object.entries(s.values)) {
          if (v == null) continue
          // DocuSeal field values are safest as strings.
          values[k] = typeof v === 'number' ? String(v) : String(v)
        }
        if (Object.keys(values).length) next.values = values
      }
      return next
    })
  }

  private parseSubmissionResponse(
    data: unknown,
    templateRoles: string[],
    aligned: DocuSealSubmitter[],
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
      const rolesHint = templateRoles.length
        ? ` Template roles are [${templateRoles.join(', ')}]; sent [${aligned
            .map((s) => s.role)
            .join(', ')}].`
        : ' Check DOCUSEAL_CONTRACT_TEMPLATE_ID and that the template has Seller/Buyer (or matching) party roles.'
      throw new Error(
        `DocuSeal returned unexpected response.${rolesHint} Response=${JSON.stringify(data)}`,
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

  async createSubmission(
    submitters: DocuSealSubmitter[],
  ): Promise<DocuSealSubmission> {
    const preferredId = await this.resolveTemplateId()
    const preferredRoles = await this.getTemplateRoleNames(preferredId)
    let { templateId, roles: templateRoles } = await this.resolveUsableTemplateId(
      preferredId,
      preferredRoles,
    )

    const post = async (
      tid: number,
      bodySubmitters: DocuSealSubmitter[],
    ): Promise<unknown> => {
      const payload = {
        template_id: Number(tid),
        send_email: false,
        submitters: bodySubmitters,
      }
      this.logger.log(
        `Creating DocuSeal submission for template ${tid} roles=[${bodySubmitters
          .map((s) => s.role)
          .join(', ')}] values=${bodySubmitters.some((s) => s.values) ? 'yes' : 'no'}`,
      )
      const { data, status } = await this.client.post<unknown>('/api/submissions', payload)
      this.logger.log(`DocuSeal raw response (${status}): ${JSON.stringify(data)}`)
      return data
    }

    const attempt = async (tid: number, roles: string[]) => {
      const aligned = this.alignSubmitterRoles(submitters, roles)
      let data = await post(tid, this.normalizeSubmittersForApi(aligned))

      // Some self-hosted builds return [] on bad merge-field keys — retry bare.
      if (Array.isArray(data) && data.length === 0) {
        this.logger.warn(
          `DocuSeal template ${tid} returned []; retrying without prefill values`,
        )
        data = await post(
          tid,
          this.normalizeSubmittersForApi(aligned, { omitValues: true }),
        )
      }

      return { data, aligned, roles }
    }

    try {
      let result = await attempt(templateId, templateRoles)

      // Roles can match on a stale CapRover template id while create still
      // returns []. Fall back to the named PSA template once.
      if (Array.isArray(result.data) && result.data.length === 0) {
        const alt = await this.findAlternatePsaTemplate(templateId)
        if (alt) {
          this.logger.warn(
            `DocuSeal template ${templateId} still returned []; trying PSA template ${alt.templateId} ("${alt.name}")`,
          )
          this.resolvedTemplateId = alt.templateId
          templateId = alt.templateId
          templateRoles = alt.roles
          result = await attempt(alt.templateId, alt.roles)
        }
      }

      if (Array.isArray(result.data) && result.data.length === 0) {
        throw new Error(
          `DocuSeal returned no signers for template id ${templateId} ` +
            `(roles [${templateRoles.join(', ')}]). ` +
            `Open DocuSeal → that template → confirm it has Signature fields on Seller and Buyer, ` +
            `then set CapRover DOCUSEAL_CONTRACT_TEMPLATE_ID to the PSA template's numeric id from the URL /templates/ID ` +
            `(not a renamed "App1 Contract Template"). Response=[]`,
        )
      }

      const submission = this.parseSubmissionResponse(
        result.data,
        result.roles,
        result.aligned,
      )
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
