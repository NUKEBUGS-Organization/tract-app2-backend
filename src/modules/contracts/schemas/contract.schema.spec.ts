import { model } from 'mongoose'
import { ContractSchema } from './contract.schema'

it('does not serialize either party signing credentials', () => {
  const Contract = model('ContractSerializationTest', ContractSchema)
  const contract = new Contract({ docusealWholesalerEmbedSrc: 'secret-lister', docusealBuyerEmbedSrc: 'secret-buyer' })
  expect(contract.docusealBuyerEmbedSrc).toBe('secret-buyer')
  const json = JSON.stringify(contract)
  expect(json).not.toContain('secret-lister')
  expect(json).not.toContain('secret-buyer')
})
