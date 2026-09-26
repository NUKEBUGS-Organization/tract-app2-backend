import { normalizeApp2Role, UserRole } from './user-role.enum'

describe('App2 role normalization', () => {
  it.each([
    [UserRole.PARTNER, UserRole.WHOLESALER],
    [UserRole.PRIVATE_PARTNER, UserRole.WHOLESALER],
    [UserRole.LICENSED, UserRole.REALTOR],
    [UserRole.LICENSED_PARTNER, UserRole.REALTOR],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeApp2Role(input)).toBe(expected)
  })

  it.each([UserRole.WHOLESALER, UserRole.REALTOR, UserRole.BUYER, UserRole.ADMIN])(
    'leaves %s unchanged',
    (role) => {
      expect(normalizeApp2Role(role)).toBe(role)
    },
  )
})
