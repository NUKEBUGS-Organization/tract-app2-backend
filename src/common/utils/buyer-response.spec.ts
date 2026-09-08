import { ValidationPipe } from '@nestjs/common'
import { CreateBidDto } from '../../modules/bids/dto/create-bid.dto'
import { Types } from 'mongoose'
import { buyerResponse, responseForViewer } from './buyer-response'

it('removes private amounts recursively while retaining total prices and source records', () => {
  const source = { _id: new Types.ObjectId(), assignmentPrice: 125000, assignmentFeeFinal: 125000,
    emdAmount: 3000, listingId: { assignmentFeeHigh: 130000, assignmentFeeLow: 12000,
      purchasePrice: 110000, rehabTotal: 15000, rehabBreakdown: { roof: 5000 }, projectedBuyerProfit: 20000 },
    backups: [{ emd_amount: 2000, assignmentPrice: 126000 }] }
  const projected = buyerResponse(source)
  expect(projected).toEqual({ _id: source._id.toHexString(), assignmentPrice: 125000, assignmentFeeFinal: 125000,
    listingId: { assignmentFeeHigh: 130000 }, backups: [{ assignmentPrice: 126000 }] })
  expect(source.emdAmount).toBe(3000)
  expect(source.listingId.rehabBreakdown.roof).toBe(5000)
})


it('protects anonymous and buyer responses while preserving owner/admin data', () => {
  const row = { wholesalerId: 'owner', buyerId: 'buyer', emdAmount: 8765,
    listingId: { purchasePrice: 100000, rehabTotal: 25000, assignmentFeeHigh: 175000 } }
  for (const role of [undefined, 'buyer']) {
    expect(responseForViewer(row, role, 'buyer')).toEqual({ wholesalerId: 'owner', buyerId: 'buyer', listingId: { assignmentFeeHigh: 175000 } })
  }
  expect(responseForViewer(row, 'wholesaler', 'owner')).toEqual(row)
  expect(responseForViewer(row, 'admin', 'admin')).toEqual(row)
  expect(responseForViewer(row, 'realtor', 'buyer').emdAmount).toBeUndefined()
})


it('rejects a buyer attempting to set private EMD through the bid API', async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const bid = { listingId: '507f1f77bcf86cd799439011', assignmentPrice: 150000 }
  await expect(pipe.transform(bid, { type: 'body', metatype: CreateBidDto })).resolves.toMatchObject(bid)
  await expect(pipe.transform({ ...bid, emdAmount: 1000 }, { type: 'body', metatype: CreateBidDto })).rejects.toThrow('Bad Request')
})
