import { assertPackageAssetUrl, buildTitlePackage } from './title-package'
import axios from 'axios'
import AdmZip = require('adm-zip')

jest.mock('axios')

describe('title package asset boundary', () => {
  it('accepts only uploaded assets in the configured Cloudinary account', () => {
    expect(() => assertPackageAssetUrl('https://res.cloudinary.com/tract/image/upload/v1/photo.jpg', 'tract')).not.toThrow()
    for (const url of [
      'http://res.cloudinary.com/tract/image/upload/a.jpg',
      'https://127.0.0.1/tract/image/upload/a.jpg',
      'https://res.cloudinary.com/other/raw/upload/contract.pdf',
      'https://res.cloudinary.com/tract/image/fetch/https://localhost/a',
      'https://user:pass@res.cloudinary.com/tract/raw/upload/a.pdf',
      'https://res.cloudinary.com:8443/tract/raw/upload/a.pdf',
    ]) expect(() => assertPackageAssetUrl(url, 'tract')).toThrow()
    expect(() => assertPackageAssetUrl('https://res.cloudinary.com/tract/raw/upload/a.pdf', '')).toThrow()
  })
  it('includes files and property details and refuses redirects at the transport', async () => {
    const get = jest.mocked(axios.get)
    get.mockResolvedValue({ data: Buffer.from('%PDF-test') })
    const buffer = await buildTitlePackage({ address: '123 Main', prices: { purchasePrice: 100000 } },
      [{ name: 'signed-contract.pdf', url: 'https://res.cloudinary.com/tract/raw/upload/a.pdf' }], 'tract')
    const zip = new AdmZip(buffer)
    expect(zip.readAsText('signed-contract.pdf')).toBe('%PDF-test')
    expect(JSON.parse(zip.readAsText('property-details.json')).address).toBe('123 Main')
    expect(get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxRedirects: 0, maxContentLength: 15 * 1024 * 1024 }))
    get.mockRejectedValue(new Error('404'))
    await expect(buildTitlePackage({}, [{ name: 'missing.pdf', url: 'https://res.cloudinary.com/tract/raw/upload/a.pdf' }], 'tract')).rejects.toThrow('Could not download missing.pdf')
  })
})
