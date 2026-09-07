import { BadRequestException } from '@nestjs/common'
import axios from 'axios'
import AdmZip = require('adm-zip')

export function assertPackageAssetUrl(value: string, cloudName: string): void {
  let url: URL
  try { url = new URL(value) } catch { throw new BadRequestException('A package file has an invalid URL.') }
  const segments = url.pathname.split('/')
  if (!cloudName || url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' ||
      url.port || url.username || url.password || segments[1] !== cloudName ||
      !['image', 'raw'].includes(segments[2]) || segments[3] !== 'upload') {
    throw new BadRequestException('A package file is not in approved storage. Re-upload it to this listing.')
  }
}

export async function buildTitlePackage(
  details: Record<string, unknown>,
  assets: Array<{ name: string; url: string }>,
  cloudName: string,
): Promise<Buffer> {
  if (assets.length > 31) throw new BadRequestException('Title packages support up to 30 property photos.')
  for (const asset of assets) assertPackageAssetUrl(asset.url, cloudName)
  const zip = new AdmZip()
  zip.addFile('property-details.json', Buffer.from(JSON.stringify(details, null, 2)))
  const deadline = Date.now() + 30_000
  let total = 0
  for (const asset of assets) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new BadRequestException('Package download timed out. Please try again.')
    try {
      const response = await axios.get<ArrayBuffer>(asset.url, {
        responseType: 'arraybuffer', maxRedirects: 0, timeout: Math.min(8_000, remaining),
        maxContentLength: 15 * 1024 * 1024, maxBodyLength: 15 * 1024 * 1024,
      })
      const buffer = Buffer.from(response.data)
      if (!buffer.length) throw new Error('Empty file')
      total += buffer.length
      if (total > 50 * 1024 * 1024) throw new BadRequestException('Title package exceeds the 50 MB limit.')
      zip.addFile(asset.name, buffer)
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      throw new BadRequestException(`Could not download ${asset.name}. The file may be missing, too large, or unavailable. Re-upload it and try again.`)
    }
  }
  return zip.toBuffer()
}
