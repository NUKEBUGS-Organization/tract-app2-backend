import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PropertyDataService } from './property-data.service'
import { GooglePlacesService } from './google-places.service'

describe('Property address selection', () => {
  const resolved = {
    streetAddressComplete: true,
    address1: '123 Main St', address2: 'Austin, TX 78701',
    formatted_address: '123 Main St, Austin, TX 78701, USA',
    city: 'Austin', stateCode: 'TX', zipCode: '78701', latitude: 30, longitude: -97,
  }

  it('returns the Google-resolved address fields', async () => {
    const places = { resolveAddress: jest.fn().mockResolvedValue(resolved) }
    const service = new PropertyDataService(places as unknown as GooglePlacesService)
    await expect(service.selectProperty('place')).resolves.toEqual({
      propertyAddress: '123 Main St', city: 'Austin', stateCode: 'TX', zipCode: '78701',
      latitude: 30, longitude: -97, formattedAddress: resolved.formatted_address,
      streetAddressComplete: true, source: 'google',
    })
  })

  it('reports an incomplete street rather than inventing a house number', async () => {
    const places = { resolveAddress: jest.fn().mockResolvedValue({ ...resolved, streetAddressComplete: false, address1: 'Main St' }) }
    const service = new PropertyDataService(places as unknown as GooglePlacesService)
    await expect(service.selectProperty('place')).resolves.toMatchObject({
      propertyAddress: 'Main St', city: 'Austin', streetAddressComplete: false,
    })
  })

  it('does not swallow a Places outage', async () => {
    const places = { resolveAddress: jest.fn().mockRejectedValue(new BadGatewayException()) }
    const service = new PropertyDataService(places as unknown as GooglePlacesService)
    await expect(service.selectProperty('place')).rejects.toThrow(BadGatewayException)
  })
})

describe('Direct address lookup', () => {
  it('resolves a full address through Places without a place ID', async () => {
    const places = {
      findAddress: jest.fn().mockResolvedValue({
        streetAddressComplete: true, address1: '123 Main St', address2: 'Austin, TX 78701',
        formatted_address: '123 Main St, Austin, TX 78701, USA',
        city: 'Austin', stateCode: 'TX', zipCode: '78701', latitude: 30, longitude: -97,
      }),
    }
    const service = new PropertyDataService(places as unknown as GooglePlacesService)
    await expect(service.lookupByAddress('123 Main St', 'Austin, TX 78701')).resolves.toMatchObject({
      source: 'google', city: 'Austin', propertyAddress: '123 Main St',
    })
    expect(places.findAddress).toHaveBeenCalledWith('123 Main St, Austin, TX 78701')
  })

  it('reports not found when Places has no match', async () => {
    const places = { findAddress: jest.fn().mockResolvedValue(null) }
    const service = new PropertyDataService(places as unknown as GooglePlacesService)
    await expect(service.lookupByAddress('nowhere', 'nowhere')).rejects.toThrow(NotFoundException)
  })

  it('missing Google key reports suggestions unavailable', async () => {
    const places = new GooglePlacesService(new ConfigService({ GOOGLE_PLACES_API_KEY: '  ' }))
    await expect(places.searchAddresses('123 Main')).rejects.toMatchObject({
      status: 503, response: { code: 'ADDRESS_SUGGESTIONS_UNAVAILABLE' },
    })
  })
})

// Route-level Google results must not discard the city/state/postal components.
describe('Google route-only address selection', () => {
  function setup(postalCode?: string) {
    const places = new GooglePlacesService(new ConfigService({ GOOGLE_PLACES_API_KEY: 'test-key' }))
    const client = (places as unknown as { client: { get: (...args: unknown[]) => Promise<unknown> } }).client
    const component = (type: string, long_name: string, short_name = long_name) => ({ types: [type], long_name, short_name })
    jest.spyOn(client, 'get').mockResolvedValue({ data: { status: 'OK', result: {
      address_components: [component('route', 'Old US Highway 608th'), component('locality', 'Austin'),
        component('administrative_area_level_1', 'Texas', 'TX'), ...(postalCode ? [component('postal_code', postalCode)] : [])],
      formatted_address: 'Old US Highway 608th, Austin, TX',
    } } })
    return places
  }

  it('preserves city/state/ZIP and matching prediction number without a street_number component', async () => {
    await expect(setup('78701').resolveAddress('route-place', undefined, '26218 Old US Highway 608th')).resolves.toMatchObject({
      address1: '26218 Old US Highway 608th', city: 'Austin', stateCode: 'TX', zipCode: '78701', streetAddressComplete: true,
    })
  })

  it('does not invent a ZIP or discard locality when no number or ZIP is returned', async () => {
    await expect(setup().resolveAddress('route-place')).resolves.toMatchObject({
      address1: 'Old US Highway 608th', city: 'Austin', stateCode: 'TX', zipCode: null, streetAddressComplete: false,
    })
  })

  it('rejects mismatched prediction context without losing locality data', async () => {
    await expect(setup().resolveAddress('route-place', undefined, '123 Other Road')).resolves.toMatchObject({
      address1: 'Old US Highway 608th', city: 'Austin', streetAddressComplete: false,
    })
  })

  it('surfaces a route-only result through selectProperty as an incomplete street', async () => {
    const service = new PropertyDataService(setup('78701'))
    await expect(service.selectProperty('route-place')).resolves.toMatchObject({
      city: 'Austin', stateCode: 'TX', zipCode: '78701', source: 'google', streetAddressComplete: false,
    })
  })
})
