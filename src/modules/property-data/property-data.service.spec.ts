import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PropertyDataService } from './property-data.service'
import { GooglePlacesService } from './google-places.service'

describe('Property address selection', () => {
  const resolved = {
    address1: '123 Main St', address2: 'Austin, TX 78701',
    city: 'Austin', stateCode: 'TX', zipCode: '78701', latitude: 30, longitude: -97,
  }
  const places = { resolveAddress: jest.fn().mockResolvedValue(resolved) }
  const makeService = () => new PropertyDataService(
    new ConfigService({}), places as unknown as GooglePlacesService,
  )

  it('retains the Google address when ATTOM is not configured', async () => {
    await expect(makeService().selectProperty('place')).resolves.toMatchObject({
      propertyAddress: resolved.address1, city: 'Austin', stateCode: 'TX', zipCode: '78701',
      source: 'google', enrichmentStatus: 'unavailable', suggestedPrice: null,
    })
  })

  it.each([
    [new NotFoundException(), 'not_found'],
    [new BadGatewayException(), 'unavailable'],
  ])('keeps address fields when enrichment fails (%s)', async (error, status) => {
    const service = makeService()
    jest.spyOn(service, 'lookupByAddress').mockRejectedValue(error)
    await expect(service.selectProperty('place')).resolves.toMatchObject({
      propertyAddress: resolved.address1, source: 'google', enrichmentStatus: status,
    })
  })

  it('does not hide an unexpected implementation error', async () => {
    const service = makeService()
    jest.spyOn(service, 'lookupByAddress').mockRejectedValue(new TypeError('broken mapping'))
    await expect(service.selectProperty('place')).rejects.toThrow('broken mapping')
  })

  it('keeps ATTOM facts while preferring the resolved Google address', async () => {
    const service = makeService()
    const result = await service.selectProperty('place')
    jest.spyOn(service, 'lookupByAddress').mockResolvedValue({
      ...result, source: 'attom', enrichmentStatus: 'available',
      propertyAddress: 'ATTOM spelling', city: 'Other city', bedrooms: 3,
    })
    await expect(service.selectProperty('place')).resolves.toMatchObject({
      source: 'attom', enrichmentStatus: 'available', bedrooms: 3,
      propertyAddress: resolved.address1, city: resolved.city,
    })
  })
})

// Direct lookups must never require a Google Places key or place ID.
describe('independent provider configuration', () => {
  it('looks up a full address through ATTOM without Google', async () => {
    const places = { resolveAddress: jest.fn(), searchAddresses: jest.fn() }
    const service = new PropertyDataService(new ConfigService({ ATTOM_API_KEY: 'test-key' }), places as unknown as GooglePlacesService)
    const client = (service as unknown as { client: { get: (...args: unknown[]) => unknown } }).client
    const get = jest.spyOn(client, 'get').mockResolvedValue({ data: { property: [{ address: { line1: '123 Main St', locality: 'Austin', countrySubd: 'TX', postal1: '78701' } }] } })
    await expect(service.lookupByAddress('123 Main St', 'Austin, TX 78701')).resolves.toMatchObject({ source: 'attom', city: 'Austin' })
    expect(get).toHaveBeenCalledWith('/propertyapi/v1.0.0/property/expandedprofile', { params: { address1: '123 Main St', address2: 'Austin, TX 78701' } })
    expect(places.resolveAddress).not.toHaveBeenCalled()
  })

  it('missing Google key reports suggestions unavailable, independently of ATTOM', async () => {
    const places = new GooglePlacesService(new ConfigService({ ATTOM_API_KEY: 'test-key', GOOGLE_PLACES_API_KEY: '  ' }))
    await expect(places.searchAddresses('123 Main')).rejects.toMatchObject({
      status: 503, response: { code: 'ADDRESS_SUGGESTIONS_UNAVAILABLE' },
    })
  })

  it('missing ATTOM key reports enrichment unavailable rather than an internal error', async () => {
    const service = new PropertyDataService(new ConfigService({}), {} as GooglePlacesService)
    await expect(service.lookupByAddress('123 Main St', 'Austin, TX 78701')).rejects.toMatchObject({
      status: 503, response: { code: 'PROPERTY_ENRICHMENT_UNAVAILABLE' },
    })
  })
})

// Route-level Google results must not discard the city/state/postal components.
describe('Google route-only address selection', () => {
  function setup(postalCode?: string) {
    const places = new GooglePlacesService(new ConfigService({ GOOGLE_PLACES_API_KEY: 'test-key' }))
    const client = (places as unknown as { client: { get: (...args: unknown[]) => unknown } }).client
    const component = (type: string, long_name: string, short_name = long_name) => ({ types: [type], long_name, short_name })
    jest.spyOn(client, 'get').mockResolvedValue({ data: { status: 'OK', result: {
      address_components: [component('route', 'Old US Highway 608th'), component('locality', 'Austin'),
        component('administrative_area_level_1', 'Texas', 'TX'), ...(postalCode ? [component('postal_code', postalCode)] : [])],
      formatted_address: 'Old US Highway 608th, Austin, TX',
    } } })
    return places
  }

  it('preserves city/state/ZIP and matching prediction number without a street_number component', async () => {
    const places = setup('78701')
    await expect(places.resolveAddress('route-place', undefined, '26218 Old US Highway 608th')).resolves.toMatchObject({
      address1: '26218 Old US Highway 608th', city: 'Austin', stateCode: 'TX', zipCode: '78701', streetAddressComplete: true,
    })
  })

  it('does not invent a ZIP or discard locality when no number or ZIP is returned', async () => {
    const places = setup()
    await expect(places.resolveAddress('route-place')).resolves.toMatchObject({
      address1: 'Old US Highway 608th', city: 'Austin', stateCode: 'TX', zipCode: null, streetAddressComplete: false,
    })
  })

  it('rejects mismatched prediction context without losing locality data', async () => {
    const places = setup()
    await expect(places.resolveAddress('route-place', undefined, '123 Other Road')).resolves.toMatchObject({
      address1: 'Old US Highway 608th', city: 'Austin', streetAddressComplete: false,
    })
  })

  it('retains route locality without calling ATTOM on an incomplete street', async () => {
    const service = new PropertyDataService(new ConfigService({ ATTOM_API_KEY: 'test-key' }), setup('78701'))
    const lookup = jest.spyOn(service, 'lookupByAddress')
    await expect(service.selectProperty('route-place')).resolves.toMatchObject({
      city: 'Austin', stateCode: 'TX', zipCode: '78701', source: 'google', enrichmentStatus: 'not_found',
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('retains numbered prediction and locality when ATTOM is unavailable', async () => {
    const service = new PropertyDataService(new ConfigService({}), setup('78701'))
    await expect(service.selectProperty('route-place', undefined, '26218 Old US Highway 608th')).resolves.toMatchObject({
      propertyAddress: '26218 Old US Highway 608th', city: 'Austin', stateCode: 'TX', zipCode: '78701', source: 'google', enrichmentStatus: 'unavailable',
    })
  })
})
