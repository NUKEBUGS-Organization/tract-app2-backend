import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosInstance } from 'axios'
import {
  AttomProperty,
  AttomPropertyResponse,
} from './interfaces/attom-property.interface'
import { PropertyLookupResult } from './interfaces/property-lookup-result.interface'
import { GooglePlacesService } from './google-places.service'

@Injectable()
export class PropertyDataService {
  private readonly logger = new Logger(PropertyDataService.name)
  private readonly client: AxiosInstance
  private readonly propertyEndpoint: string
  private readonly apiKeyConfigured: boolean

  constructor(
    private readonly configService: ConfigService,
    private readonly googlePlacesService: GooglePlacesService,
  ) {
    const baseURL =
      this.configService.get<string>('ATTOM_API_URL') ??
      'https://api.gateway.attomdata.com'
    const apiKey = this.configService.get<string>('ATTOM_API_KEY')
    this.apiKeyConfigured = !!apiKey

    this.propertyEndpoint =
      this.configService.get<string>('ATTOM_PROPERTY_ENDPOINT') ??
      '/propertyapi/v1.0.0/property/expandedprofile'

    this.client = axios.create({
      baseURL,
      headers: {
        apikey: apiKey ?? '',
        Accept: 'application/json',
      },
    })
  }

  async searchAddresses(query: string, sessionToken?: string) {
    return this.googlePlacesService.searchAddresses(query, sessionToken)
  }

  async selectProperty(
    placeId: string,
    sessionToken?: string,
  ): Promise<PropertyLookupResult> {
    const resolved = await this.googlePlacesService.resolveAddress(
      placeId,
      sessionToken,
    )

    const result = await this.lookupByAddress(
      resolved.address1,
      resolved.address2,
    )

    return {
      ...result,
      propertyAddress: resolved.address1 || result.propertyAddress,
      city: resolved.city ?? result.city,
      stateCode: resolved.stateCode ?? result.stateCode,
      zipCode: resolved.zipCode ?? result.zipCode,
      latitude: resolved.latitude ?? result.latitude,
      longitude: resolved.longitude ?? result.longitude,
    }
  }

  async lookupByAddress(
    address1: string,
    address2: string,
  ): Promise<PropertyLookupResult> {
    if (!this.apiKeyConfigured) {
      throw new InternalServerErrorException(
        'Property data lookup is not configured (missing ATTOM_API_KEY)',
      )
    }

    let data: AttomPropertyResponse

    try {
      const response = await this.client.get<AttomPropertyResponse>(
        this.propertyEndpoint,
        { params: { address1, address2 } },
      )
      data = response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        const body = err.response.data as AttomPropertyResponse | undefined
        this.logger.warn(
          `ATTOM has no property record for "${address1}, ${address2}" (${body?.status?.msg ?? 'no match'})`,
        )
        throw new NotFoundException(
          'No property record found for that address',
        )
      }

      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(
        `ATTOM lookup failed for "${address1}, ${address2}": ${message}`,
        err instanceof Error ? err.stack : undefined,
      )
      throw new BadGatewayException(
        'Property data lookup failed. Please enter the details manually.',
      )
    }

    const property = data.property?.[0]

    if (!property) {
      throw new NotFoundException('No property record found for that address')
    }

    return this.mapToLookupResult(address1, address2, property)
  }

  private mapToLookupResult(
    address1: string,
    address2: string,
    property: AttomProperty,
  ): PropertyLookupResult {
    const city =
      property.address?.locality?.trim() ||
      this.deriveCityFromAddress2(address2) ||
      this.deriveCityFromOneLine(property.address?.oneLine) ||
      null

    const street =
      property.address?.line1?.trim() ||
      address1.trim() ||
      property.address?.oneLine?.split(',')[0]?.trim() ||
      ''

    return {
      propertyAddress: street,
      city,
      stateCode: property.address?.countrySubd?.trim().toUpperCase() || null,
      zipCode: property.address?.postal1?.trim() || null,

      suggestedPrice:
        property.avm?.amount?.value ??
        property.assessment?.market?.mktTtlValue ??
        null,
      yearBuilt: property.summary?.yearBuilt ?? null,
      zoning: property.lot?.zoningType ?? null,
      unitCount: property.summary?.unitsCount ?? null,
      propertyTypeHint:
        property.summary?.propType ??
        property.summary?.propertyType ??
        property.summary?.propLandUse ??
        null,

      bedrooms: property.building?.rooms?.beds ?? null,
      bathrooms: property.building?.rooms?.bathsTotal ?? null,
      squareFootage:
        property.building?.size?.livingSize ??
        property.building?.size?.universalSize ??
        null,
      lotSizeAcres: property.lot?.lotSize1 ?? null,
      latitude: property.location?.latitude
        ? Number(property.location.latitude)
        : null,
      longitude: property.location?.longitude
        ? Number(property.location.longitude)
        : null,
      countyFips: property.identifier?.fips ?? null,
      apn: property.identifier?.apn ?? null,
      lastSalePrice: property.sale?.amount?.saleAmt ?? null,
      lastSaleDate: property.sale?.saleSearchDate ?? null,

      source: 'attom',
    }
  }

  /** address2 is typically "City, ST ZIP" from Google Places resolve. */
  private deriveCityFromAddress2(address2: string): string | null {
    const first = address2.split(',')[0]?.trim()
    return first || null
  }

  private deriveCityFromOneLine(oneLine?: string): string | null {
    if (!oneLine) return null
    // "123 Main St, Austin, TX 78701" → Austin
    const parts = oneLine.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 3) return parts[1]
    return null
  }
}
