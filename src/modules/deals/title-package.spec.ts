import { assertPackageAssetUrl, buildTitlePackage, describePackageContents } from './title-package'
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
    const buffer = await buildTitlePackage(
      { address: '123 Main', titleHandling: 'buyer', prices: { agreedAssignmentPrice: 200000 } },
      [
        { name: 'signed-contract.pdf', url: 'https://res.cloudinary.com/tract/raw/upload/a.pdf' },
        { name: 'property-pictures/photo-1.jpg', url: 'https://res.cloudinary.com/tract/image/upload/a.jpg' },
      ], 'tract')
    const zip = new AdmZip(buffer)
    expect(zip.readAsText('signed-contract.pdf')).toBe('%PDF-test')
    // The raw JSON summary is replaced by a readable PDF.
    expect(zip.getEntry('property-details.json')).toBeNull()
    const summary = zip.getEntry('property-summary.pdf')?.getData()
    expect(summary?.subarray(0, 5).toString()).toBe('%PDF-')
    expect(get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxRedirects: 0, maxContentLength: 15 * 1024 * 1024 }))
    get.mockResolvedValue({ data: Buffer.from('%PDF-test') })
    get.mockRejectedValue(new Error('404'))
    await expect(buildTitlePackage({}, [{ name: 'missing.pdf', url: 'https://res.cloudinary.com/tract/raw/upload/a.pdf' }], 'tract')).rejects.toThrow('Could not download missing.pdf')
  })
  it('lists documents individually and collapses photo folders', () => {
    expect(describePackageContents([
      { name: 'signed-buyer-lister-contract.pdf' },
      { name: 'property-pictures/photo-1.jpg' },
      { name: 'property-pictures/photo-2.jpg' },
    ])).toEqual([
      'property-summary.pdf (this document)',
      'signed-buyer-lister-contract.pdf',
      'property-pictures/ (2 files)',
    ])
  })
})
