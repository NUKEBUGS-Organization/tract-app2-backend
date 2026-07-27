import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout'
import type { BidSummaryDto } from './dto/bid-summary.dto'
import type { ClosedDealSummaryDto } from './dto/closed-deal-summary.dto'

type CacheEntry<T> = {
  data: T
  expiresAt: number
}

type App1Envelope<T> = {
  success?: boolean
  data?: T
}

export type App1DealStatusDto = {
  dealId: string
  status: string
}

const CACHE_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 3000
const FALLTHROUGH_STATUSES = new Set(['cancelled', 'backup_activated'])

@Injectable()
export class App1BidsService {
  private readonly logger = new Logger(App1BidsService.name)
  private readonly bidsCache = new Map<string, CacheEntry<BidSummaryDto[]>>()
  private readonly closedDealsCache = new Map<string, CacheEntry<ClosedDealSummaryDto[]>>()
  private readonly dealStatusCache = new Map<string, CacheEntry<App1DealStatusDto | null>>()

  constructor(private readonly config: ConfigService) {}

  isSourceDealFellThrough(status: string | null | undefined): boolean {
    return FALLTHROUGH_STATUSES.has(String(status ?? '').toLowerCase())
  }

  async getDealStatus(dealId: string): Promise<App1DealStatusDto | null> {
    const id = (dealId ?? '').trim()
    if (!id) return null

    const cached = this.dealStatusCache.get(id)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }

    const baseUrl = (this.config.get<string>('APP1_INTERNAL_URL') ?? '').replace(/\/$/, '')
    const key = this.config.get<string>('INTERNAL_SERVICE_KEY') ?? ''

    if (!baseUrl || !key) {
      this.logger.warn('APP1_INTERNAL_URL or INTERNAL_SERVICE_KEY not configured — returning null')
      return null
    }

    try {
      const url = `${baseUrl}/api/v1/internal/deals/${encodeURIComponent(id)}/status`
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Internal-Key': key,
          },
        },
        FETCH_TIMEOUT_MS,
      )

      if (!response.ok) {
        this.logger.warn(`App1 deal status fetch failed for ${id}: HTTP ${response.status}`)
        this.dealStatusCache.set(id, { data: null, expiresAt: Date.now() + CACHE_TTL_MS })
        return null
      }

      const body = (await response.json()) as App1Envelope<App1DealStatusDto> | App1DealStatusDto
      const data =
        body &&
        typeof body === 'object' &&
        'data' in body &&
        body.data &&
        typeof body.data === 'object'
          ? body.data
          : body && typeof body === 'object' && 'status' in body
            ? (body as App1DealStatusDto)
            : null

      if (!data?.status) {
        this.logger.warn(`App1 deal status returned unexpected payload for ${id}`)
        this.dealStatusCache.set(id, { data: null, expiresAt: Date.now() + CACHE_TTL_MS })
        return null
      }

      const normalized: App1DealStatusDto = {
        dealId: String(data.dealId ?? id),
        status: String(data.status),
      }
      this.dealStatusCache.set(id, { data: normalized, expiresAt: Date.now() + CACHE_TTL_MS })
      return normalized
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`App1 deal status fetch error for ${id}: ${message}`)
      return null
    }
  }

  async getBidsForUser(userId: string): Promise<BidSummaryDto[]> {
    const cached = this.bidsCache.get(userId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }

    const baseUrl = (this.config.get<string>('APP1_INTERNAL_URL') ?? '').replace(/\/$/, '')
    const key = this.config.get<string>('INTERNAL_SERVICE_KEY') ?? ''

    if (!baseUrl || !key) {
      this.logger.warn('APP1_INTERNAL_URL or INTERNAL_SERVICE_KEY not configured — returning []')
      return []
    }

    try {
      const url = `${baseUrl}/api/v1/internal/bids/by-user/${encodeURIComponent(userId)}`
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Internal-Key': key,
          },
        },
        FETCH_TIMEOUT_MS,
      )

      if (!response.ok) {
        this.logger.warn(`App1 bids fetch failed for ${userId}: HTTP ${response.status}`)
        return []
      }

      const body = (await response.json()) as App1Envelope<BidSummaryDto[]>
      const data = Array.isArray(body?.data) ? body.data : []

      this.bidsCache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`App1 bids fetch error for ${userId}: ${message}`)
      return []
    }
  }

  async getClosedDealsForUser(userId: string): Promise<ClosedDealSummaryDto[]> {
    const cached = this.closedDealsCache.get(userId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }

    const baseUrl = (this.config.get<string>('APP1_INTERNAL_URL') ?? '').replace(/\/$/, '')
    const key = this.config.get<string>('INTERNAL_SERVICE_KEY') ?? ''

    if (!baseUrl || !key) {
      this.logger.warn('APP1_INTERNAL_URL or INTERNAL_SERVICE_KEY not configured — returning []')
      return []
    }

    try {
      const url = `${baseUrl}/api/v1/internal/deals/closed-by-user/${encodeURIComponent(userId)}`
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Internal-Key': key,
          },
        },
        FETCH_TIMEOUT_MS,
      )

      if (!response.ok) {
        this.logger.warn(`App1 closed deals fetch failed for ${userId}: HTTP ${response.status}`)
        return []
      }

      const body = (await response.json()) as App1Envelope<ClosedDealSummaryDto[]>
      const data = Array.isArray(body?.data) ? body.data : []

      this.closedDealsCache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`App1 closed deals fetch error for ${userId}: ${message}`)
      return []
    }
  }
}
