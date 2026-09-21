/**
 * Shape returned to the App2 frontend to prefill Create Listing.
 * Address fields use App2 Listing camelCase.
 *
 * Google Places is the only property-data provider. It resolves and normalizes
 * an address; it does NOT return parcel facts (beds, baths, square footage,
 * year built, valuation, APN). Those are entered manually on the listing form.
 */
export interface PropertyLookupResult {
  propertyAddress: string
  city: string | null
  stateCode: string | null
  zipCode: string | null
  latitude: number | null
  longitude: number | null

  /** Google's single-line rendering of the resolved address. */
  formattedAddress: string

  /** False when Places resolved a route without a house number. */
  streetAddressComplete: boolean

  source: 'google'
}
