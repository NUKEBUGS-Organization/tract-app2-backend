import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout'
import type { BidSummaryDto } from './dto/bid-summary.dto'

type CacheEntry = {
  data: BidSummaryDto[]
  expiresAt: number
}

type App1Envelope = {
  success?: boolean
  data?: BidSummaryDto[]
}

const CACHE_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 3000

@Injectable()
export class App1BidsService {
  private readonly logger = new Logger(App1BidsService.name)
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly config: ConfigService) {}

  async getBidsForUser(userId: string): Promise<BidSummaryDto[]> {
    const cached = this.cache.get(userId)
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

      const body = (await response.json()) as App1Envelope
      const data = Array.isArray(body?.data) ? body.data : []

      this.cache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`App1 bids fetch error for ${userId}: ${message}`)
      return []
    }
  }
}
