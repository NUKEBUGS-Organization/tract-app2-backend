/** Response-only projection. Legacy assignment fields below represent total prices, not seller earnings. */
const privateFields = new Set([
  'assignmentfeelow', 'assignmentfee', 'wholesalerfee', 'wholesalerearnings', 'wholesalerprofit',
  'purchaseprice', 'acquisitionprice', 'acquisitioncost', 'sellerprice', 'projectedbuyerprofit',
  'estimatedholdingcosts', 'rehabtotal', 'rehabbreakdown', 'rehabcost', 'rehabcosts', 'rehabestimate',
  'rehabitems', 'rehabestimateitems', 'repaircost', 'repaircosts', 'repairestimate',
  'emdamount', 'emdstatus', 'emdforfeited', 'emddepositedat', 'emdwiringinstructions',
  'earnestmoney', 'earnestmoneydeposit', 'earnestmoneyamount', 'balanceamount',
])

export function buyerResponse(value: unknown): any {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(buyerResponse)
  if (value instanceof Date || Buffer.isBuffer(value)) return value
  if ('toJSON' in value && typeof value.toJSON === 'function') return buyerResponse(value.toJSON())
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !privateFields.has(key.replace(/_/g, '').toLowerCase()))
    .map(([key, item]) => [key, buyerResponse(item)]))
}

export function responseForViewer(value: unknown, role?: string, userId?: string): any {
  if (!role || role === 'buyer') return buyerResponse(value)
  if (role === 'admin' || role === 'title_rep' || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => responseForViewer(item, role, userId))
  if (value instanceof Date || Buffer.isBuffer(value)) return value
  if ('toJSON' in value && typeof value.toJSON === 'function') return responseForViewer(value.toJSON(), role, userId)
  const row = value as Record<string, unknown>
  const id = (ref: any) => String(ref?._id ?? ref?.id ?? ref ?? '')
  if (userId && (id(row.buyerId) === userId || id(row.primaryBuyerId) === userId) && id(row.wholesalerId) !== userId) {
    return buyerResponse(row)
  }
  return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, responseForViewer(item, role, userId)]))
}
