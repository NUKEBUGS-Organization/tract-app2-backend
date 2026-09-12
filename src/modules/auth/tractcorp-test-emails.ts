/**
 * Dedicated QA emails that skip login 2FA after a valid password.
 * Keep in sync with scripts/seed-tractcorp-test.ts
 */
export const TRACTCORP_TEST_EMAILS = [
  'realtor@tractcorp.com',
  'buyer@tractcorp.com',
  'seller@tractcorp.com',
  'wholesaler@tractcorp.com',
  'admin@tractcorp.com',
] as const

export function isTractcorpTestEmail(email: string): boolean {
  const normalized = email.toLowerCase().trim()
  const bare = normalized.startsWith('login:')
    ? normalized.slice('login:'.length)
    : normalized.startsWith('reset:')
      ? normalized.slice('reset:'.length)
      : normalized
  return (TRACTCORP_TEST_EMAILS as readonly string[]).includes(bare)
}
