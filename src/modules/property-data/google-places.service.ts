import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosInstance } from 'axios'
import {
  GoogleAddressComponent,
  GoogleAutocompleteResponse,
  GooglePlaceDetailsResponse,
} from './interfaces/google-places.interface'

export interface AddressSuggestion {
  place_id: string
  description: string
  main_text: string | null
  secondary_text: string | null
}

export interface ResolvedAddress {
  address1: string
  address2: string
  formatted_address: string
  city: string | null
  stateCode: string | null
  zipCode: string | null
  latitude: number | null
  longitude: number | null
}

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name)
  private readonly client: AxiosInstance
  private readonly apiKeyConfigured: boolean

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY')
    this.apiKeyConfigured = !!apiKey

    this.client = axios.create({
      baseURL: 'https://maps.googleapis.com/maps/api/place',
      params: { key: apiKey ?? '' },
    })
  }

  private assertConfigured() {
    if (!this.apiKeyConfigured) {
      throw new InternalServerErrorException(
        'Address search is not configured (missing GOOGLE_PLACES_API_KEY)',
      )
    }
  }

  async searchAddresses(
    query: string,
    sessionToken?: string,
  ): Promise<AddressSuggestion[]> {
    this.assertConfigured()

    let data: GoogleAutocompleteResponse

    try {
      const response = await this.client.get<GoogleAutocompleteResponse>(
        '/autocomplete/json',
        {
          params: {
            input: query,
            types: 'address',
            components: 'country:us',
            sessiontoken: sessionToken,
          },
        },
      )
      data = response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(
        `Google Places autocomplete failed for "${query}": ${message}`,
        err instanceof Error ? err.stack : undefined,
      )
      throw new BadGatewayException('Address search failed')
    }

    if (data.status === 'ZERO_RESULTS') {
      return []
    }

    if (data.status !== 'OK') {
      this.logger.error(
        `Google Places autocomplete returned ${data.status}: ${data.error_message ?? ''}`,
      )
      throw new BadGatewayException('Address search failed')
    }

    return data.predictions.map((p) => ({
      place_id: p.place_id,
      description: p.description,
      main_text: p.structured_formatting?.main_text ?? null,
      secondary_text: p.structured_formatting?.secondary_text ?? null,
    }))
  }

  async resolveAddress(
    placeId: string,
    sessionToken?: string,
  ): Promise<ResolvedAddress> {
    this.assertConfigured()

    let data: GooglePlaceDetailsResponse

    try {
      const response = await this.client.get<GooglePlaceDetailsResponse>(
        '/details/json',
        {
          params: {
            place_id: placeId,
            fields: 'address_component,formatted_address,geometry',
            sessiontoken: sessionToken,
          },
        },
      )
      data = response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(
        `Google Place Details failed for place_id "${placeId}": ${message}`,
        err instanceof Error ? err.stack : undefined,
      )
      throw new BadGatewayException('Address lookup failed')
    }

    if (data.status !== 'OK' || !data.result) {
      this.logger.error(
        `Google Place Details returned ${data.status}: ${data.error_message ?? ''}`,
      )
      throw new BadGatewayException('Address lookup failed')
    }

    const components = data.result.address_components ?? []
    const find = (type: string) =>
      components.find((c: GoogleAddressComponent) => c.types.includes(type))

    const streetNumber = find('street_number')?.long_name
    const route = find('route')?.long_name
    const locality =
      find('locality')?.long_name ??
      find('sublocality')?.long_name ??
      find('postal_town')?.long_name
    const state = find('administrative_area_level_1')?.short_name
    const postalCode = find('postal_code')?.long_name

    if (!streetNumber || !route) {
      throw new BadRequestException(
        'Please select a specific street address from the list',
      )
    }

    const address1 = `${streetNumber} ${route}`
    const address2 = [locality, [state, postalCode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ')

    return {
      address1,
      address2,
      formatted_address:
        data.result.formatted_address ?? `${address1}, ${address2}`,
      city: locality ?? null,
      stateCode: state ?? null,
      zipCode: postalCode ?? null,
      latitude: data.result.geometry?.location?.lat ?? null,
      longitude: data.result.geometry?.location?.lng ?? null,
    }
  }
}
