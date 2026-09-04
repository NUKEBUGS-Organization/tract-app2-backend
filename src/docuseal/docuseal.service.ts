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

type TemplateParty = {
  name: string
  uuid: string
}

type TemplateInfo = {
  id: number
  name: string
  roles: string[]
  parties: TemplateParty[]
  fieldCount: number
  signatureFieldCount: number
  /** Signature counts keyed by party role name. */
  signaturesByRole: Record<string, number>
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
      submitters?: Array<{ name?: string; uuid?: string }>
      fields?: Array<{ type?: string; name?: string; submitter_uuid?: string }>
    }>(`/api/templates/${templateId}`)

    const submitters = data?.submitters ?? []
    const parties: TemplateParty[] = submitters
      .map((s) => ({
        name: (s.name ?? '').trim(),
        uuid: String(s.uuid ?? ''),
      }))
      .filter((p) => p.name && p.uuid)
    const roles = parties.map((p) => p.name)
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
      parties,
      fieldCount: fields.length,
      signatureFieldCount,
      signaturesByRole,
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
    submitters: Array<DocuSealSubmitter & { uuid?: string }>,
    opts?: { omitValues?: boolean; omitExternalId?: boolean; omitUuid?: boolean },
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
      if (!opts?.omitUuid && s.uuid) {
        next.uuid = s.uuid
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

  /** Attach DocuSeal party UUIDs so create does not depend on role-name matching. */
  private withPartyUuids(
    aligned: DocuSealSubmitter[],
    parties: TemplateParty[],
  ): Array<DocuSealSubmitter & { uuid?: string }> {
    return aligned.map((s, i) => {
      const byName = parties.find(
        (p) => p.name.trim().toLowerCase() === s.role.trim().toLowerCase(),
      )
      const party = byName ?? parties[i]
      return party?.uuid ? { ...s, uuid: party.uuid } : { ...s }
    })
  }

  private maskEmail(email: string): string {
    const [user, domain] = email.split('@')
    if (!domain) return '(invalid)'
    const safeUser = user.length <= 2 ? `${user[0] ?? ''}*` : `${user.slice(0, 2)}***`
    return `${safeUser}@${domain}`
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

    const rolesMissingSignature = template.roles.filter(
      (role) => (template.signaturesByRole[role] ?? 0) < 1,
    )
    if (rolesMissingSignature.length > 0 || template.signatureFieldCount < 2) {
      const byRole = template.roles
        .map((r) => `${r}=${template.signaturesByRole[r] ?? 0}`)
        .join(', ')
      throw new Error(
        `DocuSeal template ${templateId} ("${template.name}") needs a Signature field on BOTH Seller and Buyer ` +
          `(currently: ${byRole || `total signatures=${template.signatureFieldCount}`}). ` +
          `Open https://docu.tractcorp.com/templates/${templateId} → EDIT → select each party → add Signature → Save. ` +
          `Then try "+ ADD RECIPIENTS" once in DocuSeal to verify, then Create Contract again.`,
      )
    }

    const aligned = this.alignSubmitterRoles(submitters, template.roles)
    const withUuids = this.withPartyUuids(aligned, template.parties)
    const sentRoles = withUuids.map((s) => s.role)
    const maskedEmails = withUuids.map((s) => this.maskEmail(s.email)).join(', ')
    const attempts: string[] = []

    const post = async (payload: Record<string, unknown>, label: string) => {
      attempts.push(label)
      this.logger.log(
        `DocuSeal create (${label}) template=${templateId} roles=[${sentRoles.join(', ')}] emails=[${maskedEmails}] uuids=${withUuids.map((s) => Boolean(s.uuid)).join(',')}`,
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
      // 1) Prefer uuid + role (bypasses role-name matching quirks)
      let data = await post(
        {
          template_id: templateId,
          send_email: false,
          submitters: this.normalizeSubmittersForApi(withUuids),
        },
        'uuid-with-values',
      )

      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submitters: this.normalizeSubmittersForApi(withUuids, {
              omitValues: true,
            }),
          },
          'uuid-no-values',
        )
      }

      // 2) Docs minimal: role + email only
      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submitters: withUuids.map((s) => ({
              uuid: s.uuid,
              role: s.role,
              email: (s.email ?? '').trim(),
              name: (s.name ?? '').trim() || (s.email ?? '').trim(),
            })),
          },
          'uuid-minimal',
        )
      }

      // 3) Role-only (no uuid) — App1 shape
      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submitters: this.normalizeSubmittersForApi(withUuids, {
              omitValues: true,
              omitExternalId: true,
              omitUuid: true,
            }),
          },
          'role-only',
        )
      }

      // 4) Singular submission wrapper
      if (this.isEmptySubmittersResponse(data)) {
        data = await post(
          {
            template_id: templateId,
            send_email: false,
            submission: {
              submitters: this.normalizeSubmittersForApi(withUuids, {
                omitValues: true,
                omitExternalId: true,
              }),
            },
          },
          'submission-object',
        )
      }

      if (this.isEmptySubmittersResponse(data)) {
        throw new Error(
          `DocuSeal returned no signers for template id ${template.id} ("${template.name}") ` +
            `roles=[${template.roles.join(', ')}] sent=[${sentRoles.join(', ')}] ` +
            `emails=[${maskedEmails}] attempts=[${attempts.join(' → ')}] ` +
            `fields=${template.fieldCount} signatures=${template.signatureFieldCount}. ` +
            `In DocuSeal: open /templates/${template.id} → try "+ ADD RECIPIENTS" with two emails. ` +
            `If that works, CapRover DOCUSEAL_API_KEY may be a testing key (use production key from Settings → API). ` +
            `Response=${JSON.stringify(data)}`,
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

  /**
   * Admin diagnostic: probe DocuSeal create with disposable emails using CapRover env.
   */
  async probeCreate(): Promise<Record<string, unknown>> {
    const templateId = await this.resolveTemplateId()
    const template = await this.loadTemplateInfo(templateId)
    const stamp = Date.now()
    const probeSubmitters: DocuSealSubmitter[] = [
      {
        role: 'Seller',
        email: `docuseal-probe-seller-${stamp}@example.com`,
        name: 'Probe Seller',
        external_id: `probe:${stamp}:seller`,
      },
      {
        role: 'Buyer',
        email: `docuseal-probe-buyer-${stamp}@example.com`,
        name: 'Probe Buyer',
        external_id: `probe:${stamp}:buyer`,
      },
    ]

    try {
      const submission = await this.createSubmission(probeSubmitters)
      return {
        ok: true,
        template,
        submissionId: submission.id,
        submitterCount: submission.submitters.length,
        submitters: submission.submitters.map((s) => ({
          id: s.id,
          role: s.role,
          email: this.maskEmail(s.email),
          hasEmbed: Boolean(s.embed_src),
        })),
      }
    } catch (err) {
      return {
        ok: false,
        template,
        error: err instanceof Error ? err.message : String(err),
      }
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
