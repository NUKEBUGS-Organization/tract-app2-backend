import { Injectable, NotFoundException } from '@nestjs/common'
import { PropertyLookupResult } from './interfaces/property-lookup-result.interface'
import { GooglePlacesService, ResolvedAddress } from './google-places.service'

/**
 * Google Places is the sole property-data provider.
 *
 * It resolves addresses only. Parcel facts that the previous ATTOM integration
 * supplied (beds, baths, square footage, year built, valuation, zoning, APN,
 * last sale) have no Places equivalent and are entered manually on the listing
 * form, so this service returns address fields and nothing else.
 */
@Injectable()
export class PropertyDataService {
  constructor(private readonly googlePlacesService: GooglePlacesService) {}

  async searchAddresses(query: string, sessionToken?: string) {
    return this.googlePlacesService.searchAddresses(query, sessionToken)
  }

  async selectProperty(
    placeId: string,
    sessionToken?: string,
    selectedStreet?: string,
  ): Promise<PropertyLookupResult> {
    const resolved = await this.googlePlacesService.resolveAddress(
      placeId,
      sessionToken,
      selectedStreet,
    )
    return this.toLookupResult(resolved)
  }

  /** Direct lookup by a known address, with no preceding typeahead step. */
  async lookupByAddress(
    address1: string,
    address2: string,
  ): Promise<PropertyLookupResult> {
    const full = [address1.trim(), address2.trim()].filter(Boolean).join(', ')
    const resolved = await this.googlePlacesService.findAddress(full)
    if (!resolved) {
      throw new NotFoundException(
        'No matching address was found. Please check the address or enter the details manually.',
      )
    }
    return this.toLookupResult(resolved)
  }

  private toLookupResult(resolved: ResolvedAddress): PropertyLookupResult {
    return {
      propertyAddress: resolved.address1,
      city: resolved.city,
      stateCode: resolved.stateCode,
      zipCode: resolved.zipCode,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      formattedAddress: resolved.formatted_address,
      streetAddressComplete: resolved.streetAddressComplete !== false,
      source: 'google',
    }
  }
}
