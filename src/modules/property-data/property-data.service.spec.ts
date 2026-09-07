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
