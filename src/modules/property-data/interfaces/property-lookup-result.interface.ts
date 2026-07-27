/**
 * Shape returned to the App2 frontend to prefill Create Listing.
 * Address fields use App2 Listing camelCase; extras are context-only
 * (not on Listing schema today — dealType/arv are different concepts).
 */
export interface PropertyLookupResult {
  propertyAddress: string
  city: string | null
  stateCode: string | null
  zipCode: string | null

  /** ATTOM AVM / market value — NOT App2 ARV (after-repair). Optional hint only. */
  suggestedPrice: number | null
  yearBuilt: number | null
  zoning: string | null
  unitCount: number | null
  propertyTypeHint: string | null

  bedrooms: number | null
  bathrooms: number | null
  squareFootage: number | null
  lotSizeAcres: number | null
  latitude: number | null
  longitude: number | null
  countyFips: string | null
  apn: string | null
  lastSalePrice: number | null
  lastSaleDate: string | null

  source: 'attom'
}
